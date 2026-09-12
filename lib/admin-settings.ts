import { adminSettings, readDoc, userDoc } from "@/db";
import { env } from "@/lib/env";
import { subscriptionPlans, type PlanCode } from "@/lib/plans";

/**
 * Settings an administrator controls, read by everyone.
 *
 * Kept in one document rather than one per setting: every page needs the whole
 * thing, and a single read is cheaper than several — a maintenance notice that
 * costs four round trips to discover is a notice that arrives late.
 *
 * Everything here has a working default in code. A missing or unreadable
 * settings document must leave the app running on those, because the one time
 * this collection is unavailable is precisely the time the app has to keep
 * working without anyone to fix it.
 */
const SETTINGS_ID = "global";

export type MaintenanceNotice = {
  enabled: boolean;
  /** Shown in place of the page body. */
  message: string;
  /** When it is expected to end, as an ISO instant. Absent if open-ended. */
  until: string | null;
};

export type PlanRate = { code: PlanCode; amountPaise: number };

export type AdminSettings = {
  maintenance: MaintenanceNotice;
  /** Overrides for the published prices; anything absent keeps the code's. */
  planRates: PlanRate[];
  /** Where "Write to us" messages are answered from. */
  supportUrl: string | null;
  /** How long a new account gets before it has to subscribe. */
  trialDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const defaultSettings: AdminSettings = {
  maintenance: { enabled: false, message: "", until: null },
  planRates: [],
  supportUrl: null,
  trialDays: 7,
  updatedAt: null,
  updatedBy: null,
};

export async function readAdminSettings(): Promise<AdminSettings> {
  try {
    const stored = await readDoc(adminSettings().doc(SETTINGS_ID));
    if (!stored || !stored.isActive) return defaultSettings;
    return { ...defaultSettings, ...parse(stored.valueJson), updatedAt: stored.updatedAt ?? null };
  } catch {
    // Unreadable settings are not a reason to stop serving the app.
    return defaultSettings;
  }
}

export async function writeAdminSettings(settings: Omit<AdminSettings, "updatedAt" | "updatedBy">, actorId: string) {
  const now = new Date().toISOString();
  await adminSettings().doc(SETTINGS_ID).set({
    id: SETTINGS_ID,
    settingType: "global",
    effectiveFrom: now,
    valueJson: JSON.stringify({ ...settings, updatedBy: actorId }),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }, { merge: true });
  return now;
}

/** Whether this account may change them. */
export async function isAdministrator(uid: string) {
  if (configuredAdministrators().includes(uid)) return true;
  try {
    const stored = await readDoc(userDoc(uid));
    return stored?.role === "admin" && !stored.deletedAt;
  } catch {
    // An unreadable role is not an admin role.
    return false;
  }
}

function configuredAdministrators() {
  return (env.ADMIN_UIDS ?? "").split(",").map((uid) => uid.trim()).filter(Boolean);
}

/**
 * The published plans, with any administered price applied.
 *
 * The plan's identity — its code, its billing period, the Razorpay plan it
 * maps to — stays in code. Only the amount is administered, because that is
 * the part a price change actually changes.
 */
export function plansWithRates(rates: PlanRate[]) {
  const byCode = new Map(rates.map((rate) => [rate.code, rate.amountPaise]));
  return subscriptionPlans.map((plan) => {
    const amountPaise = byCode.get(plan.code);
    return typeof amountPaise === "number" && amountPaise > 0 ? { ...plan, amountPaise } : { ...plan };
  });
}

function parse(valueJson: string): Partial<AdminSettings> {
  try {
    const raw = JSON.parse(valueJson) as Record<string, unknown>;
    const maintenance = raw.maintenance as Partial<MaintenanceNotice> | undefined;
    const rates = Array.isArray(raw.planRates) ? raw.planRates : [];
    return {
      maintenance: {
        enabled: Boolean(maintenance?.enabled),
        message: typeof maintenance?.message === "string" ? maintenance.message.slice(0, 500) : "",
        until: typeof maintenance?.until === "string" ? maintenance.until : null,
      },
      planRates: rates.flatMap((entry) => {
        const rate = entry as Partial<PlanRate>;
        const known = subscriptionPlans.some((plan) => plan.code === rate.code);
        return known && typeof rate.amountPaise === "number" && rate.amountPaise > 0
          ? [{ code: rate.code as PlanCode, amountPaise: Math.round(rate.amountPaise) }]
          : [];
      }),
      supportUrl: typeof raw.supportUrl === "string" ? raw.supportUrl.slice(0, 300) : null,
      // A trial of zero would lock every new account out on sight, and one of
      // a year is a mistake rather than a policy.
      trialDays: typeof raw.trialDays === "number" && raw.trialDays >= 1 && raw.trialDays <= 90
        ? Math.round(raw.trialDays)
        : defaultSettings.trialDays,
      updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
    };
  } catch {
    return {};
  }
}
