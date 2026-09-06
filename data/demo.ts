import type { PortfolioInvestment } from "@/core/models/financial";
import { generatePayoutSchedule } from "@/core/finance/calculations";

const bondDraft = {
  type: "corporate-bond" as const,
  name: "Capital Growth Bond 2031",
  issuer: "ABC Finance Ltd",
  investmentNumber: "ABF-2048-91",
  investmentDate: "2026-04-01",
  principalPaise: 100_000_000n,
  annualRateBps: 900,
  interestType: "simple" as const,
  payoutFrequency: "quarterly" as const,
  firstPayoutDate: "2026-06-30",
  maturityDate: "2031-04-01",
  expectedMaturityPaise: 100_000_000n,
  tdsApplicable: true,
  expectedTdsRateBps: 1000,
};

const fdDraft = {
  type: "corporate-fd" as const,
  name: "Secure Income FD",
  issuer: "Northstar Housing Finance",
  investmentNumber: "NHF-9821-44",
  investmentDate: "2025-11-15",
  principalPaise: 75_000_000n,
  annualRateBps: 825,
  interestType: "simple" as const,
  payoutFrequency: "monthly" as const,
  firstPayoutDate: "2025-12-15",
  maturityDate: "2028-11-15",
  expectedMaturityPaise: 75_000_000n,
  tdsApplicable: true,
  expectedTdsRateBps: 1000,
};

const ncdDraft = {
  type: "ncd" as const,
  name: "Infrastructure NCD",
  issuer: "Bharat Infra Credit",
  investmentNumber: "BIC-4300-18",
  investmentDate: "2026-01-10",
  principalPaise: 75_000_000n,
  annualRateBps: 940,
  interestType: "simple" as const,
  payoutFrequency: "yearly" as const,
  firstPayoutDate: "2027-01-10",
  maturityDate: "2029-01-10",
  expectedMaturityPaise: 75_000_000n,
  tdsApplicable: true,
  expectedTdsRateBps: 1000,
};

export const demoInvestments: PortfolioInvestment[] = [
  { ...bondDraft, id: "investment-abc", status: "active", schedule: generatePayoutSchedule(bondDraft) },
  { ...fdDraft, id: "investment-northstar", status: "active", schedule: generatePayoutSchedule(fdDraft) },
  { ...ncdDraft, id: "investment-bharat", status: "active", schedule: generatePayoutSchedule(ncdDraft) },
];
