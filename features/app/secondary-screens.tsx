"use client";

import { BellRing, CalendarClock, CheckCircle2, FileText, Landmark, ReceiptIndianRupee, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

export function PayoutsScreen({ investments }: { investments: PortfolioInvestment[] }) {
  const rows = investments.flatMap((investment) => investment.schedule.slice(0, 3).map((payout) => ({ investment, payout }))).sort((a, b) => a.payout.dueDate.localeCompare(b.payout.dueDate));
  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">Cash flow</p><h1>Payouts</h1></div></header>
      <Tabs defaultValue="upcoming" className="filter-tabs"><TabsList variant="line"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="due">Due</TabsTrigger><TabsTrigger value="received">Received</TabsTrigger><TabsTrigger value="not-received">Not received</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs>
      <div className="secondary-summary"><span><CalendarClock /> Next 90 days</span><strong>₹86,737</strong><small>4 expected payouts</small></div>
      <div className="simple-list">
        {rows.slice(0, 6).map(({ investment, payout }, index) => (
          <div className="simple-row" key={`${investment.id}-${payout.id}`}>
            <span className="row-icon"><Landmark /></span>
            <span className="row-copy"><b>{investment.name}</b><small>{investment.issuer} · {formatDate(payout.dueDate)}</small></span>
            <span className="row-value"><b>{formatMoney(payout.expectedNetPaise)}</b><small>{formatMoney(payout.grossInterestPaise)} gross</small></span>
            <Badge className={index === 0 ? "status-pending" : "status-upcoming"}>{index === 0 ? "Due soon" : "Upcoming"}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TdsScreen() {
  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">FY 2026-27</p><h1>TDS reconciliation</h1></div><Button variant="outline"><FileText /> Export report</Button></header>
      <div className="tds-metric-grid">
        <div><span>Expected TDS</span><strong>₹22,238</strong><small>From calculated payouts</small></div>
        <div><span>Actual deducted</span><strong>₹20,500</strong><small>User confirmed</small></div>
        <div><span>PAN reflected</span><strong>₹18,000</strong><small>Verified by user</small></div>
        <div className="danger"><span>Difference</span><strong>₹2,500</strong><small>Needs verification</small></div>
      </div>
      <div className="section-heading"><div><h2>Investment reconciliation</h2><p>Calculated values never count as verified credit</p></div></div>
      <div className="simple-list">
        <TdsRow issuer="ABC Finance Ltd" gross="₹90,000" expected="₹9,000" reflected="₹8,000" status="Mismatch" />
        <TdsRow issuer="Northstar Housing Finance" gross="₹61,875" expected="₹6,188" reflected="₹6,188" status="Matched" />
        <TdsRow issuer="Bharat Infra Credit" gross="₹70,500" expected="₹7,050" reflected="—" status="Pending" />
      </div>
      <div className="data-principle"><ShieldCheck /><p><strong>Verification rule.</strong> The app will only show TDS as reflected after you confirm it from your tax record or a verified integration supplies it.</p></div>
    </div>
  );
}

function TdsRow({ issuer, gross, expected, reflected, status }: { issuer: string; gross: string; expected: string; reflected: string; status: string }) {
  return (
    <div className="simple-row tds-row">
      <span className="row-icon"><ReceiptIndianRupee /></span>
      <span className="row-copy"><b>{issuer}</b><small>Gross {gross} · Expected TDS {expected}</small></span>
      <span className="row-value"><small>PAN reflected</small><b>{reflected}</b></span>
      <Badge className={status === "Matched" ? "status-received" : status === "Mismatch" ? "status-mismatch" : "status-pending"}>{status}</Badge>
    </div>
  );
}

export function ProfileScreen({ displayName }: { displayName: string }) {
  return (
    <div className="screen secondary-screen profile-screen">
      <header className="screen-header"><div><p className="screen-kicker">Account</p><h1>Profile & settings</h1></div></header>
      <section className="profile-card">
        <span className="profile-avatar"><UserRound /></span>
        <div><h2>{displayName}</h2><p>Mobile verified · PAN linked</p></div>
        <Badge className="status-received"><CheckCircle2 /> Verified</Badge>
        <div className="profile-details"><span><small>Mobile</small><b>+91 •••••• 4821</b></span><span><small>PAN</small><b>ABCDE****F</b></span><span><small>Email</small><b>mahendra@example.com</b></span></div>
      </section>
      <section className="settings-card">
        <div className="section-heading"><div><h2>Notifications</h2><p>Choose the reminders you want to receive</p></div><BellRing /></div>
        <Setting label="Payout reminders" detail="Before and on due date" defaultChecked />
        <Setting label="Maturity reminders" detail="90, 30 and 7 days before" defaultChecked />
        <Setting label="TDS reminders" detail="Prompt to verify PAN credit" defaultChecked />
        <Setting label="Form reminders" detail="Declarations and renewals" defaultChecked />
      </section>
      <section className="settings-card"><div className="section-heading"><div><h2>Data protection</h2><p>Financial history is backed up and audit protected</p></div><ShieldCheck /></div><div className="security-list"><span>Encrypted connection <b>Active</b></span><span>Cloud backup <b>Active</b></span><span>Last sync <b>Just now</b></span></div></section>
    </div>
  );
}

function Setting({ label, detail, defaultChecked }: { label: string; detail: string; defaultChecked?: boolean }) {
  return <div className="toggle-row"><span><b>{label}</b><small>{detail}</small></span><Switch defaultChecked={defaultChecked} /></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
