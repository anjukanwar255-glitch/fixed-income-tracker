export type InvestmentType =
  | "fixed-deposit"
  | "corporate-fd"
  | "corporate-bond"
  | "government-bond"
  | "ncd"
  | "debenture"
  | "government-security"
  | "other"
  | "stocks"
  | "mutual-fund-lumpsum"
  | "mutual-fund-sip"
  | "insurance"
  | "term-insurance";

/**
 * What a holding fundamentally is, which decides how it behaves rather than
 * merely how it is labelled: whether it earns a stated rate, whether it is
 * held in units whose price moves, and whether it is paid for over time.
 */
export type AssetClass = "fixed-income" | "equity" | "mutual-fund" | "insurance";

/** How often money is put in — a SIP instalment or an insurance premium. */
export type ContributionFrequency = "monthly" | "quarterly" | "half-yearly" | "yearly" | "single";

export type ContributionStatus = "upcoming" | "due-today" | "paid" | "missed" | "overdue";

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
  /** Empty for an open-ended holding such as a stock or a fund. */
  maturityDate: string;
  expectedMaturityPaise?: bigint;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
}

/**
 * What a unit-priced holding is made of. A stock or a fund is not owed a
 * return, so there is nothing to project: what it is worth comes from the
 * number of units and a price that has to be told to the app.
 */
export interface UnitHolding {
  units?: number;
  costPerUnitPaise?: bigint;
  /** Last price or NAV entered, with the date it was true on. */
  currentPricePerUnitPaise?: bigint;
  valuationDate?: string;
}

/**
 * What is paid in over time — a SIP instalment or an insurance premium — and,
 * for a policy, what it buys.
 */
export interface ContributionTerms {
  contributionPaise?: bigint;
  contributionFrequency?: ContributionFrequency;
  contributionStartDate?: string;
  /** Last instalment or premium due; open-ended when absent. */
  contributionEndDate?: string;
  sumAssuredPaise?: bigint;
  policyNumber?: string;
}

/** One instalment or premium, and whether it was actually paid. */
export interface ContributionEntry {
  id: string;
  dueDate: string;
  financialYear: string;
  amountPaise: bigint;
  status: ContributionStatus;
  paidAmountPaise?: bigint;
  paidDate?: string;
  paymentReference?: string;
  remarks?: string;
}

export interface PayoutProjection {
  id: string;
  dueDate: string;
  financialYear: string;
  grossInterestPaise: bigint;
  /**
   * Principal returned with this payment. Zero for a bond that repays
   * everything at the end, and the reason an amortising schedule cannot be
   * worked out from a rate alone: each repayment shrinks the balance the next
   * coupon is calculated on, so the issuer's own schedule is the only
   * authority for it.
   */
  principalRepaidPaise: bigint;
  expectedTdsPaise: bigint;
  /** What should land in the bank: interest after TDS, plus any principal. */
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

/** One row of an issuer's repayment schedule, as printed. */
export interface RepaymentRow {
  dueDate: string;
  interestPaise: bigint;
  principalPaise: bigint;
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

export interface PortfolioInvestment extends InvestmentDraft, UnitHolding, ContributionTerms {
  id: string;
  status: "active" | "matured" | "closed" | "draft";
  schedule: PayoutProjection[];
  contributions: ContributionEntry[];
  documents: InvestmentDocument[];
  forms: InvestmentForm[];
  activity: InvestmentActivity[];
  panLinked?: boolean;
  declarationApplicable?: boolean;
  bankName?: string;
  /** IFSC of the receiving branch. Identifies bank and branch in one code. */
  ifscCode?: string;
  /** Full receiving account number. Masked wherever it is shown. */
  accountNumber?: string;
  paymentMode?: string;
  nominee?: string;
  brokerPlatform?: string;
  advisorName?: string;
  /** Ten-digit Indian mobile for the advisor, for chasing a missed payout. */
  advisorMobile?: string;
  /**
   * Demat and trade references, as printed on a broker's deal sheet. Kept for
   * reconciling a holding against the broker and the depository — the DP and
   * client ids identify the demat account the security actually sits in, and
   * the order reference identifies this trade within it.
   */
  dpId?: string;
  clientId?: string;
  orderReference?: string;
  notes?: string;
}
