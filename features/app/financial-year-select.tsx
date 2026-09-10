"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateFinancialYear } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

/**
 * The years worth offering: the one running now, plus every year a holding
 * was bought in or has a payout falling in. A year nothing happened in is
 * left out — it would only ever show an empty screen.
 */
export function financialYearsFor(investments: PortfolioInvestment[], today: string) {
  return Array.from(new Set([
    calculateFinancialYear(today),
    ...investments.map((item) => calculateFinancialYear(item.investmentDate)),
    ...investments.flatMap((item) => item.schedule.map((payout) => payout.financialYear)),
  ])).sort().reverse();
}

export function FinancialYearSelect({ value, years, onChange }: { value: string; years: string[]; onChange: (year: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="fy-select" aria-label="Financial year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => <SelectItem value={year} key={year}>{year}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Whether a holding was live at any point during the financial year. */
export function activeInFinancialYear(investment: PortfolioInvestment, financialYear: string) {
  const startYear = Number(financialYear.slice(0, 4));
  if (!Number.isFinite(startYear)) return true;
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return investment.investmentDate <= end && investment.maturityDate >= start;
}
