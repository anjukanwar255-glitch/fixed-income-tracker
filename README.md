# Fixed Income Tracker

A private fixed-income portfolio PWA built with Next.js on Firebase App Hosting. Cloud Firestore stores portfolio records, Firebase provides authentication and private document/backup storage, and Razorpay handles recurring subscriptions.

## Product behaviour

- Firebase Phone OTP plus optional Google sign-in
- one 7-day trial per keyed, pseudonymous verified identity
- ₹99 monthly, ₹500 every six months, or ₹800 yearly recurring plans
- FD, corporate FD, bond, NCD, debenture and government-security records
- exact-date interest accrual, configurable day-count and compounding frequency
- monthly, quarterly, half-yearly, yearly and maturity payout schedules
- payout/TDS reconciliation, maturity reminders, edit/archive/mature controls
- Indian bank dropdown with manual entry
- private PDF/JPG/JPEG/PNG uploads with signature, structure, size and active-PDF checks
- AES-GCM encrypted daily Firebase recovery snapshots, 35-day retention and idempotent restore
- JSON/CSV export, subscription cancellation and account deletion

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The local app is served at `http://localhost:3000`. Add `localhost` to Firebase Authentication authorized domains and use a Firebase test phone number to avoid sending real SMS.

Firestore access uses Application Default Credentials. Either point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key or run `gcloud auth application-default login`; App Hosting supplies the credentials itself in production.

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
```

`db/types.ts` describes the stored document shapes and `firestore.indexes.json` declares every composite index the queries need — a query added without its index fails at runtime, not at build time. Firebase web configuration in `lib/firebase-config.ts` is public by design; never commit server secrets.

## Runtime configuration

`apphosting.yaml` declares these. Secret-valued entries resolve from Cloud Secret Manager and are never stored in the repository:

- `TRIAL_HASH_SECRET` — at least 24 random characters
- `BACKUP_ENCRYPTION_KEY` — base64-encoded 32 random bytes
- `BACKUP_KEY_VERSION` — for example `v1`
- `BACKUP_PREVIOUS_ENCRYPTION_KEY` and `BACKUP_PREVIOUS_KEY_VERSION` — temporarily retain during key rotation
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_PLAN_MONTHLY`
- `RAZORPAY_PLAN_HALF_YEARLY`
- `RAZORPAY_PLAN_YEARLY`
- `FIREBASE_APPCHECK_SITE_KEY` — public reCAPTCHA Enterprise site key

See [docs/production-launch.md](docs/production-launch.md) before enabling public registration, and [docs/firebase-migration-plan.md](docs/firebase-migration-plan.md) for how the app moved off Cloudflare.

## Architecture notes

Every API request derives its owner from a verified Firebase ID token; client-supplied user IDs are never trusted. JWT signatures are validated against Google's public signing keys, so no Firebase service-account key is stored in the repository — the Admin SDK authenticates as the App Hosting runtime identity. Firebase App Check starts before Authentication, and its tokens are forwarded to Storage.

Data is stored per user: a document at `users/{uid}` with a subcollection for each record type beneath it. Ownership is therefore a property of the document path rather than a field every query has to filter on, and deleting an account is one recursive delete. Firestore has no foreign keys, so the references between investments, payout schedules, TDS records and documents are maintained by the route handlers alone.

All database access is server-side through the Admin SDK, which bypasses security rules; `firestore.rules` denies direct client access entirely, because the route handlers enforce entitlement, rate limits and financial invariants that rules cannot express. Firebase Storage is the exception — clients upload and download objects directly, under the ownership rules in `storage.rules`.

Documents are served only through authenticated attachment downloads. Encrypted Firebase snapshots provide per-user recovery and portability without trusting restored billing state; enable Firestore point-in-time recovery for database-wide rollback.

Recovery snapshots are rebuilt at most once per day per user. They read every document the user owns, so regenerating one on every write would make each edit slower and costlier as the account's history grows.
