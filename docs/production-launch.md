# Production launch runbook

Do not enable public registration until every item in the activation section is complete.

## 1. Firebase activation

1. Upgrade `portfolio-7c0d0` to the Blaze plan. Cloud Storage setup now requires billing.
2. Open Firebase Console → Storage → Get started. Choose the bucket region deliberately; it cannot be changed in place. Keep it in the same legal/data-residency region selected for the service.
3. From this repository, deploy owner-only rules:

   ```bash
   npx firebase-tools deploy --only storage --project portfolio-7c0d0
   ```

4. Enable Phone and Google under Authentication → Sign-in method. Restrict the SMS region policy to supported markets and keep test numbers for QA.
5. Confirm `portfolio.cartranspro.com` and `localhost` are in Authentication → Authorized domains.
6. Register the web app with Firebase App Check using reCAPTCHA Enterprise, set `FIREBASE_APPCHECK_SITE_KEY` in `apphosting.yaml`, verify real traffic, then enforce App Check for Authentication, Firestore and Cloud Storage.
7. Create Firebase/Google Cloud billing budgets and anomaly alerts.

The default bucket expected by the app is `portfolio-7c0d0.firebasestorage.app`.

## 2. Hosting secrets

Generate secrets on a trusted administrator machine; never paste them into source files or support messages.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the base64 value for `BACKUP_ENCRYPTION_KEY` and a separate random value for `TRIAL_HASH_SECRET`. Set `BACKUP_KEY_VERSION=v1`. When rotating the backup key, move the old key/version to the two `BACKUP_PREVIOUS_*` variables until every active account has produced a new snapshot.

## 3. Razorpay live subscriptions

1. Complete Razorpay business/KYC activation and use Live Mode credentials.
2. Create exactly these immutable plans:

   | Code | Amount | Razorpay period | Interval |
   | --- | ---: | --- | ---: |
   | monthly | ₹99 | monthly | 1 |
   | half-yearly | ₹500 | monthly | 6 |
   | yearly | ₹800 | yearly | 1 |

3. Store the returned IDs in the matching `RAZORPAY_PLAN_*` variables. Checkout re-fetches the plan and refuses any amount, currency or cadence mismatch.
4. Set the Live key ID/secret and a separate webhook secret.
5. Register `https://portfolio.cartranspro.com/api/billing/webhook` for subscription authenticated, activated, charged, pending, halted, paused, resumed, cancelled and completed events.
6. Run test-mode journeys first: successful mandate, declined payment, duplicate webhook, delayed webhook, cancel-at-cycle-end, immediate cancellation during account deletion and trial expiry.
7. Decide with a qualified accountant whether displayed prices include applicable taxes and configure compliant invoices/receipts before collecting live payments.

Never grant access from the browser callback. The app grants paid access only from signed provider state fetched by sync or delivered through an HMAC-verified webhook.

## 4. Data and recovery

- Deploy `firestore.indexes.json` before serving the new release. A query whose composite index is missing fails at runtime, not at build time.
- Enable Firestore point-in-time recovery; it is the authoritative full-database rollback mechanism. Perform a quarterly restore rehearsal into a separate test database.
- User snapshots are encrypted with AES-GCM, written as `latest.enc` plus one daily object, and retained for 35 days. Profile → Test recovery downloads and authenticates the latest snapshot.
- The account-setup recovery button restores only missing rows and stops if it sees newer investment IDs. Billing records are deliberately not restored from a user snapshot; recover/reconcile them from Firestore and Razorpay.
- Test document download, deletion, account deletion and restore with Firebase App Check enforcement enabled.

## 5. Security and operations

- Put Cloud Armor rate limiting/WAF rules in front of OTP-adjacent, upload, checkout and webhook endpoints. The in-process limiter is only a second layer.
- Alert on elevated HTTP 401/402/429/500 rates, failed webhooks, Firebase Storage failures and backup age over 24 hours after a portfolio change.
- Review CSP violations before adding any third-party script host. Keep HSTS, frame-ancestors, nosniff and no-store API headers enabled.
- Run dependency, secret and static-analysis scanning in CI. Re-test ownership isolation with two accounts for every data endpoint.
- Establish an incident-response contact, breach assessment procedure and recovery-time/recovery-point objectives.

## 6. Legal and support blockers

Replace the launch warnings/placeholders on `/privacy`, `/terms` and `/support` with:

- legal business/operator name and postal address
- monitored support and grievance email, hours and response target
- GST/tax and invoice wording if applicable
- governing law, refund/cancellation policy and final retention schedule reviewed for the operating entity

The app is a tracker, not investment or tax advice. Keep that limitation clear in marketing and support communication.

## 7. Release gate

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

Then complete mobile/desktop accessibility checks, test on slow/offline networks, confirm export/delete while the paywall is active, and deploy to a staging hostname before production.
