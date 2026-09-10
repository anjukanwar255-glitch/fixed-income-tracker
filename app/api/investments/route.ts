import { z } from "zod";

import { calculateFinancialYear, generatePayoutSchedule } from "@/core/finance/calculations";
import type { InvestmentDraft } from "@/core/models/financial";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import {
  activityLogs,
  type BatchOperation,
  commitAll,
  documents,
  firstDoc,
  forms,
  investments,
  listDocs,
  payoutSchedules,
  payoutTransactions,
  readDoc,
  setOp,
  tdsRecords,
  userDoc,
} from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

const investmentInput = z.object({
  investmentType: z.string().min(1),
  investmentName: z.string().trim().min(2).max(120),
  issuerName: z.string().trim().min(2).max(120),
  investmentNumber: z.string().trim().max(80).default(""),
  principalPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  faceValuePaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  interestRateBps: z.number().int().min(0).max(100_000),
  interestType: z.enum(["simple", "compound", "cumulative"]),
  compoundingFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly"]).default("quarterly"),
  dayCountBasis: z.enum(["actual-365", "actual-actual", "30-360"]).default("actual-365"),
  payoutFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly", "on-maturity", "custom"]),
  investmentDate: z.string().date(),
  interestStartDate: z.string().date().optional(),
  firstPayoutDate: z.string().date(),
  maturityDate: z.string().date(),
  expectedMaturityPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  tdsApplicable: z.boolean(),
  expectedTdsRateBps: z.number().int().min(0).max(10_000),
  panLinked: z.boolean().default(false),
  declarationApplicable: z.boolean().default(false),
  bankName: z.string().trim().max(100).optional(),
  accountNumber: z.string().trim().regex(/^\d{9,18}$/, "Enter the full account number").optional().or(z.literal("")),
  paymentMode: z.string().trim().max(50).optional(),
  nominee: z.string().trim().max(100).optional(),
  brokerPlatform: z.string().trim().max(100).optional(),
  dpId: z.string().trim().max(40).optional(),
  clientId: z.string().trim().max(40).optional(),
  orderReference: z.string().trim().max(80).optional(),
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
    // Issued together: these are seven independent network round trips now,
    // where the D1 versions were sequential local reads.
    const [rows, schedules, transactions, tds, documentRows, formRows, activities] = await Promise.all([
      listDocs(investments(owner.id).where("deletedAt", "==", null).orderBy("createdAt", "desc")),
      listDocs(payoutSchedules(owner.id).where("deletedAt", "==", null).orderBy("dueDate", "asc")),
      listDocs(payoutTransactions(owner.id).where("deletedAt", "==", null).orderBy("createdAt", "desc")),
      listDocs(tdsRecords(owner.id).where("deletedAt", "==", null).orderBy("createdAt", "desc")),
      listDocs(documents(owner.id).where("deletedAt", "==", null).orderBy("createdAt", "desc")),
      listDocs(forms(owner.id).where("deletedAt", "==", null).orderBy("createdAt", "desc")),
      listDocs(activityLogs(owner.id).orderBy("createdAt", "desc")),
    ]);

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
        forms: formRows.filter((form) => form.investmentId === investment.id),
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
  const investmentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const duplicate = input.investmentNumber
    ? await firstDoc(investments(owner.id)
      .where("deletedAt", "==", null)
      .where("investmentNumber", "==", input.investmentNumber))
    : null;

  const draft: InvestmentDraft = {
    type: input.investmentType as InvestmentDraft["type"],
    name: input.investmentName,
    issuer: input.issuerName,
    investmentNumber: input.investmentNumber,
    investmentDate: input.investmentDate,
    principalPaise: BigInt(input.principalPaise),
    faceValuePaise: input.faceValuePaise === undefined ? undefined : BigInt(input.faceValuePaise),
    interestStartDate: input.interestStartDate,
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
    // Ensures the parent document exists before writing into its
    // subcollections, and refreshes the contact details from the token.
    // Written in full on creation: the SQLite table supplied `fullName`,
    // `role` and `createdAt` as column defaults, which Firestore has no
    // equivalent for, and a blind merge would blank an existing name.
    const existingOwner = await readDoc(userDoc(owner.id));
    if (existingOwner) {
      await userDoc(owner.id).update({ email: owner.email, mobileE164: owner.mobileE164, updatedAt: createdAt });
    } else {
      await userDoc(owner.id).set({
        id: owner.id,
        fullName: "",
        email: owner.email,
        mobileE164: owner.mobileE164,
        role: "user",
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    }

    const logId = crypto.randomUUID();
    const operations: BatchOperation[] = [
      setOp(investments(owner.id).doc(investmentId), {
        id: investmentId,
        investmentType: input.investmentType,
        investmentName: input.investmentName,
        issuerNameSnapshot: input.issuerName,
        investmentNumber: input.investmentNumber,
        principalPaise: input.principalPaise,
        faceValuePaise: input.faceValuePaise ?? null,
        interestRateBps: input.interestRateBps,
        interestType: input.interestType,
        compoundingFrequency: input.compoundingFrequency,
        dayCountBasis: input.dayCountBasis,
        payoutFrequency: input.payoutFrequency,
        investmentDate: input.investmentDate,
        interestStartDate: input.interestStartDate ?? null,
        firstPayoutDate: input.firstPayoutDate,
        maturityDate: input.maturityDate,
        expectedMaturityPaise: input.expectedMaturityPaise ?? null,
        tdsApplicable: input.tdsApplicable,
        expectedTdsRateBps: input.expectedTdsRateBps,
        panLinked: input.panLinked,
        declarationApplicable: input.declarationApplicable,
        bankName: input.bankName ?? null,
        accountNumber: input.accountNumber || null,
        paymentMode: input.paymentMode ?? null,
        nominee: input.nominee ?? null,
        brokerPlatform: input.brokerPlatform ?? null,
        dpId: input.dpId ?? null,
        clientId: input.clientId ?? null,
        orderReference: input.orderReference ?? null,
        advisorName: input.advisorName ?? null,
        notes: input.notes ?? null,
        status: "active",
        financialYear: calculateFinancialYear(input.investmentDate),
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      }),
      ...schedule.map((payout) => {
        const payoutId = crypto.randomUUID();
        return setOp(payoutSchedules(owner.id).doc(payoutId), {
          id: payoutId,
          investmentId,
          dueDate: payout.dueDate,
          financialYear: payout.financialYear,
          grossInterestPaise: Number(payout.grossInterestPaise),
          expectedTdsRateBps: input.expectedTdsRateBps,
          expectedTdsPaise: Number(payout.expectedTdsPaise),
          expectedNetPaise: Number(payout.expectedNetPaise),
          status: payout.status,
          source: "generated",
          revision: 1,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        });
      }),
      setOp(activityLogs(owner.id).doc(logId), {
        id: logId,
        investmentId,
        actorType: "user",
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
    await commitAll(operations);

    const backupWarning = await createUserBackup(owner).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
    const warnings = [duplicate ? "An investment with this number already exists" : null, backupWarning].filter(Boolean);

    return Response.json({
      investmentId,
      scheduleCount: schedule.length,
      warning: warnings.length ? warnings.join(". ") : null,
    }, { status: 201 });
  } catch {
    return Response.json({ error: "The investment could not be saved. Your input has been preserved." }, { status: 503 });
  }
}
