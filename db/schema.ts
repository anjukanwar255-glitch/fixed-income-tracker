import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull(),
  fullName: text("full_name").notNull().default(""),
  mobileMasked: text("mobile_masked"),
  email: text("email"),
  panCiphertext: text("pan_ciphertext"),
  panMasked: text("pan_masked"),
  dateOfBirth: text("date_of_birth"),
  address: text("address"),
  profilePhotoKey: text("profile_photo_key"),
  role: text("role", { enum: ["user", "support", "admin"] }).notNull().default("user"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_users_auth_subject").on(table.authSubject),
]);

export const issuers = sqliteTable("issuers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  issuerType: text("issuer_type"),
  contactNotes: text("contact_notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("idx_issuers_name").on(table.name)]);

export const investmentTypes = sqliteTable("investment_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("uidx_investment_types_code").on(table.code)]);

export const financialYears = sqliteTable("financial_years", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [uniqueIndex("uidx_financial_years_label").on(table.label)]);

export const investments = sqliteTable("investments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  issuerId: text("issuer_id").references(() => issuers.id),
  investmentTypeId: text("investment_type_id").references(() => investmentTypes.id),
  investmentType: text("investment_type").notNull(),
  investmentName: text("investment_name").notNull(),
  issuerNameSnapshot: text("issuer_name_snapshot").notNull(),
  investmentNumber: text("investment_number").notNull().default(""),
  principalPaise: integer("principal_paise", { mode: "number" }).notNull(),
  interestRateBps: integer("interest_rate_bps").notNull(),
  interestType: text("interest_type").notNull(),
  payoutFrequency: text("payout_frequency").notNull(),
  investmentDate: text("investment_date").notNull(),
  firstPayoutDate: text("first_payout_date"),
  maturityDate: text("maturity_date").notNull(),
  expectedMaturityPaise: integer("expected_maturity_paise", { mode: "number" }),
  tdsApplicable: integer("tds_applicable", { mode: "boolean" }).notNull().default(false),
  expectedTdsRateBps: integer("expected_tds_rate_bps").notNull().default(0),
  panLinked: integer("pan_linked", { mode: "boolean" }).notNull().default(false),
  declarationApplicable: integer("declaration_applicable", { mode: "boolean" }).notNull().default(false),
  bankName: text("bank_name"),
  accountLast4: text("account_last4"),
  paymentMode: text("payment_mode"),
  nominee: text("nominee"),
  brokerPlatform: text("broker_platform"),
  advisorName: text("advisor_name"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  financialYear: text("financial_year").notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("idx_investments_user_status").on(table.userId, table.status),
  index("idx_investments_user_number").on(table.userId, table.investmentNumber),
  index("idx_investments_user_maturity").on(table.userId, table.maturityDate),
]);

export const payoutSchedules = sqliteTable("payout_schedules", {
  id: text("id").primaryKey(),
  investmentId: text("investment_id").notNull().references(() => investments.id),
  userId: text("user_id").notNull().references(() => users.id),
  dueDate: text("due_date").notNull(),
  financialYear: text("financial_year").notNull(),
  grossInterestPaise: integer("gross_interest_paise", { mode: "number" }).notNull(),
  expectedTdsRateBps: integer("expected_tds_rate_bps").notNull().default(0),
  expectedTdsPaise: integer("expected_tds_paise", { mode: "number" }).notNull().default(0),
  expectedNetPaise: integer("expected_net_paise", { mode: "number" }).notNull(),
  status: text("status").notNull().default("upcoming"),
  source: text("source").notNull().default("generated"),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("idx_payout_schedules_user_due").on(table.userId, table.dueDate),
  index("idx_payout_schedules_investment_due").on(table.investmentId, table.dueDate),
]);

export const payoutTransactions = sqliteTable("payout_transactions", {
  id: text("id").primaryKey(),
  payoutScheduleId: text("payout_schedule_id").notNull().references(() => payoutSchedules.id),
  investmentId: text("investment_id").notNull().references(() => investments.id),
  userId: text("user_id").notNull().references(() => users.id),
  receivedAmountPaise: integer("received_amount_paise", { mode: "number" }),
  receivedDate: text("received_date"),
  actualTdsPaise: integer("actual_tds_paise", { mode: "number" }),
  bankAccountLast4: text("bank_account_last4"),
  paymentReference: text("payment_reference"),
  proofObjectKey: text("proof_object_key"),
  status: text("status").notNull(),
  followUpDate: text("follow_up_date"),
  remarks: text("remarks"),
  ...timestamps,
}, (table) => [
  index("idx_payout_transactions_user_date").on(table.userId, table.receivedDate),
  index("idx_payout_transactions_schedule").on(table.payoutScheduleId),
]);

export const tdsRecords = sqliteTable("tds_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  investmentId: text("investment_id").notNull().references(() => investments.id),
  payoutScheduleId: text("payout_schedule_id").references(() => payoutSchedules.id),
  financialYear: text("financial_year").notNull(),
  grossInterestPaise: integer("gross_interest_paise", { mode: "number" }).notNull(),
  expectedTdsRateBps: integer("expected_tds_rate_bps").notNull(),
  expectedTdsPaise: integer("expected_tds_paise", { mode: "number" }).notNull(),
  actualTdsPaise: integer("actual_tds_paise", { mode: "number" }),
  tdsReflected: integer("tds_reflected", { mode: "boolean" }),
  reflectedAmountPaise: integer("reflected_amount_paise", { mode: "number" }),
  differencePaise: integer("difference_paise", { mode: "number" }),
  verificationDate: text("verification_date"),
  certificateReceived: integer("certificate_received", { mode: "boolean" }).notNull().default(false),
  verificationDocumentKey: text("verification_document_key"),
  status: text("status").notNull().default("not-verified"),
  remarks: text("remarks"),
  ...timestamps,
}, (table) => [
  index("idx_tds_records_user_fy").on(table.userId, table.financialYear),
  index("idx_tds_records_investment").on(table.investmentId),
]);

export const formRecords = sqliteTable("forms", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  investmentId: text("investment_id").notNull().references(() => investments.id),
  formType: text("form_type").notNull(),
  financialYear: text("financial_year").notNull(),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  submitted: integer("submitted", { mode: "boolean" }).notNull().default(false),
  submissionDate: text("submission_date"),
  accepted: integer("accepted", { mode: "boolean" }),
  acknowledgementNumber: text("acknowledgement_number"),
  expiryDate: text("expiry_date"),
  documentObjectKey: text("document_object_key"),
  status: text("status").notNull().default("not-required"),
  remarks: text("remarks"),
  ...timestamps,
}, (table) => [
  index("idx_forms_user_fy_status").on(table.userId, table.financialYear, table.status),
]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  investmentId: text("investment_id").references(() => investments.id),
  documentName: text("document_name").notNull(),
  documentType: text("document_type").notNull(),
  financialYear: text("financial_year"),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  expiryDate: text("expiry_date"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("idx_documents_user_investment").on(table.userId, table.investmentId),
  index("idx_documents_user_name").on(table.userId, table.documentName),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  scheduledFor: text("scheduled_for"),
  readAt: text("read_at"),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  ...timestamps,
}, (table) => [index("idx_notifications_user_schedule").on(table.userId, table.scheduledFor)]);

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  investmentId: text("investment_id").references(() => investments.id),
  actorType: text("actor_type").notNull().default("user"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull(),
  previousSnapshot: text("previous_snapshot"),
  nextSnapshot: text("next_snapshot"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_activity_logs_user_created").on(table.userId, table.createdAt),
  index("idx_activity_logs_investment_created").on(table.investmentId, table.createdAt),
]);

export const adminSettings = sqliteTable("admin_settings", {
  id: text("id").primaryKey(),
  settingType: text("setting_type").notNull(),
  investmentType: text("investment_type"),
  investorCategory: text("investor_category"),
  financialYear: text("financial_year"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  valueJson: text("value_json").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  index("idx_admin_settings_effective").on(table.settingType, table.effectiveFrom),
]);
