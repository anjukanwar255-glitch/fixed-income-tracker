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
export type CompoundingFrequency = "monthly" | "quarterly" | "half-yearly" | "yearly";
export type DayCountBasis = "actual-365" | "actual-actual" | "30-360";

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
  /** What was actually paid, including any premium and accrued interest. */
  principalPaise: bigint;
  /**
   * The amount the issuer pays interest on, when that differs from what was
   * paid. A bond bought on the secondary market settles at a price carrying
   * the seller's accrued interest and any premium or discount, but the coupon
   * is always calculated on face value. Left unset for a deposit bought at
   * par, where `principalPaise` is the same thing.
   */
  faceValuePaise?: bigint;
  annualRateBps: number;
  interestType: InterestType;
  compoundingFrequency: CompoundingFrequency;
  dayCountBasis: DayCountBasis;
  payoutFrequency: PayoutFrequency;
  /**
   * When interest starts accruing, when that is not the purchase date. A
   * secondary-market purchase settles part-way through a coupon period: the
   * buyer pays the seller the interest accrued so far and then collects the
   * whole coupon, so the first period runs from the previous coupon date
   * rather than from settlement. Left unset for a deposit, where interest
   * starts the day it is placed.
   */
  interestStartDate?: string;
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
  receivedAmountPaise?: bigint;
  receivedDate?: string;
  actualTdsPaise?: bigint;
  paymentReference?: string;
  payoutRemarks?: string;
  followUpDate?: string;
  tdsReflected?: boolean;
  reflectedAmountPaise?: bigint;
  tdsVerificationDate?: string;
  tdsStatus?: TdsStatus;
}

export interface InvestmentDocument {
  id: string;
  documentName: string;
  documentType: string;
  financialYear?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface InvestmentForm {
  id: string;
  formType: string;
  financialYear: string;
  status: string;
  submissionDate?: string;
}

export interface InvestmentActivity {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

export interface PortfolioInvestment extends InvestmentDraft {
  id: string;
  status: "active" | "matured" | "closed" | "draft";
  schedule: PayoutProjection[];
  documents: InvestmentDocument[];
  forms: InvestmentForm[];
  activity: InvestmentActivity[];
  panLinked?: boolean;
  declarationApplicable?: boolean;
  bankName?: string;
  accountLast4?: string;
  paymentMode?: string;
  nominee?: string;
  brokerPlatform?: string;
  advisorName?: string;
  notes?: string;
}
