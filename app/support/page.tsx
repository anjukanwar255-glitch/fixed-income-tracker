import { LegalPage } from "@/components/legal-page";

export default function SupportPage() {
  return <LegalPage title="Support & grievance contact" intro="Help for access, billing, privacy, data correction and security incidents.">
    <h2>Account access</h2><p>If OTP requests are temporarily blocked, stop retrying and wait before requesting another code. Never share an OTP with anyone claiming to represent this app.</p>
    <h2>Billing</h2><p>Keep the Razorpay payment or subscription ID shown on your receipt. It is enough to investigate a charge; never send a card number, CVV, UPI PIN or banking password.</p>
    <h2>Privacy and security</h2><p>If you believe another person accessed your account, sign out, secure the linked mobile number and report the time and device involved. Do not attach unredacted identity documents unless specifically required through a secure channel.</p>
    <div className="legal-warning"><strong>Launch requirement</strong><p>The operator must add a monitored support/grievance email, legal business name, postal address and response hours here before public registration is enabled.</p></div>
  </LegalPage>;
}
