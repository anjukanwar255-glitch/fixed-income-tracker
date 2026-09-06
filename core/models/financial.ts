export type InvestmentType =
  | "fixed-deposit"
  | "corporate-fd"
  | "corporate-bond"
  | "government-bond"
  | "ncd"
  | "debenture"
  | "government-security"
  | "other";

export type PayoutFrequency =
  | "monthly"
  | "quarterly"
  | "half-yearly"
  | "yearly"
  | "on-maturity"
  | "custom";

export type InterestType = "simple" | "compound" | "cumulative";

export type PayoutStatus =
  | "upcoming"
  | "due-today"
  | "pending-confirmation"
  | "received"
  | "not-received"
  | "partial-received"
  | "overdue";

export type TdsStatus = "matched" | "pending" | "mismatch" | "not-verified";

export interface InvestmentDraft {
  type: InvestmentType;
  name: string;
  issuer: string;
  investmentNumber: string;
  investmentDate: string;
  principalPaise: bigint;
  annualRateBps: number;
  interestType: InterestType;
  payoutFrequency: PayoutFrequency;
  firstPayoutDate: string;
  maturityDate: string;
  expectedMaturityPaise?: bigint;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
}

export interface PayoutProjection {
  id: string;
  dueDate: string;
  financialYear: string;
  grossInterestPaise: bigint;
  expectedTdsPaise: bigint;
  expectedNetPaise: bigint;
  status: PayoutStatus;
}

export interface PortfolioInvestment extends InvestmentDraft {
  id: string;
  status: "active" | "matured" | "closed" | "draft";
  schedule: PayoutProjection[];
}
