# Fixed Income Tracker

A private fixed-income portfolio PWA built with Vinext/React on Cloudflare Sites. Cloudflare D1 stores portfolio records, Firebase provides authentication and private document/backup storage, and Razorpay handles recurring subscriptions.

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
npm run db:migrate:local
npm run dev
```

The local app is served at `http://localhost:5173`. Add `localhost` to Firebase Authentication authorized domains and use a Firebase test phone number to avoid sending real SMS.

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run db:generate
```

`db/schema.ts` is the source of truth. Generated migrations in `drizzle/` are packaged into the Sites deployment. Firebase web configuration in `lib/firebase-config.ts` is public by design; never commit server secrets.

## Runtime configuration

Set these as encrypted runtime secrets/variables in the hosting environment:

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
- `FIREBASE_APPCHECK_SITE_KEY` — public reCAPTCHA Enterprise site key, supplied through the hosting runtime

See [docs/production-launch.md](docs/production-launch.md) before enabling public registration.

## Architecture notes

Every API request derives its owner from a verified Firebase ID token; client-supplied user IDs are never trusted. The Worker validates JWT signatures against Google's public signing keys, so no Firebase service-account key is stored. Firebase App Check starts before Authentication, and its tokens are forwarded to Storage.

Documents are served only through authenticated attachment downloads. D1 Time Travel is the full-database recovery layer; encrypted Firebase snapshots provide per-user recovery and portability without trusting restored billing state.
