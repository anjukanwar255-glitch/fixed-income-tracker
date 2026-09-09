/**
 * Server environment variables.
 *
 * On Firebase App Hosting these are supplied by `apphosting.yaml`, with the
 * secret-valued ones resolved from Cloud Secret Manager at deploy time. Locally
 * they come from `.env*` files, which stay untracked.
 *
 * Every field is optional on purpose: callers already treat a missing value as
 * "this feature is not configured" and degrade rather than throw at import
 * time, so the shape must not promise more than the runtime provides.
 */
export interface AppEnv {
  BACKUP_ENCRYPTION_KEY?: string;
  BACKUP_KEY_VERSION?: string;
  BACKUP_PREVIOUS_ENCRYPTION_KEY?: string;
  BACKUP_PREVIOUS_KEY_VERSION?: string;
  TRIAL_HASH_SECRET?: string;
  FIREBASE_APPCHECK_SITE_KEY?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_PLAN_MONTHLY?: string;
  RAZORPAY_PLAN_HALF_YEARLY?: string;
  RAZORPAY_PLAN_YEARLY?: string;
  /** "true" turns on certificate scanning, which bills per document read. */
  DOCUMENT_SCAN_ENABLED?: string;
  /** Overridable so a stronger model can be adopted without a code change. */
  DOCUMENT_SCAN_MODEL?: string;
  VERTEX_LOCATION?: string;
}

// `ProcessEnv` declares only an index signature, so a direct annotation trips
// the weak-type check against an all-optional interface.
export const env = process.env as AppEnv;
