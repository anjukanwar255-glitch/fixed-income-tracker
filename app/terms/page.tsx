import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return <LegalPage title="Terms of Use" intro="These terms apply when you create an account or use Portfolio.">
    <h2>A record, not financial advice</h2><p>The app records information supplied by you and produces estimates. It does not execute investments, guarantee returns, verify an issuer, file taxes or provide investment, legal or tax advice. Always compare calculated values with the issuer&apos;s certificate and official tax records.</p>
    <h2>Free trial and subscription</h2><p>A new account receives one 7-day trial. Continued access requires a recurring plan: ₹99 monthly, ₹500 every six months or ₹800 yearly. The billing frequency, amount, taxes if applicable and renewal mandate are shown in Razorpay Checkout before authorisation.</p>
    <h2>Your responsibilities</h2><p>Keep your phone and account secure, enter accurate information, upload only documents you are authorised to hold, and report suspected unauthorised access promptly. Do not upload executable, scripted or unlawful content.</p>
    <h2>Changes and cancellation</h2><p>You may export or delete your data from Profile. Account deletion cancels the linked subscription. A separate cancel-at-cycle-end control will remain available when a subscription is active. Material price or term changes will be shown before a new mandate is accepted.</p>
    <h2>Availability</h2><p>Reasonable safeguards, monitoring and recovery processes are used, but uninterrupted availability cannot be guaranteed. The official issuer or bank record remains the source of truth.</p>
    <h2>Operator details</h2><p>The business&apos;s legal name, address, GST details if applicable, governing-law venue and grievance contact must be inserted before this service is offered publicly.</p>
  </LegalPage>;
}
