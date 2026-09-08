# Cloudflare to Firebase migration plan

Goal: run the whole application inside the existing Firebase project
`portfolio-7c0d0`, on the Blaze plan already in use, so the site has one
console, one bill and one custom domain. Firestore replaces Cloudflare D1;
Firebase App Hosting replaces the Cloudflare Worker and the Sites platform.

## Status

Applied so far, all type-checking clean:

- `db/index.ts` rewritten as Firestore accessors; `db/types.ts` added;
  `db/schema.ts` and the Drizzle `examples/d1` sample deleted.
- All seventeen data-access files migrated — fifteen route handlers plus
  `lib/backups.ts` and `lib/billing.ts`.
- `cloudflare:workers` environment reads replaced by `lib/env.ts` over
  `process.env`.
- `middleware.ts` carries the security headers the Worker applied.
- `firestore.rules`, `firestore.indexes.json`, `apphosting.yaml` and an updated
  `firebase.json` added.

- The Cloudflare toolchain is gone: `vinext`, `wrangler`, `drizzle-orm`,
  `drizzle-kit`, `@cloudflare/*` and the Vite RSC plugins are uninstalled, and
  `worker/`, `build/`, `.openai/`, `drizzle/`, `vite.config.ts` and
  `worker-configuration.d.ts` are deleted. `vite` remains as a test-only
  dependency: two test files use it to load TypeScript modules, which has
  nothing to do with Cloudflare.
- `npm run build` is `next build` and passes. Security headers moved to
  `next.config.ts` rather than middleware, because Firebase documents the
  Next.js Proxy as still having architectural hurdles on App Hosting, and the
  CSP that permits Firebase Auth and Razorpay must not depend on it.
- Tests rewritten: the Worker-bundle tests are replaced by ones that boot the
  built production server and assert the rendered page, the security headers
  and the no-store rule on API responses.

Still outstanding: nothing has been deployed, because `firebase login` has not
been run in this workspace. Firestore rules and indexes have not been pushed,
no App Hosting backend exists yet, and the domain is not attached.

## What actually couples the app to Cloudflare

The app is standard Next.js App Router code. `next.config.ts` is empty and no
file under `app`, `components`, `features`, `lib`, `core`, `hooks` or `db`
imports `vinext`. The coupling is five places:

| Location | Coupling | Replacement |
| --- | --- | --- |
| `db/index.ts` | `drizzle-orm/d1`, `cloudflare:workers` | Firestore Admin SDK |
| `lib/billing.ts` | `env` from `cloudflare:workers` | `process.env` |
| `lib/backups.ts` | `env` from `cloudflare:workers` | `process.env` |
| `app/api/public/firebase-config/route.ts` | `env` from `cloudflare:workers` | `process.env` |
| `worker/index.ts` | Worker shell, `env.IMAGES` | `middleware.ts` + Next image optimization |

Seventeen files read or write the database: fifteen route handlers plus
`lib/backups.ts` and `lib/billing.ts`.

Query shapes are simple, which is why Firestore is viable: one `innerJoin`,
zero transactions, zero `groupBy`, zero subqueries, twelve upserts
(`onConflict`) and nine `batch()` calls.

## Runtime target

Next.js 16.2 introduced the stable Deployment Adapter API and Firebase's
App Hosting adapter is built on it; this project is on Next 16.2.6. App
Hosting runs on Cloud Run and requires Node 20+, and `engines` already
requires Node >=22.13.0.

The published version table still lists 15.2.x as the newest "Active" entry
and notes that versions outside the listed ranges may work but are not
officially supported. Confirm with a throwaway App Hosting deployment of the
unmodified app before any data work begins. If Next 16.2 does not build, stop
and reconsider rather than migrating data first.

## Firestore data model

`users.id` already holds the Firebase `uid` — the schema documents it as the
record ownership key, and `collectUserData` looks users up by it. So the uid
becomes the document id and the `authSubject` column and its unique index both
disappear, removing one lookup per authenticated request.

Every user-owned table becomes a subcollection, which makes ownership a
property of the path rather than a filter that code must remember to apply:

```
users/{uid}
users/{uid}/investments/{id}
users/{uid}/payoutSchedules/{id}
users/{uid}/payoutTransactions/{id}
users/{uid}/tdsRecords/{id}
users/{uid}/forms/{id}
users/{uid}/documents/{id}
users/{uid}/subscriptions/{id}
users/{uid}/backupRuns/{id}
users/{uid}/notifications/{id}
users/{uid}/activityLogs/{id}

issuers/{id}
investmentTypes/{code}
financialYears/{label}
adminSettings/{id}
billingEvents/{provider}__{providerEventId}
trialClaims/{identityHash}
```

## What SQL guarantees today, and how each is kept

Firestore has no unique indexes, foreign keys or joins. Each existing
guarantee needs a deliberate replacement:

