# Primary domain cutover (superseded)

**Do not follow this document.** It describes attaching the domain to the
OpenAI Sites platform, which the app has moved off. The DNS records below —
the `custom-domains.chatgpt.site` CNAME and both verification TXT records —
belong to that platform and must not be created.

`portfolio.cartranspro.com` now attaches directly to Firebase App Hosting,
which issues its own DNS and certificate instructions. See
[firebase-migration-plan.md](firebase-migration-plan.md).

Kept only as a record of what was attempted and why it was abandoned.

---

The intended application origin is `https://portfolio.cartranspro.com`.

The hosting attachment exists, but the last check on 7 September 2026 returned
`pending_validation`. The required DNS records were absent. Hosting the domain
and restricting the old hostname are separate steps.

## DNS records

The authoritative nameservers are BigRock's `dns1.bigrock.in` through
`dns4.bigrock.in`. Add these records in the DNS panel for `cartranspro.com`;
nameservers and unrelated records do not need changing.

| Type | Relative host | Value |
| --- | --- | --- |
| CNAME | `portfolio` | `custom-domains.chatgpt.site` |
| TXT | `_openai-site-verification.portfolio` | `openai-site-verification=Iei_3Ua4Yb1-rQlEN6Vudu_aSVEFcmPcK3_4NSFszz0` |
| TXT | `_cf-custom-hostname.portfolio` | `a0aa9ef6-4fd5-40d4-9d02-eca3000d42ef` |

These are routing and domain-verification records, not additional app URLs.
Refresh the existing Sites custom-domain attachment before applying records
again, in case the certificate provider has issued a new verification value.

Check propagation against a resolver outside the registrar before moving on:

```
nslookup -type=CNAME portfolio.cartranspro.com 8.8.8.8
nslookup -type=TXT _openai-site-verification.portfolio.cartranspro.com 8.8.8.8
```

A `Non-existent domain` answer means the record has not been published yet.

## Activation

1. Verify DNS and wait for the existing custom-domain attachment and TLS to
   become active. Confirm the app loads over HTTPS on the new domain using the
   existing Sites access policy.
2. Confirm Firebase Authentication authorized domains and the reCAPTCHA
   Enterprise allowed domains include `portfolio.cartranspro.com`.
3. Re-register the Razorpay webhook as
   `https://portfolio.cartranspro.com/api/billing/webhook` before enabling
   enforcement. Razorpay delivers webhooks by POST, and alternate origins
   answer POST with 421 without running the route, so a webhook left pointed
   at the old hostname would stop activating and renewing subscriptions.
4. Publish the tested Worker with `ENFORCE_PRIMARY_DOMAIN=true` in the Sites
   runtime. Keep the current audience. The switch is deliberately unset until
   DNS and TLS are ready, so the current app is not redirected to a dead URL.
5. Check the new origin renders normally. Requests reaching this Worker from
   any other origin redirect GET/HEAD to the same path/query on the primary
   origin (308); other methods receive 421 without executing application code.
   Incoming forwarded-host headers do not override this rule.
6. Verify Google sign-in and private uploads on the new domain. Existing browser
   sessions and installed PWAs on the old origin do not transfer; sign in and
   install again on the new origin.

## Public access is a separate setting

The domain move does not by itself make the site reachable by the public. As of
7 September 2026 every path on the current origin — `/`, `/privacy`,
`/favicon.svg` and `/api/public/firebase-config` — answers `401` with the Sites
platform's "Sign in required" page, so nothing of the application is served to
an anonymous visitor.

A custom domain inherits that same access policy. After DNS resolves,
`portfolio.cartranspro.com` will show that identical sign-in wall until the
Sites access policy for this project is changed to allow anyone. Decide that
deliberately: this app holds portfolio, document and billing data, and its own
Google sign-in is what gates user data once the platform gate is opened.

The Sites access gate runs before the application Worker, so an unauthenticated
visitor may see the Sites sign-in page before the app's redirect is evaluated.
This rule prevents the application itself from rendering on alternate origins;
it does not disable platform DNS names or change Sites access permissions.

Rollback: unset `ENFORCE_PRIMARY_DOMAIN` and redeploy the saved version. This
restores alternate-origin app serving without changing data or DNS.
