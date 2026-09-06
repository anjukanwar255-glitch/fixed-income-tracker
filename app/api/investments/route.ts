import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { calculateFinancialYear, generatePayoutSchedule } from "@/core/finance/calculations";
import type { InvestmentDraft } from "@/core/models/financial";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import { getDb } from "@/db";
import {
  activityLogs,
  documents,
  formRecords,
  investments,
  payoutSchedules,
  payoutTransactions,
  tdsRecords,
  users,
} from "@/db/schema";
import { authenticatedRequest } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

const investmentInput = z.object({
  investmentType: z.string().min(1),
  investmentName: z.string().trim().min(2).max(120),
  issuerName: z.string().trim().min(2).max(120),
  investmentNumber: z.string().trim().max(80).default(""),
  principalPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  interestRateBps: z.number().int().min(0).max(100_000),
  interestType: z.enum(["simple", "compound", "cumulative"]),
  compoundingFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly"]).default("quarterly"),
  dayCountBasis: z.enum(["actual-365", "actual-actual", "30-360"]).default("actual-365"),
  payoutFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly", "on-maturity", "custom"]),
  investmentDate: z.string().date(),
  firstPayoutDate: z.string().date(),
  maturityDate: z.string().date(),
  expectedMaturityPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  tdsApplicable: z.boolean(),
  expectedTdsRateBps: z.number().int().min(0).max(10_000),
  panLinked: z.boolean().default(false),
  declarationApplicable: z.boolean().default(false),
  bankName: z.string().trim().max(100).optional(),
  accountLast4: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
  paymentMode: z.string().trim().max(50).optional(),
  nominee: z.string().trim().max(100).optional(),
  brokerPlatform: z.string().trim().max(100).optional(),
  advisorName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.maturityDate <= value.investmentDate) {
    context.addIssue({ code: "custom", path: ["maturityDate"], message: "Maturity must be after investment date" });
  }
  if (value.payoutFrequency !== "custom" && value.firstPayoutDate < value.investmentDate) {
    context.addIssue({ code: "custom", path: ["firstPayoutDate"], message: "First payout cannot be before investment" });
  }
  if (value.payoutFrequency !== "on-maturity" && value.firstPayoutDate > value.maturityDate) {
    context.addIssue({ code: "custom", path: ["firstPayoutDate"], message: "First payout cannot be after maturity" });
  }
  if (value.interestType !== "simple" && value.payoutFrequency !== "on-maturity") {
    context.addIssue({ code: "custom", path: ["payoutFrequency"], message: "Compound and cumulative investments pay on maturity" });
  }
});

async function authenticatedOwner() {
  const user = await authenticatedRequest();
  if (!user) return null;
  return { id: user.uid, email: user.email, mobileE164: user.phoneNumber, token: user.token, appCheckToken: user.appCheckToken, authTime: user.authTime, uid: user.uid, phoneNumber: user.phoneNumber };
}

