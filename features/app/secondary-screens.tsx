"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Landmark, LogOut, ReceiptIndianRupee, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

type PayoutFilter = "upcoming" | "due" | "received" | "not-received" | "all";

export function PayoutsScreen({ investments, onOpenInvestment }: { investments: PortfolioInvestment[]; onOpenInvestment: (id: string) => void }) {
  const [filter, setFilter] = useState<PayoutFilter>("upcoming");
  const today = todayIso();
  const ninetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const allRows = useMemo(() => investments.flatMap((investment) => investment.schedule.map((payout) => ({ investment, payout }))).sort((a, b) => a.payout.dueDate.localeCompare(b.payout.dueDate)), [investments]);
  const rows = allRows.filter(({ payout }) => {
    if (filter === "all") return true;
    if (filter === "received") return payout.status === "received" || payout.status === "partial-received";
    if (filter === "not-received") return payout.status === "not-received" || payout.status === "overdue";
    if (filter === "due") return payout.status === "due-today" || payout.status === "overdue";
    return payout.status === "upcoming";
  });
  const nextNinety = allRows.filter(({ payout }) => payout.dueDate >= today && payout.dueDate <= ninetyDays && payout.status === "upcoming");
  const nextNinetyTotal = nextNinety.reduce((sum, { payout }) => sum + payout.expectedNetPaise, 0n);

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">Cash flow</p><h1>Payouts</h1></div></header>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as PayoutFilter)} className="filter-tabs"><TabsList variant="line"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="due">Due</TabsTrigger><TabsTrigger value="received">Received</TabsTrigger><TabsTrigger value="not-received">Not received</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs>
      <div className="secondary-summary"><span><CalendarClock /> Next 90 days</span><strong>{formatMoney(nextNinetyTotal)}</strong><small>{nextNinety.length} expected payout{nextNinety.length === 1 ? "" : "s"}</small></div>
      <div className="simple-list">
        {rows.map(({ investment, payout }) => (
          <button className="simple-row simple-row-button" key={`${investment.id}-${payout.id}`} onClick={() => onOpenInvestment(investment.id)}>
            <span className="row-icon"><Landmark /></span>
            <span className="row-copy"><b>{investment.name}</b><small>{investment.issuer} · {formatDate(payout.dueDate)}</small></span>
            <span className="row-value"><b>{formatMoney(payout.receivedAmountPaise ?? payout.expectedNetPaise)}</b><small>{payout.receivedAmountPaise === undefined ? "Expected net" : "Bank confirmed"}</small></span>
            <Badge className={payout.status === "received" ? "status-received" : payout.status === "overdue" || payout.status === "not-received" ? "status-mismatch" : "status-upcoming"}>{labelStatus(payout.status)}</Badge>
          </button>
        ))}
        {!rows.length && <InlineEmpty icon={CalendarClock} title={`No ${filter === "all" ? "" : `${filter.replace("-", " ")} `}payouts`} detail="Payout records will appear here after you add an investment." />}
      </div>
    </div>
  );
}

