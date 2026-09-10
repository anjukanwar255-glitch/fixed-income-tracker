"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  BadgeIndianRupee,
  Clock3,
  FileWarning,
  Landmark,
  ReceiptIndianRupee,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { declarationPending } from "@/core/tax/declarations";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

type DashboardProps = {
  displayName: string;
  financialYear: string;
  investments: PortfolioInvestment[];
  onOpenInvestment: (id: string) => void;
  onViewInvestments: () => void;
  onAddInvestment: () => void;
};

export function DashboardScreen({
  displayName,
  financialYear,
  investments,
  onOpenInvestment,
  onViewInvestments,
  onAddInvestment,
}: DashboardProps) {
  const today = new Date().toISOString().slice(0, 10);
  const totalPrincipal = investments.filter((item) => item.status === "active").reduce((sum, item) => sum + item.principalPaise, 0n);
  const fyPayouts = investments.flatMap((investment) =>
    investment.schedule
      .filter((payout) => payout.financialYear === financialYear)
      .map((payout) => ({ ...payout, investment })),
  );
  const expectedInterest = fyPayouts.reduce((sum, payout) => sum + payout.grossInterestPaise, 0n);
  const receivedPayouts = fyPayouts.filter((payout) => payout.status === "received" || payout.status === "partial-received");
  const receivedInterest = receivedPayouts.reduce((sum, payout) => sum + (payout.receivedAmountPaise ?? 0n) + (payout.actualTdsPaise ?? 0n), 0n);
  const pendingInterest = expectedInterest > receivedInterest ? expectedInterest - receivedInterest : 0n;
  const actualTds = receivedPayouts.reduce((sum, payout) => sum + (payout.actualTdsPaise ?? 0n), 0n);
  const reflectedTds = fyPayouts.reduce((sum, payout) => sum + (payout.reflectedAmountPaise ?? 0n), 0n);
  const upcoming = fyPayouts
    .filter((payout) => payout.status === "upcoming" || payout.status === "due-today" || payout.status === "overdue")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);
  const nextMaturity = investments.filter((item) => item.status === "active" && item.maturityDate >= today).sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))[0];
  const overdueCount = fyPayouts.filter((payout) => payout.status === "overdue" || payout.status === "not-received").length;
  const tdsMismatch = fyPayouts.reduce((sum, payout) => payout.tdsStatus === "mismatch"
    ? sum + absolute((payout.actualTdsPaise ?? payout.expectedTdsPaise) - (payout.reflectedAmountPaise ?? 0n))
    : sum, 0n);
  const pendingForms = investments.filter((item) => declarationPending(item, financialYear)).length;
  const ninetyDaysFromNow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  const maturityCount = investments.filter((item) => item.status === "active" && item.maturityDate >= today && item.maturityDate <= ninetyDaysFromNow).length;
  const attentionCount = overdueCount + (tdsMismatch > 0n ? 1 : 0) + pendingForms + maturityCount;

  const metrics = [
    { label: "Active investment", value: formatMoney(totalPrincipal), icon: Landmark, tone: "navy" },
    { label: "Expected interest", value: formatMoney(expectedInterest), icon: TrendingUp, tone: "cyan" },
    { label: "Interest received", value: formatMoney(receivedInterest), icon: CheckCircle2, tone: "green" },
    { label: "Pending interest", value: formatMoney(pendingInterest), icon: Clock3, tone: "amber" },
    { label: "TDS deducted", value: formatMoney(actualTds), icon: ReceiptIndianRupee, tone: "violet" },
    { label: "TDS pending credit", value: formatMoney(actualTds > reflectedTds ? actualTds - reflectedTds : 0n), icon: ShieldCheck, tone: "red" },
  ];

  return (
    <div className="screen dashboard-screen">
      <header className="screen-header dashboard-header">
        <div>
          <p className="screen-kicker">{greeting()}</p>
          <h1>Welcome, {displayName.split(" ")[0]}</h1>
        </div>
      </header>

      {!investments.length && (
        <div className="empty-state dashboard-empty">
          <span><Landmark aria-hidden="true" /></span>
          <h2>No investments added yet</h2>
          <p>Add your first FD or bond to generate its payout and TDS schedule.</p>
          <Button onClick={onAddInvestment}>Add your first investment</Button>
        </div>
      )}

      {investments.length > 0 && <><section className="portfolio-hero" aria-label="Portfolio summary">
        <div className="hero-topline">
          <span>Portfolio value</span>
          <Badge className="live-badge"><span className="live-dot" />Updated now</Badge>
        </div>
        <strong>{formatMoney(totalPrincipal)}</strong>
        <div className="hero-breakdown">
          <div><span>Investments</span><b>{investments.length} active</b></div>
          <div><span>Next maturity</span><b>{nextMaturity ? `${formatMoney(nextMaturity.expectedMaturityPaise ?? nextMaturity.principalPaise)} · ${formatDate(nextMaturity.maturityDate)}` : "—"}</b></div>
        </div>
        <div className="hero-glow" aria-hidden="true" />
      </section>

      <section className="metric-grid" aria-label="Financial year summary">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <Card className="metric-card" key={label}>
            <CardContent>
              <span className={`metric-icon metric-${tone}`}><Icon aria-hidden="true" /></span>
              <span className="metric-label">{label}</span>
              <strong>{value}</strong>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Upcoming payouts</h2>
            <p>Expected amounts — confirm after bank credit</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onViewInvestments}>View all <ArrowUpRight /></Button>
        </div>

        <div className="payout-list">
          {upcoming.map((payout) => (
            <button className="payout-row" key={`${payout.investment.id}-${payout.id}`} onClick={() => onOpenInvestment(payout.investment.id)}>
              <span className="issuer-avatar">{payout.investment.issuer.slice(0, 1)}</span>
              <span className="payout-copy">
                <b>{payout.investment.name}</b>
                <span>{payout.investment.issuer} · {formatDate(payout.dueDate)}</span>
              </span>
              <span className="payout-amount">
                <b>{formatMoney(payout.expectedNetPaise)}</b>
                <span>{formatMoney(payout.grossInterestPaise)} gross</span>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
          {!upcoming.length && <div className="inline-empty"><CalendarClock /><span><b>No upcoming payouts</b><small>No expected payout is scheduled in this financial year.</small></span></div>}
        </div>
      </section>

      <section className="content-section attention-section">
        <div className="section-heading">
          <div>
            <h2>Attention required</h2>
            <p>Items that need your confirmation</p>
          </div>
          <span className="attention-count">{attentionCount}</span>
        </div>
        <div className="attention-grid">
          {overdueCount > 0 && <AttentionItem tone="red" icon={AlertTriangle} title={`${overdueCount} payout${overdueCount === 1 ? "" : "s"} need attention`} detail="Confirm receipt or follow up" />}
          {tdsMismatch > 0n && <AttentionItem tone="orange" icon={ReceiptIndianRupee} title={`${formatMoney(tdsMismatch)} TDS mismatch`} detail="Review verified PAN credit" />}
          {pendingForms > 0 && <AttentionItem tone="yellow" icon={FileWarning} title={`${pendingForms} form${pendingForms === 1 ? "" : "s"} pending`} detail={financialYear} />}
          {maturityCount > 0 && <AttentionItem tone="slate" icon={CalendarClock} title={`${maturityCount} maturity approaching`} detail="Within 90 days" />}
          {attentionCount === 0 && <div className="inline-empty"><CheckCircle2 /><span><b>Nothing needs attention</b><small>Your recorded items are up to date.</small></span></div>}
        </div>
      </section>

      <div className="data-principle">
        <BadgeIndianRupee aria-hidden="true" />
        <p><strong>Clear by design.</strong> Expected amounts are calculations. Received and PAN-verified amounts are only marked after your confirmation.</p>
      </div>
      </>}
    </div>
  );
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function AttentionItem({ tone, icon: Icon, title, detail }: { tone: string; icon: typeof AlertTriangle; title: string; detail: string }) {
  return (
    <button className={`attention-item attention-${tone}`}>
      <span className="attention-icon"><Icon aria-hidden="true" /></span>
      <span><b>{title}</b><small>{detail}</small></span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** The visitor's local hour, not the server's — the server is in another timezone. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
