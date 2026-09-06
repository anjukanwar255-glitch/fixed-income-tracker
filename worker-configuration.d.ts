declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
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
  }
}