export function TdsScreen({ investments, onOpenInvestment, financialYear }: { investments: PortfolioInvestment[]; onOpenInvestment: (id: string) => void; financialYear: string }) {
  const rows = investments.map((investment) => {
    const payouts = investment.schedule.filter((payout) => payout.financialYear === financialYear);
    return {
      investment,
      expected: payouts.reduce((sum, payout) => sum + payout.expectedTdsPaise, 0n),
      actual: payouts.reduce((sum, payout) => sum + (payout.actualTdsPaise ?? 0n), 0n),
      reflected: payouts.reduce((sum, payout) => sum + (payout.reflectedAmountPaise ?? 0n), 0n),
      verifiedCount: payouts.filter((payout) => payout.tdsVerificationDate).length,
      mismatch: payouts.some((payout) => payout.tdsStatus === "mismatch"),
    };
  }).filter((row) => row.expected > 0n || row.actual > 0n || row.reflected > 0n);
  const expected = rows.reduce((sum, row) => sum + row.expected, 0n);
  const actual = rows.reduce((sum, row) => sum + row.actual, 0n);
  const reflected = rows.reduce((sum, row) => sum + row.reflected, 0n);
  const difference = absolute(actual - reflected);

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">{financialYear}</p><h1>TDS reconciliation</h1></div></header>
      <div className="tds-metric-grid">
        <div><span>Expected TDS</span><strong>{formatMoney(expected)}</strong><small>From calculated payouts</small></div>
        <div><span>Actual deducted</span><strong>{formatMoney(actual)}</strong><small>Entered with payout confirmation</small></div>
        <div><span>PAN reflected</span><strong>{formatMoney(reflected)}</strong><small>Verified by you</small></div>
        <div className={difference > 0n ? "danger" : ""}><span>Difference</span><strong>{formatMoney(difference)}</strong><small>{difference > 0n ? "Needs verification" : "No recorded mismatch"}</small></div>
      </div>
      <div className="section-heading"><div><h2>Investment reconciliation</h2><p>Calculated values never count as verified credit</p></div></div>
      <div className="simple-list">
        {rows.map((row) => {
          const status = row.mismatch ? "Mismatch" : row.verifiedCount ? "Matched" : "Pending";
          return <button className="simple-row tds-row simple-row-button" key={row.investment.id} onClick={() => onOpenInvestment(row.investment.id)}>
            <span className="row-icon"><ReceiptIndianRupee /></span>
            <span className="row-copy"><b>{row.investment.issuer}</b><small>Expected {formatMoney(row.expected)} · Deducted {formatMoney(row.actual)}</small></span>
            <span className="row-value"><small>PAN reflected</small><b>{formatMoney(row.reflected)}</b></span>
            <Badge className={status === "Matched" ? "status-received" : status === "Mismatch" ? "status-mismatch" : "status-pending"}>{status}</Badge>
          </button>;
        })}
        {!rows.length && <InlineEmpty icon={ReceiptIndianRupee} title="No TDS records" detail={`No TDS data is available for ${financialYear}.`} />}
      </div>
      <div className="data-principle"><ShieldCheck /><p><strong>Verification rule.</strong> TDS is shown as reflected only after you confirm it from your tax record.</p></div>
    </div>
  );
}

export function ProfileScreen({ displayName, email }: { displayName: string; email: string }) {
  return (
    <div className="screen secondary-screen profile-screen">
      <header className="screen-header"><div><p className="screen-kicker">Account</p><h1>Profile & security</h1></div></header>
      <section className="profile-card">
        <span className="profile-avatar"><UserRound /></span>
        <div><h2>{displayName}</h2><p>Secure ChatGPT sign-in</p></div>
        <Badge className="status-received"><CheckCircle2 /> Authenticated</Badge>
        <div className="profile-details"><span><small>Email</small><b>{email}</b></span><span><small>Portfolio access</small><b>Private to this account</b></span><span><small>PAN</small><b>Not stored in this version</b></span></div>
      </section>
      <section className="settings-card"><div className="section-heading"><div><h2>Data protection</h2><p>Your financial records use account-level ownership checks</p></div><ShieldCheck /></div><div className="security-list"><span>Encrypted connection <b>Active</b></span><span>Cloud database <b>Active</b></span><span>Document access <b>Private</b></span></div></section>
      <Button asChild variant="outline"><a href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut /> Sign out</a></Button>
    </div>
  );
}

function InlineEmpty({ icon: Icon, title, detail }: { icon: typeof CalendarClock; title: string; detail: string }) { return <div className="inline-empty"><Icon /><span><b>{title}</b><small>{detail}</small></span></div>; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function absolute(value: bigint) { return value < 0n ? -value : value; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function labelStatus(value: string) { return value.split("-").map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" "); }
