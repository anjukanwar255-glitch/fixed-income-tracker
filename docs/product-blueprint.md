# Fixed Income Tracker — Product Blueprint

## Product boundary

Version 1 is a mobile-first portfolio workspace for individual investors in India. It records fixed-income investments, calculates an editable expected payout schedule, asks the user to confirm actual receipts, and keeps expected, actual, and verified tax values separate.

The hosted implementation uses authenticated user identity for data isolation, D1 for structured records, and R2 for private document bytes. Mobile-number OTP is represented in the product flow behind an authentication adapter; a production SMS provider can be connected without changing investment screens.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `app/` | Routes, server boundaries, metadata, authenticated APIs |
| `features/` | Screen-level UI and workflows |
| `components/ui/` | Accessible interaction primitives |
| `core/models/` | Shared financial domain types |
| `core/finance/` | Decimal-safe interest, TDS, maturity and FY calculations |
| `db/` | D1 schema and database adapter |
| `data/` | Demo/preview fixtures only |
| `docs/` | Product, flow and implementation decisions |

Future integrations (broker imports, multiple PANs, family portfolios, issuer APIs and verified tax data) enter through adapters and do not change historical transaction tables.

## Navigation

Primary bottom navigation: Home, Investments, Payouts, TDS and Profile. A floating `Add investment` action starts the six-step creation flow. Investment cards open a detail view with Overview, Payouts, TDS, Documents, Forms and Activity tabs.

## User flow

1. Splash → secure sign-in / mobile OTP adapter → profile.
2. Home dashboard → add investment.
3. Investment type → details → interest → TDS → account → documents.
4. Review the transparent calculation → save → generate expected schedule.
5. Due payout → confirm received/not received → record actual payment.
6. Reconcile expected deduction, actual deduction and verified PAN credit.
7. Track forms/documents → maturity confirmation → FY report.

## Screens

### Version 1

- Splash, login, OTP and profile bootstrap
- Home dashboard with FY selector, totals, upcoming payouts and attention items
- Investment list with search/type/status filters
- Six-step add investment flow with calculation preview
- Investment detail with payout schedule, TDS summary and immutable activity history
- Payout confirmation and mismatch state

### Next releases

- TDS reconciliation workspace, forms and secure documents
- Smart notifications, maturity workflow and exports
- Admin configuration panel, report builder and advanced analytics

## Core model rules

- Money is stored as integer paise; percentages are stored as basis points.
- Generated values are `expected`; user-entered banking values are `actual`; PAN reconciliation is `verified`.
- Corrections append activity events and revision records. They never silently overwrite financial history.
- Tax and form rules are effective-dated configuration, not hard-coded constants.
- Every payout, TDS record, form and report row carries a financial-year key.
- Soft-delete fields protect historical records; transaction history is retained by default.

## Interest and TDS strategy

For periodic simple interest:

`gross paise = principal paise × annual rate bps × period months ÷ (10,000 × 12)`

All intermediate values use `bigint` and half-up rounding. Schedule dates are generated from the configured first payout date, preserving end-of-month behavior and leap years. Custom schedules remain editable. Compound/cumulative projections use integer rational exponentiation by the number of compounding periods; final issuer-specific corrections are saved as audited adjustments.

`expected TDS`, `actual TDS`, and `verified TDS credit` are independent columns. A mismatch is calculated only from the selected comparison, never inferred as confirmed.

## Design system

- Visual thesis: a calm navy ledger with bright cyan focus, white financial cards and precise status color.
- Typography: system sans, tabular numerals for money, minimum 14px controls and 16px body copy.
- Spacing: 4/8/12/16/24/32 scale; 16px mobile gutters; 20–24px card padding.
- Radius: 14px controls, 20–28px cards.
- Status: green received/matched, amber pending, red overdue/mismatch, slate upcoming/inactive.
- Accessibility: high-contrast text, visible focus rings, 44px touch targets, semantic labels and no color-only status.

## Data ownership and security

Every API derives the owner key on the server from authenticated request headers. PAN is masked in UI and must never be written to logs. Documents use private object storage with short-lived authorized access. Database backups, append-only activity, soft deletes and environment-managed secrets are part of the production operating model.
