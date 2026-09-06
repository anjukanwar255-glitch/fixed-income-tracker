import Link from "next/link";
import { Landmark } from "lucide-react";

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link href="/" className="auth-brand"><span className="brand-mark mini"><Landmark aria-hidden="true" /></span><span>Fixed Income Tracker</span></Link>
        <header><p className="screen-kicker">Effective 6 September 2026</p><h1>{title}</h1><p>{intro}</p></header>
        <div className="legal-content">{children}</div>
        <footer><Link href="/">Return to app</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link></footer>
      </article>
    </main>
  );
}
