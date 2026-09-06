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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

type DashboardProps = {
  displayName: string;
  financialYear: string;
  investments: PortfolioInvestment[];
  onFinancialYearChange: (value: string) => void;
  onOpenInvestment: (id: string) => void;
  onViewInvestments: () => void;
};

export function DashboardScreen({
  displayName,
  financialYear,
  investments,
  onFinancialYearChange,
  onOpenInvestment,
  onViewInvestments,
}: DashboardProps) {
  const totalPrincipal = investments.reduce((sum, item) => sum + item.principalPaise, 0n);
  const fyPayouts = investments.flatMap((investment) =>
    investment.schedule
      .filter((payout) => payout.financialYear === financialYear)
      .map((payout) => ({ ...payout, investment })),
  );
  const expectedInterest = fyPayouts.reduce((sum, payout) => sum + payout.grossInterestPaise, 0n);
  const expectedTds = fyPayouts.reduce((sum, payout) => sum + payout.expectedTdsPaise, 0n);
  const receivedInterest = 12_000_000n;
  const pendingInterest = expectedInterest > receivedInterest ? expectedInterest - receivedInterest : 0n;
  const upcoming = fyPayouts
    .filter((payout) => payout.dueDate >= "2026-09-06")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);

  const metrics = [
    { label: "Active investment", value: formatMoney(totalPrincipal), icon: Landmark, tone: "navy" },
    { label: "Expected interest", value: formatMoney(expectedInterest), icon: TrendingUp, tone: "cyan" },
    { label: "Interest received", value: formatMoney(receivedInterest), icon: CheckCircle2, tone: "green" },
    { label: "Pending interest", value: formatMoney(pendingInterest), icon: Clock3, tone: "amber" },
    { label: "TDS deducted", value: formatMoney(1_200_000n), icon: ReceiptIndianRupee, tone: "violet" },
    { label: "TDS pending credit", value: formatMoney(expectedTds > 1_200_000n ? expectedTds - 1_200_000n : 250_000n), icon: ShieldCheck, tone: "red" },
  ];

  return (
    <div className="screen dashboard-screen">
      <header className="screen-header dashboard-header">
        <div>
          <p className="screen-kicker">Good morning</p>
          <h1>Welcome, {displayName.split(" ")[0]}</h1>
        </div>
        <Select value={financialYear} onValueChange={onFinancialYearChange}>
          <SelectTrigger className="fy-select" aria-label="Financial year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FY 2025-26">FY 2025-26</SelectItem>
            <SelectItem value="FY 2026-27">FY 2026-27</SelectItem>
            <SelectItem value="FY 2027-28">FY 2027-28</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <section className="portfolio-hero" aria-label="Portfolio summary">
        <div className="hero-topline">
          <span>Portfolio value</span>
          <Badge className="live-badge"><span className="live-dot" />Updated now</Badge>
        </div>
        <strong>{formatMoney(totalPrincipal)}</strong>
        <div className="hero-breakdown">
          <div><span>Investments</span><b>{investments.length} active</b></div>
          <div><span>Next maturity</span><b>₹7.5L · Nov 2028</b></div>
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
        </div>
      </section>

      <section className="content-section attention-section">
        <div className="section-heading">
          <div>
            <h2>Attention required</h2>
            <p>Items that need your confirmation</p>
          </div>
          <span className="attention-count">4</span>
        </div>
        <div className="attention-grid">
          <AttentionItem tone="red" icon={AlertTriangle} title="1 payout not received" detail="Follow up with issuer" />
          <AttentionItem tone="orange" icon={ReceiptIndianRupee} title="₹2,500 TDS mismatch" detail="Verify PAN credit" />
          <AttentionItem tone="yellow" icon={FileWarning} title="2 forms pending" detail="FY 2026-27" />
          <AttentionItem tone="slate" icon={CalendarClock} title="1 maturity approaching" detail="Within 90 days" />
        </div>
      </section>

      <div className="data-principle">
        <BadgeIndianRupee aria-hidden="true" />
        <p><strong>Clear by design.</strong> Expected amounts are calculations. Received and PAN-verified amounts are only marked after your confirmation.</p>
      </div>
    </div>
  );
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
