import { LegalPage } from "@/components/legal-page";

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" intro="This notice explains what the tracker processes, why it is needed and the controls available to you.">
    <h2>Information we process</h2><p>We process your verified mobile number, profile details you choose to provide, investment and payout records, uploaded documents, subscription status and security activity. PAN is stored only in masked form. The app does not store card, UPI PIN or internet-banking credentials.</p>
    <h2>Why we use it</h2><p>The information is used to provide your private portfolio, expected payout and TDS tracking, reminders, account security, recovery backups, support and subscription access. It is not sold or used to recommend investments.</p>
    <h2>Service providers</h2><p>Firebase provides phone authentication and private document/backup storage. Cloudflare provides application hosting and the portfolio database. Razorpay processes subscription authorisation and payments. Each provider processes only the information needed for its service.</p>
    <h2>Security and retention</h2><p>Access is isolated by your Firebase user ID. Documents are type-checked, stored under private owner paths and downloaded as attachments. Recovery snapshots are additionally encrypted. Records are retained while your account is active and for any period required by law or fraud, billing and security obligations.</p><p>After deletion, a one-way keyed hash of the verified sign-in identity may be retained solely to enforce the one-account free-trial limit. It cannot be used to sign in or recover the original phone number or email without the separately protected server key.</p>
    <h2>Your choices</h2><p>You can export your portfolio from Profile. You can also delete your account, which removes active portfolio records and private files and cancels an active subscription. Some minimal billing or security records may be retained where the law requires it.</p>
    <h2>Questions and complaints</h2><p>Use the Support page for account, privacy or security requests. The operator&apos;s legal name, postal address and grievance email must be published there before public launch.</p>
  </LegalPage>;
}