| Guarantee | Today | After |
| --- | --- | --- |
| `uidx_users_auth_subject` | unique index | uid is the document id |
| `uidx_investment_types_code` | unique index | code is the document id |
| `uidx_financial_years_label` | unique index | label is the document id |
| `uidx_billing_events_provider_event` | unique index + upsert | composite document id; `create()` fails on replay, preserving webhook idempotency |
| `uidx_subscriptions_provider_id` | unique index | collection group query on `subscriptions` — the Razorpay webhook knows only the provider subscription id, not the uid, so this query is required and must have an index |
| Foreign keys | enforced by D1 | enforced in application code; financial rows reference each other and nothing else will catch a dangling reference |
| Cascade on account deletion | `references()` | `recursiveDelete()` on `users/{uid}` |

The subscriptions collection group query is the one place where the
subcollection layout costs something. It is worth confirming early that the
webhook path works, because billing breaks silently if it does not.

## Blocker to fix during the migration: backup read amplification

`createUserBackup` calls `collectUserData`, which reads the user's entire
dataset — investments, payout schedules, payout transactions, TDS records,
forms, documents, notifications and activity logs — as nine full scans. It is
called on every mutation: investments create/update/delete, documents
create/delete, payouts, TDS and profile.

On D1 that is a local SQLite scan and effectively free. On Firestore every
document read is billed and crosses the network.

`activityLogs` makes this worse over time. It grows with every action and is
re-read in full by every backup, so the cost of a single edit grows with the
length of the user's history. A user with five years of monthly payouts and a
few thousand activity log entries would spend thousands of document reads on
each edit.

The existing code already writes one object per day (`{day}.enc`) and checks
for a same-day `backupRuns` row, so a daily backup is clearly the intent; the
regeneration on every write is the accident. Fix before or with the cutover:
skip regeneration when a completed run already exists for the current day, and
bound the activity log read. This is not optional cleanup — porting the
current behaviour to Firestore as-is would make every write slow and costly.

## Composite indexes

Subcollections index single fields automatically. These combinations are used
today as SQL indexes and will need entries in `firestore.indexes.json`:
investments by status and by maturity date, payout schedules by due date,
TDS records by financial year, forms by financial year and status,
notifications by scheduled date, activity logs and backup runs by created
date, and the `subscriptions` collection group by provider subscription id.
Soft-deleted rows are filtered by `deletedAt`, which joins several of these.

## Security rules

All database access is server-side today: route handlers verify a Firebase ID
token and then query. Keeping that shape means the Admin SDK does the reading
and writing, and `firestore.rules` can deny all direct client access. That
preserves the current security model exactly and requires no frontend change.
Storage rules stay as they are.

## Staged execution

1. Prove Next 16.2 builds and serves on App Hosting, unmodified. Stop here if
   it does not.
2. Replace `cloudflare:workers` env reads with `process.env` in three files.
3. Move `worker/index.ts` concerns into `middleware.ts`: the security headers
   and CSP. The primary-domain redirect is no longer needed once the domain
   attaches directly to App Hosting.
4. Build the Firestore data-access layer behind the same function shapes the
   seventeen callers already use, so route handlers change as little as
   possible.
5. Fix backup amplification.
6. Write `firestore.rules`, `firestore.indexes.json` and `apphosting.yaml`,
   with secrets in Cloud Secret Manager.
7. Rewrite the test suite: the current tests import the built Worker bundle
   (`dist/server/index.js`), which will no longer exist.
8. Attach `portfolio.cartranspro.com` directly to App Hosting and verify
   sign-in, uploads, payouts, TDS and the Razorpay webhook.
9. Decommission the Sites deployment and remove `wrangler`,
   `@cloudflare/vite-plugin`, `vinext`, `drizzle-orm`, `drizzle-kit` and
   `.openai/`.

There is no data migration step. Production D1 holds no real user data, so
Firestore starts empty and the reference collections (`issuers`,
`investmentTypes`, `financialYears`, `adminSettings`) are seeded fresh.

This also removes the main ordering risk. The staged order still runs the App
Hosting build check first, but a failure there now costs only rework, not data.

## Domain

`portfolio.cartranspro.com` attaches directly to App Hosting. The BigRock DNS
records in `primary-domain-cutover.md` — the `custom-domains.chatgpt.site`
CNAME and the two verification TXT records — are for the Sites platform and
are not used on this path. App Hosting issues its own DNS and certificate
instructions when the domain is added.

The primary-domain redirect in `worker/index.ts` is therefore obsolete: with
no Sites deployment there is no alternate origin to redirect from.

## Open items

- Razorpay webhook URL must move to the App Hosting domain at cutover.
- Firebase Auth authorized domains and reCAPTCHA Enterprise allowed domains
  need `portfolio.cartranspro.com`.
- `firebase login` has not been run in this workspace; App Hosting deployment
  and Firestore index work need it.
