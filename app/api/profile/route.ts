import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { activityLogs, trialClaims, users } from "@/db/schema";
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

const profileInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  pan: z.string().trim().toUpperCase().regex(PAN_PATTERN, "Enter a valid PAN").optional().or(z.literal("")),
  dateOfBirth: z.string().date().optional().or(z.literal("")),
  acceptedTerms: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (!value.dateOfBirth) return;
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
    const db = getDb();
    const [profile] = await db.select({
      fullName: users.fullName,
      email: users.email,
      panMasked: users.panMasked,
      dateOfBirth: users.dateOfBirth,
      mobileE164: users.mobileE164,
    }).from(users)
      .where(and(eq(users.authSubject, owner.uid), isNull(users.deletedAt)))
      .limit(1);

    // A missing row and a row with no name both mean "setup not finished".
    return Response.json({ profile: profile ?? null, complete: Boolean(profile?.fullName) });
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
  const db = getDb();
  const now = new Date().toISOString();
  const panMasked = input.pan ? maskPan(input.pan) : null;

  try {
    const [existing] = await db.select({ id: users.id, fullName: users.fullName, trialStartedAt: users.trialStartedAt }).from(users)
      .where(eq(users.authSubject, owner.uid)).limit(1);
    if (!existing && !input.acceptedTerms) {
      return Response.json({ error: "Accept the Terms and Privacy Policy to create your account" }, { status: 400 });
    }
    const identityHash = existing ? null : await trialIdentityHash(owner);
    const [priorTrial] = identityHash
      ? await db.select({ claimedAt: trialClaims.claimedAt }).from(trialClaims).where(eq(trialClaims.identityHash, identityHash)).limit(1)
      : [];
    const trial = priorTrial ? { trialStartedAt: now, trialEndsAt: now } : startTrial(new Date(now));

    const profileWrite = db.insert(users).values({
      id: owner.uid,
      authSubject: owner.uid,
      fullName: input.fullName,
      email: input.email || owner.email,
      mobileE164: owner.phoneNumber,
      panMasked,
      dateOfBirth: input.dateOfBirth || null,
      trialStartedAt: trial.trialStartedAt,
      trialEndsAt: trial.trialEndsAt,
      termsAcceptedAt: input.acceptedTerms ? now : null,
      privacyAcceptedAt: input.acceptedTerms ? now : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: users.authSubject,
      set: {
        fullName: input.fullName,
        email: input.email || owner.email,
        mobileE164: owner.phoneNumber,
        dateOfBirth: input.dateOfBirth || null,
        updatedAt: now,
        // PAN is write-only: the client can only ever read the masked form back,
        // so an empty field means "leave it as it is", not "clear it". Email and
        // date of birth are readable, so clearing those is taken at face value.
        ...(panMasked ? { panMasked } : {}),
      },
    });

    const activityWrite = db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      userId: owner.uid,
      action: existing?.fullName ? "profile-updated" : "profile-created",
      entityType: "user",
      entityId: owner.uid,
      // Snapshot deliberately omits PAN and mobile: activity logs are read back
      // in the UI and must not carry identifiers.
      summary: existing?.fullName ? "Profile details updated" : "Account setup completed",
      nextSnapshot: JSON.stringify({ fullName: input.fullName, panRecorded: Boolean(panMasked) }),
      createdAt: now,
    });
    const operations: unknown[] = [profileWrite, activityWrite];
    if (identityHash && !priorTrial) operations.push(db.insert(trialClaims).values({ identityHash, originalUserId: owner.uid, claimedAt: now }).onConflictDoNothing());
    await db.batch(operations as unknown as Parameters<typeof db.batch>[0]);

    const backupWarning = await createUserBackup(owner).then(() => null).catch(() => "Automatic Firebase backup is not configured yet");
    return Response.json({ complete: true, backupWarning }, { status: existing ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "Trial protection is not configured" ? error.message : "Your profile could not be saved" }, { status: 503 });
  }
}
