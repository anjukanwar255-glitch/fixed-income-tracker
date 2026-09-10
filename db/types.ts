/**
 * Firestore document shapes.
 *
 * These mirror the SQLite tables they replace, with three deliberate changes:
 *
 * - `users.authSubject` is gone. It always held the same value as `users.id`
 *   (the Firebase uid), and the uid is now the document id, so the column and
 *   its unique index were pure duplication.
 * - `userId` is gone from user-owned documents. Ownership is the document's
 *   path (`users/{uid}/...`) rather than a field every query must remember to
 *   filter on.
 * - Money stays in integer paise and rates in basis points, exactly as before.
 *   Firestore numbers are doubles, so no value here may ever become a rupee
 *   float.
 *
 * Timestamps are ISO 8601 strings rather than Firestore Timestamps, so the
 * encrypted backup format and every date comparison behave as they do today.
 */

/** Present on every document that supports soft deletion. */
export interface Timestamps {
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type UserRole = "user" | "support" | "admin";

export interface UserDoc extends Timestamps {
  /** The Firebase uid. Duplicated from the document id so reads carry it. */
  id: string;
  fullName: string;
  /** Full E.164 number, e.g. `+919876543210`. Masked at render, never logged. */
  mobileE164?: string | null;
  email?: string | null;
  panCiphertext?: string | null;
  panMasked?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  profilePhotoKey?: string | null;
  role: UserRole;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}

export interface InvestmentDoc extends Timestamps {
  id: string;
  issuerId?: string | null;
  investmentTypeId?: string | null;
  investmentType: string;
  investmentName: string;
  issuerNameSnapshot: string;
  investmentNumber: string;
  /** What was paid, including any premium and accrued interest. */
  principalPaise: number;
  /**
   * The amount interest is paid on, when it differs from what was paid — a
   * bond bought on the secondary market. Absent on deposits bought at par.
   */
  faceValuePaise?: number | null;
  interestRateBps: number;
  interestType: string;
  compoundingFrequency: string;
  dayCountBasis: string;
  payoutFrequency: string;
  investmentDate: string;
  /**
   * When interest starts accruing, when that is not the purchase date — a
   * secondary-market purchase settles part-way through a coupon period.
   */
  interestStartDate?: string | null;
  firstPayoutDate?: string | null;
  maturityDate: string;
  expectedMaturityPaise?: number | null;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
  panLinked: boolean;
  declarationApplicable: boolean;
  bankName?: string | null;
  /** Full receiving account number. Masked wherever it is shown. */
  ifscCode?: string | null;
  accountNumber?: string | null;
  paymentMode?: string | null;
  nominee?: string | null;
  brokerPlatform?: string | null;
  /** Demat and trade references from a broker deal sheet. */
  dpId?: string | null;
  clientId?: string | null;
  orderReference?: string | null;
  advisorName?: string | null;
  advisorMobile?: string | null;
  notes?: string | null;
  status: string;
  financialYear: string;
  revision: number;
}

export interface PayoutScheduleDoc extends Timestamps {
  id: string;
  investmentId: string;
  dueDate: string;
  financialYear: string;
  grossInterestPaise: number;
  /** Principal returned with this payment; absent on rows written before amortising schedules were stored. */
  principalRepaidPaise?: number | null;
  expectedTdsRateBps: number;
  expectedTdsPaise: number;
  expectedNetPaise: number;
  status: string;
  source: string;
  revision: number;
}

export interface PayoutTransactionDoc extends Timestamps {
  id: string;
  payoutScheduleId: string;
  investmentId: string;
  receivedAmountPaise?: number | null;
  receivedDate?: string | null;
  actualTdsPaise?: number | null;
  /** How much of the credit was principal, so interest totals stay interest. */
  principalRepaidPaise?: number | null;
  /** Full account the credit landed in. Older records hold only the last four digits, under `bankAccountLast4`. */
  bankAccountNumber?: string | null;
  bankAccountLast4?: string | null;
  paymentReference?: string | null;
  proofObjectKey?: string | null;
  status: string;
  followUpDate?: string | null;
  remarks?: string | null;
}

export interface TdsRecordDoc extends Timestamps {
  id: string;
  investmentId: string;
  payoutScheduleId?: string | null;
  financialYear: string;
  grossInterestPaise: number;
  expectedTdsRateBps: number;
  expectedTdsPaise: number;
  actualTdsPaise?: number | null;
  tdsReflected?: boolean | null;
  reflectedAmountPaise?: number | null;
  differencePaise?: number | null;
  verificationDate?: string | null;
  certificateReceived: boolean;
  verificationDocumentKey?: string | null;
  status: string;
  remarks?: string | null;
}

export interface FormDoc extends Timestamps {
  id: string;
  investmentId: string;
  formType: string;
  financialYear: string;
  required: boolean;
  submitted: boolean;
  submissionDate?: string | null;
  accepted?: boolean | null;
  acknowledgementNumber?: string | null;
  expiryDate?: string | null;
  documentObjectKey?: string | null;
  status: string;
  remarks?: string | null;
}

export interface DocumentDoc extends Timestamps {
  id: string;
  investmentId?: string | null;
  documentName: string;
  documentType: string;
  financialYear?: string | null;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  sha256?: string | null;
  validationStatus: string;
  validatedAt?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  version: number;
}

export type PlanCode = "monthly" | "half-yearly" | "yearly";

export interface SubscriptionDoc extends Timestamps {
  id: string;
  /**
   * Denormalised so the Razorpay webhook, which knows only the provider id,
   * can find the owner through a collection group query.
   */
  userId: string;
  provider: string;
  providerSubscriptionId?: string | null;
  providerCustomerId?: string | null;
  planCode: PlanCode;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: string | null;
}

export interface BackupRunDoc {
  id: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  status: string;
  failureReason?: string | null;
  createdAt: string;
}

export interface NotificationDoc extends Timestamps {
  id: string;
  category: string;
  title: string;
  body: string;
  scheduledFor?: string | null;
  readAt?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

export interface ActivityLogDoc {
  id: string;
  investmentId?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  previousSnapshot?: string | null;
  nextSnapshot?: string | null;
  createdAt: string;
}

/* Shared reference data. These are not user-owned and live at the root. */

export interface IssuerDoc extends Timestamps {
  id: string;
  name: string;
  issuerType?: string | null;
  contactNotes?: string | null;
  isActive: boolean;
}

export interface InvestmentTypeDoc extends Timestamps {
  /** The document id is the code, which is what the unique index enforced. */
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
}

export interface FinancialYearDoc extends Timestamps {
  /** The document id is the label, which is what the unique index enforced. */
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isClosed: boolean;
}

export interface AdminSettingDoc extends Timestamps {
  id: string;
  settingType: string;
  investmentType?: string | null;
  investorCategory?: string | null;
  financialYear?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  valueJson: string;
  isActive: boolean;
}

/**
 * Written with `create()` under the document id `{provider}__{providerEventId}`
 * so a replayed webhook fails instead of being processed twice. That id is the
 * replacement for the old unique index on (provider, providerEventId).
 */
export interface BillingEventDoc {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  providerSubscriptionId?: string | null;
  payloadSha256: string;
  processingStatus: string;
  processedAt: string;
  createdAt: string;
}

/**
 * Pseudonymous one-trial claim, keyed by identity hash. Retained after account
 * deletion to prevent repeated free-trial abuse, so it must stay outside the
 * user subtree that account deletion removes.
 */
export interface TrialClaimDoc {
  identityHash: string;
  originalUserId: string;
  claimedAt: string;
}
