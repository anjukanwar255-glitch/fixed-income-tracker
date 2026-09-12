"use client";

import { useMemo, useState } from "react";
import { CalendarRange, TrendingUp } from "lucide-react";

import { IssuerMark } from "@/components/issuer-mark";
import { formatMoney } from "@/core/finance/calculations";
import { annualisedReturn, monthlyCashflow, portfolioFlows } from "@/core/finance/cashflow";
import type { PortfolioInvestment } from "@/core/models/financial";

const WINDOW_MONTHS = 6;

/**
 * What the portfolio pays out over the months ahead, and what it is earning.
 *
 * The payout list answers "what is next"; a list cannot show shape. Reading
 * twelve rows tells you nothing about whether next quarter is thin or whether
 * one month carries a maturity — which is the question anyone planning around
 * this money is actually asking.
 *
 * The rate beside it is not the coupon. A coupon says what a holding pays; this
 * says what the money has actually earned once the dates it arrives on are
 * counted, across everything held.
 */
export function CashflowStrip({ investments, onOpenInvestment }: {
  investments: PortfolioInvestment[];
  onOpenInvestment: (id: string) => void;
}) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<string | null>(null);

  const months = useMemo(
    () => monthlyCashflow(investments, today, WINDOW_MONTHS),
    [investments, today],
  );
  const rate = useMemo(() => annualisedReturn(portfolioFlows(investments)), [investments]);

  const total = months.reduce((sum, month) => sum + month.expectedPaise, 0n);
  // The tallest month sets the scale, so the bars compare with each other
  // rather than with a number nobody chose.
  const peak = months.reduce((high, month) => (month.expectedPaise > high ? month.expectedPaise : high), 0n);
  const open = selected ?? months.find((month) => month.count > 0)?.month ?? months[0]?.month ?? null;

  const openRows = useMemo(() => {
    if (!open) return [];
    return investments
      .flatMap((investment) => investment.schedule.map((payout) => ({ investment, payout })))
      .filter(({ payout }) => payout.dueDate.slice(0, 7) === open.slice(0, 7))
      .sort((a, b) => a.payout.dueDate.localeCompare(b.payout.dueDate));
  }, [investments, open]);

  if (!months.some((month) => month.count > 0)) return null;

  return (
    <section className="cashflow-card" aria-label="Cash flow ahead">
      <header className="cashflow-head">
        <div>
          <span className="cashflow-kicker"><CalendarRange aria-hidden="true" /> Next {WINDOW_MONTHS} months</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        {rate !== null && (
          <div className="cashflow-rate">
            <TrendingUp aria-hidden="true" />
            <span><small>Portfolio return</small><b>{(rate * 100).toFixed(2)}%</b></span>
          </div>
        )}
      </header>

      <div className="cashflow-months" role="tablist" aria-label="Month">
        {months.map((month) => {
          const share = peak > 0n ? Number((month.expectedPaise * 100n) / peak) : 0;
          const isOpen = month.month === open;
          return (
            <button
              key={month.month}
              role="tab"
              aria-selected={isOpen}
              className="cashflow-month"
              data-open={isOpen || undefined}
              data-empty={month.count === 0 || undefined}
              onClick={() => setSelected(month.month)}
            >
              <span className="cashflow-amount">{month.count ? compact(month.expectedPaise) : "—"}</span>
              {/* The bar sits under the figure rather than carrying it, so a
                  quiet month still reads as a month and not as a gap. */}
              <span className="cashflow-bar"><i style={{ height: `${Math.max(share, month.count ? 6 : 0)}%` }} /></span>
              <span className="cashflow-label">{month.label}</span>
            </button>
          );
        })}
      </div>

      <div className="cashflow-rows">
        {openRows.map(({ investment, payout }) => (
          <button className="cashflow-row" key={`${investment.id}-${payout.id}`} onClick={() => onOpenInvestment(investment.id)}>
            <IssuerMark name={investment.issuer || investment.name} website={investment.issuerWebsite} size="sm" />
            <span className="cashflow-row-copy"><b>{investment.name}</b><small>{formatDate(payout.dueDate)}</small></span>
            <span className="cashflow-row-value">{formatMoney(payout.receivedAmountPaise ?? payout.expectedNetPaise)}</span>
          </button>
        ))}
        {!openRows.length && <p className="cashflow-empty">Nothing falls due this month.</p>}
      </div>
    </section>
  );
}

/** Lakhs and thousands, because six of these have to sit side by side. */
function compact(paise: bigint) {
  const rupees = Number(paise) / 100;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
