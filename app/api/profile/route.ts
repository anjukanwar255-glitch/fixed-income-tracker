import { z } from "zod";

import { activityLogs, commitAll, readDoc, setOp, trialClaims, updateOp, userDoc } from "@/db";
import { startTrial, trialIdentityHash } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import { authenticatedRequest, authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * PAN is validated but only ever persisted in masked form. The schema carries a
 * `panCiphertext` column for a future encrypted copy; until this project has a
 * key management story, storing the full value would put an unprotected tax
 * identifier in the database, so it is deliberately dropped after masking.
 */
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Name, email and date of birth are required for both account setup and later
 * edits — all three are readable, so the edit form can pre-fill them.
 *
 * PAN is the exception. It is write-only: only the masked form is ever sent
 * back, so the edit form starts blank and an empty value there means "keep the
 * stored one", not "clear it". Requiring it unconditionally would make every
 * profile edit fail unless the whole PAN were retyped. It is instead required
 * at account creation only, which the handler enforces once it knows whether a
 * profile already exists.
 */
const profileInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email("Enter a valid email address").max(160),
  pan: z.string().trim().toUpperCase().regex(PAN_PATTERN, "Enter a valid PAN").optional().or(z.literal("")),
  dateOfBirth: z.string().date(),
  acceptedTerms: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  const today = new Date().toISOString().slice(0, 10);
  if (value.dateOfBirth >= today) {
    context.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Date of birth must be in the past" });
  }
});

/** `ABCDE1234F` → `ABCDE****F`: enough to identify, not enough to reuse. */
function maskPan(pan: string) {
  return `${pan.slice(0, 5)}****${pan.slice(9)}`;
}

export async function GET() {
  const owner = await authenticatedUser();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const stored = await readDoc(userDoc(owner.uid));
    // Only these fields go to the client; the stored document also holds the
    // trial and consent timestamps, which the profile screen does not read.
    const profile = stored && !stored.deletedAt
      ? {
        fullName: stored.fullName,
        email: stored.email ?? null,
        panMasked: stored.panMasked ?? null,
        dateOfBirth: stored.dateOfBirth ?? null,
        mobileE164: stored.mobileE164 ?? null,
      }
      : null;

    // A missing row and a row with no name both mean "setup not finished".
    return Response.json({ profile, complete: Boolean(profile?.fullName) });
  } catch {
    return Response.json({ error: "Profile is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const owner = await authenticatedRequest();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  const limited = await rateLimit(request, "profile-save", owner.uid, 20, 10 * 60 * 1000);
  if (limited) return limited;

  const parsed = profileInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Please check the highlighted details", issues: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const now = new Date().toISOString();
  const panMasked = input.pan ? maskPan(input.pan) : null;

  try {
    const existing = await readDoc(userDoc(owner.uid));
    if (!existing && !input.acceptedTerms) {
      return Response.json({ error: "Accept the Terms and Privacy Policy to create your account" }, { status: 400 });
    }
    // Required to create an account, but blank on a later edit means "keep the
    // stored PAN" — the client never receives it back unmasked to resend.
    if (!existing && !panMasked) {
      return Response.json({ error: "Enter your PAN to create your account" }, { status: 400 });
    }
    const identityHash = existing ? null : await trialIdentityHash(owner);
    const priorTrial = identityHash ? await readDoc(trialClaims().doc(identityHash)) : null;
    const trial = priorTrial ? { trialStartedAt: now, trialEndsAt: now } : startTrial(new Date(now));

    // The upsert is split, because creating and updating never wrote the same
    // fields: trial and consent timestamps are set once, at account creation.
    const profileWrite = existing
      ? updateOp(userDoc(owner.uid), {
        fullName: input.fullName,
        email: input.email || owner.email,
        mobileE164: owner.phoneNumber,
        dateOfBirth: input.dateOfBirth || null,
        updatedAt: now,
        // PAN is write-only: the client can only ever read the masked form back,
        // so an empty field means "leave it as it is", not "clear it". Email and
        // date of birth are readable, so clearing those is taken at face value.
        ...(panMasked ? { panMasked } : {}),
      })
      : setOp(userDoc(owner.uid), {
        id: owner.uid,
        fullName: input.fullName,
        email: input.email || owner.email,
        mobileE164: owner.phoneNumber,
        panMasked,
        dateOfBirth: input.dateOfBirth || null,
        role: "user",
        trialStartedAt: trial.trialStartedAt,
        trialEndsAt: trial.trialEndsAt,
        termsAcceptedAt: input.acceptedTerms ? now : null,
        privacyAcceptedAt: input.acceptedTerms ? now : null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

    const logId = crypto.randomUUID();
    const activityWrite = setOp(activityLogs(owner.uid).doc(logId), {
      id: logId,
      actorType: "user",
      action: existing?.fullName ? "profile-updated" : "profile-created",
      entityType: "user",
      entityId: owner.uid,
      // Snapshot deliberately omits PAN and mobile: activity logs are read back
      // in the UI and must not carry identifiers.
      summary: existing?.fullName ? "Profile details updated" : "Account setup completed",
      nextSnapshot: JSON.stringify({ fullName: input.fullName, panRecorded: Boolean(panMasked) }),
      createdAt: now,
    });
    await commitAll([profileWrite, activityWrite]);

    // Written outside the batch and tolerant of a race, matching the previous
    // "do nothing on conflict": a claim that already exists must not be moved
    // forward, and must not fail the profile save either.
    if (identityHash && !priorTrial) {
      await trialClaims().doc(identityHash)
        .create({ identityHash, originalUserId: owner.uid, claimedAt: now })
        .catch(() => undefined);
    }

    const backupWarning = await createUserBackup(owner).then(() => null).catch(() => "Automatic Firebase backup is not configured yet");
    return Response.json({ complete: true, backupWarning }, { status: existing ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "Trial protection is not configured" ? error.message : "Your profile could not be saved" }, { status: 503 });
  }
}