export async function GET() {
  const owner = await authenticatedOwner();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(owner.id);
  if (paywall) return paywall;

  try {
    const db = getDb();
    const rows = await db.select().from(investments)
      .where(and(eq(investments.userId, owner.id), isNull(investments.deletedAt)))
      .orderBy(desc(investments.createdAt));
    const schedules = await db.select().from(payoutSchedules)
      .where(and(eq(payoutSchedules.userId, owner.id), isNull(payoutSchedules.deletedAt)))
      .orderBy(payoutSchedules.dueDate);
    const transactions = await db.select().from(payoutTransactions)
      .where(and(eq(payoutTransactions.userId, owner.id), isNull(payoutTransactions.deletedAt)))
      .orderBy(desc(payoutTransactions.createdAt));
    const tds = await db.select().from(tdsRecords)
      .where(and(eq(tdsRecords.userId, owner.id), isNull(tdsRecords.deletedAt)))
      .orderBy(desc(tdsRecords.createdAt));
    const documentRows = await db.select().from(documents)
      .where(and(eq(documents.userId, owner.id), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt));
    const forms = await db.select().from(formRecords)
      .where(and(eq(formRecords.userId, owner.id), isNull(formRecords.deletedAt)))
      .orderBy(desc(formRecords.createdAt));
    const activities = await db.select().from(activityLogs)
      .where(eq(activityLogs.userId, owner.id))
      .orderBy(desc(activityLogs.createdAt));

    const latestTransaction = new Map<string, (typeof transactions)[number]>();
    for (const transaction of transactions) {
      if (!latestTransaction.has(transaction.payoutScheduleId)) latestTransaction.set(transaction.payoutScheduleId, transaction);
    }
    const latestTds = new Map<string, (typeof tds)[number]>();
    for (const record of tds) {
      if (record.payoutScheduleId && !latestTds.has(record.payoutScheduleId)) latestTds.set(record.payoutScheduleId, record);
    }
    const byInvestment = schedules.reduce<Record<string, typeof schedules>>((grouped, payout) => {
      (grouped[payout.investmentId] ??= []).push(payout);
      return grouped;
    }, {});
    return Response.json({
      investments: rows.map((investment) => ({
        ...investment,
        schedule: (byInvestment[investment.id] ?? []).map((payout) => {
          const transaction = latestTransaction.get(payout.id);
          const tdsRecord = latestTds.get(payout.id);
          return {
            ...payout,
            receivedAmountPaise: transaction?.receivedAmountPaise ?? null,
            receivedDate: transaction?.receivedDate ?? null,
            actualTdsPaise: transaction?.actualTdsPaise ?? tdsRecord?.actualTdsPaise ?? null,
            paymentReference: transaction?.paymentReference ?? null,
            payoutRemarks: transaction?.remarks ?? null,
            followUpDate: transaction?.followUpDate ?? null,
            tdsReflected: tdsRecord?.tdsReflected ?? null,
            reflectedAmountPaise: tdsRecord?.reflectedAmountPaise ?? null,
            tdsVerificationDate: tdsRecord?.verificationDate ?? null,
            tdsStatus: tdsRecord?.status ?? "not-verified",
          };
        }),
        documents: documentRows.filter((document) => document.investmentId === investment.id),
        forms: forms.filter((form) => form.investmentId === investment.id),
        activity: activities.filter((activity) => activity.investmentId === investment.id),
      })),
    });
  } catch {
    return Response.json({ error: "Investment data is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const owner = await authenticatedOwner();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(owner.id);
  if (paywall) return paywall;

  const parsed = investmentInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Please check the highlighted investment details", issues: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const db = getDb();
  const investmentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const duplicate = input.investmentNumber
    ? await db.select({ id: investments.id }).from(investments)
      .where(and(
        eq(investments.userId, owner.id),
        eq(investments.investmentNumber, input.investmentNumber),
        isNull(investments.deletedAt),
      )).limit(1)
    : [];

  const draft: InvestmentDraft = {
    type: input.investmentType as InvestmentDraft["type"],
    name: input.investmentName,
    issuer: input.issuerName,
    investmentNumber: input.investmentNumber,
    investmentDate: input.investmentDate,
    principalPaise: BigInt(input.principalPaise),
    annualRateBps: input.interestRateBps,
    interestType: input.interestType,
    compoundingFrequency: input.compoundingFrequency,
    dayCountBasis: input.dayCountBasis,
    payoutFrequency: input.payoutFrequency,
    firstPayoutDate: input.firstPayoutDate,
    maturityDate: input.maturityDate,
    expectedMaturityPaise: input.expectedMaturityPaise ? BigInt(input.expectedMaturityPaise) : undefined,
    tdsApplicable: input.tdsApplicable,
    expectedTdsRateBps: input.expectedTdsRateBps,
  };
  const schedule = generatePayoutSchedule(draft);

  try {
    await db.insert(users).values({
      id: owner.id,
      authSubject: owner.id,
      email: owner.email,
      mobileE164: owner.mobileE164,
    }).onConflictDoUpdate({
      target: users.authSubject,
      set: { email: owner.email, mobileE164: owner.mobileE164, updatedAt: createdAt },
    });

    const operations = [
      db.insert(investments).values({
        id: investmentId,
        userId: owner.id,
        investmentType: input.investmentType,
        investmentName: input.investmentName,
        issuerNameSnapshot: input.issuerName,
        investmentNumber: input.investmentNumber,
        principalPaise: input.principalPaise,
        interestRateBps: input.interestRateBps,
        interestType: input.interestType,
        compoundingFrequency: input.compoundingFrequency,
        dayCountBasis: input.dayCountBasis,
        payoutFrequency: input.payoutFrequency,
        investmentDate: input.investmentDate,
        firstPayoutDate: input.firstPayoutDate,
        maturityDate: input.maturityDate,
        expectedMaturityPaise: input.expectedMaturityPaise,
        tdsApplicable: input.tdsApplicable,
        expectedTdsRateBps: input.expectedTdsRateBps,
        panLinked: input.panLinked,
        declarationApplicable: input.declarationApplicable,
        bankName: input.bankName,
        accountLast4: input.accountLast4 || null,
        paymentMode: input.paymentMode,
        nominee: input.nominee,
        brokerPlatform: input.brokerPlatform,
        advisorName: input.advisorName,
        notes: input.notes,
        status: "active",
        financialYear: calculateFinancialYear(input.investmentDate),
        createdAt,
        updatedAt: createdAt,
      }),
      ...schedule.map((payout) => db.insert(payoutSchedules).values({
        id: crypto.randomUUID(),
        investmentId,
        userId: owner.id,
        dueDate: payout.dueDate,
        financialYear: payout.financialYear,
        grossInterestPaise: Number(payout.grossInterestPaise),
        expectedTdsRateBps: input.expectedTdsRateBps,
        expectedTdsPaise: Number(payout.expectedTdsPaise),
        expectedNetPaise: Number(payout.expectedNetPaise),
        status: payout.status,
        createdAt,
        updatedAt: createdAt,
      })),
      db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        userId: owner.id,
        investmentId,
        action: "created",
        entityType: "investment",
        entityId: investmentId,
        summary: "Investment created and expected payout schedule generated",
        nextSnapshot: JSON.stringify({
          investmentName: input.investmentName,
          principalPaise: input.principalPaise,
          scheduleCount: schedule.length,
        }),
        createdAt,
      }),
    ];
    await db.batch(operations as unknown as Parameters<typeof db.batch>[0]);

    const backupWarning = await createUserBackup(owner).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
    const warnings = [duplicate.length ? "An investment with this number already exists" : null, backupWarning].filter(Boolean);

    return Response.json({
      investmentId,
      scheduleCount: schedule.length,
      warning: warnings.length ? warnings.join(". ") : null,
    }, { status: 201 });
  } catch {
    return Response.json({ error: "The investment could not be saved. Your input has been preserved." }, { status: 503 });
  }
}
