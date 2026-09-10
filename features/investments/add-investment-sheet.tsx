"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Landmark,
  Loader2,
  LockKeyhole,
  ReceiptIndianRupee,
  ScanLine,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { MaskedField } from "@/components/masked-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { indianBankGroups } from "@/core/data/indian-banks";
import { investmentTypeCatalog } from "@/core/data/investment-types";
import { DECLARATION_FORM_TYPE, TDS_RATE_WITHOUT_PAN_BPS, TDS_RATE_WITH_PAN_BPS } from "@/core/tax/declarations";
import { formatMoney, generatePayoutSchedule, parseRupeesToPaise, previousCouponDate } from "@/core/finance/calculations";
import { apiFetch, uploadDocumentFile } from "@/lib/firebase-client";
import type { CompoundingFrequency, DayCountBasis, InterestType, InvestmentType, PayoutFrequency, PortfolioInvestment } from "@/core/models/financial";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (investmentId: string) => Promise<void> | void;
  initialInvestment?: PortfolioInvestment | null;
};

const steps = ["Type", "Details", "Interest", "TDS", "Account", "Documents"];
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const ISSUER_SUGGESTIONS_ID = "issuer-bank-suggestions";
/** More than this on one investment is a mis-click, not a filing. */
const MAX_ATTACHMENTS = 10;

type Attachment = { file: File; documentType: string };

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "bond-certificate": "Bond agreement / deal sheet",
  "investment-certificate": "Certificate",
  "repayment-schedule": "Repayment schedule",
};

function documentTypeLabel(documentType: string) {
  return DOCUMENT_TYPE_LABELS[documentType] ?? "Document";
}

function certificateType(type: InvestmentType) {
  return isBondType(type) ? "bond-certificate" : "investment-certificate";
}
const BANK_SUGGESTIONS_ID = "receiving-bank-suggestions";
const allBanks = indianBankGroups.flatMap((group) => group.banks);
const RATE_WITH_PAN = (TDS_RATE_WITH_PAN_BPS / 100).toFixed(2);
const RATE_WITHOUT_PAN = (TDS_RATE_WITHOUT_PAN_BPS / 100).toFixed(2);

/**
 * Moves the rate to the one the law would apply, but only from a value the
 * form itself suggested. A rate typed in from the issuer's terms is left
 * alone — those terms outrank the default, and silently overwriting them
 * would misstate every payout in the schedule.
 */
function suggestedTdsRate(current: string, linked: boolean) {
  const next = linked ? RATE_WITH_PAN : RATE_WITHOUT_PAN;
  const untouched = !current || current === RATE_WITH_PAN || current === RATE_WITHOUT_PAN;
  return untouched ? next : current;
}

const payoutOptions: { value: PayoutFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "on-maturity", label: "On maturity" },
];

const typeIcons: Record<InvestmentType, typeof Landmark> = {
  "fixed-deposit": Landmark,
  "corporate-fd": Building2,
  "corporate-bond": Banknote,
  "government-bond": Landmark,
  ncd: ReceiptIndianRupee,
  debenture: FileText,
  "government-security": Landmark,
  other: FileText,
};

const investmentTypes = investmentTypeCatalog.map((entry) => ({ ...entry, icon: typeIcons[entry.value] }));

export function AddInvestmentSheet({ open, onOpenChange, onSave, initialInvestment }: Props) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<InvestmentType>(initialInvestment?.type ?? "fixed-deposit");
  const [name, setName] = useState(initialInvestment?.name ?? "");
  const [issuer, setIssuer] = useState(initialInvestment?.issuer ?? "");
  const [number, setNumber] = useState(initialInvestment?.investmentNumber ?? "");
  const [investmentDate, setInvestmentDate] = useState(() => initialInvestment?.investmentDate ?? new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(() => initialInvestment ? paiseToInput(initialInvestment.principalPaise) : "");
  const [faceValue, setFaceValue] = useState(() => initialInvestment?.faceValuePaise ? paiseToInput(initialInvestment.faceValuePaise) : "");
  const [interestStartDate, setInterestStartDate] = useState(initialInvestment?.interestStartDate ?? "");
  const [rate, setRate] = useState(() => initialInvestment ? (initialInvestment.annualRateBps / 100).toFixed(2) : "");
  const [maturityDate, setMaturityDate] = useState(initialInvestment?.maturityDate ?? "");
  const [maturityAmount, setMaturityAmount] = useState(() => initialInvestment?.expectedMaturityPaise ? paiseToInput(initialInvestment.expectedMaturityPaise) : "");
  const [interestType, setInterestType] = useState<InterestType>(initialInvestment?.interestType ?? "simple");
  const [compoundingFrequency, setCompoundingFrequency] = useState<CompoundingFrequency>(initialInvestment?.compoundingFrequency ?? "quarterly");
  const [dayCountBasis, setDayCountBasis] = useState<DayCountBasis>(initialInvestment?.dayCountBasis ?? "actual-365");
  const [frequency, setFrequency] = useState<PayoutFrequency>(initialInvestment?.payoutFrequency ?? "quarterly");
  const [firstPayoutDate, setFirstPayoutDate] = useState(initialInvestment?.firstPayoutDate ?? "");
  const [tdsApplicable, setTdsApplicable] = useState(initialInvestment?.tdsApplicable ?? false);
  const [tdsRate, setTdsRate] = useState(() => initialInvestment ? (initialInvestment.expectedTdsRateBps / 100).toFixed(2) : "");
  const [panLinked, setPanLinked] = useState(initialInvestment?.panLinked ?? false);
  const [declarationApplicable, setDeclarationApplicable] = useState(initialInvestment?.declarationApplicable ?? false);
  const [bankName, setBankName] = useState(initialInvestment?.bankName ?? "");
  /**
   * What the IFSC turned out to belong to. Kept with the code it answers, so
   * editing the code drops the stale answer without a second state update.
   */
  const [ifscLookup, setIfscLookup] = useState<{ code: string; branch: string | null } | null>(null);
  const [ifsc, setIfsc] = useState(initialInvestment?.ifscCode ?? "");
  const [accountNumber, setAccountNumber] = useState(initialInvestment?.accountNumber ?? "");
  const [paymentMode, setPaymentMode] = useState(initialInvestment?.paymentMode ?? "bank-transfer");
  const [nominee, setNominee] = useState(initialInvestment?.nominee ?? "");
  const [broker, setBroker] = useState(initialInvestment?.brokerPlatform ?? "");
  const [dpId, setDpId] = useState(initialInvestment?.dpId ?? "");
  const [clientId, setClientId] = useState(initialInvestment?.clientId ?? "");
  const [orderReference, setOrderReference] = useState(initialInvestment?.orderReference ?? "");
  const [advisor, setAdvisor] = useState(initialInvestment?.advisorName ?? "");
  const [advisorMobile, setAdvisorMobile] = useState(initialInvestment?.advisorMobile ?? "");
  const [notes, setNotes] = useState(initialInvestment?.notes ?? "");
  /**
   * Everything to be filed with this investment. All of it is stored, not just
   * one chosen document: a bond is described by its deal sheet and its
   * repayment schedule together, and keeping only one of them loses half of
   * what a payout would later be reconciled against.
   *
   * Documents that came from a scan arrive here already, since asking for them
   * a second time is asking for the same files twice.
   */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /**
   * The two documents are held in named slots rather than one heap, so it is
   * clear which paper is which — both to whoever is filling the form and to
   * the reader, which is told the role of each file it is given.
   */
  /**
   * The issuer's own repayment schedule, as read off the documents. Kept so
   * each payout can be checked against what was promised — including how much
   * of it is principal coming back, which no rate can tell you.
   */
  const [scannedSchedule, setScannedSchedule] = useState<{ dueDate: string; interestPaise: number; principalPaise: number }[]>([]);
  const [dealSheetFile, setDealSheetFile] = useState<File | null>(null);
  const [scheduleFile, setScheduleFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  /**
   * Reads the attached documents and writes what they say into the form.
   *
   * A scan replaces the fields it finds rather than only filling blanks. The
   * earlier behaviour left the first scan's mistakes in place — re-scanning
   * could not correct a wrong value, because the field was no longer empty —
   * which is the opposite of what someone re-scanning is asking for. Fields
   * the documents do not mention are left exactly as they were.
   *
   * Nothing is saved. The values land in the form for checking against the
   * papers in front of the investor.
   */
  const runScan = async (sources: { deal: File | null; schedule: File | null }) => {
    const attached = [
      sources.deal ? { role: "deal" as const, file: sources.deal } : null,
      sources.schedule ? { role: "schedule" as const, file: sources.schedule } : null,
    ].filter((entry) => entry !== null);

    if (!attached.length) return;
    setScanning(true);
    try {
      const form = new FormData();
      for (const { role, file } of attached) form.append(role, file);
      // No content-type header: the browser sets the multipart boundary.
      const response = await apiFetch("/api/investments/scan", { method: "POST", body: form });
      const payload = await response.json() as { fields?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.fields) throw new Error(payload.error ?? "The documents could not be read");

      const found = payload.fields;
      let filled = 0;
      const applyText = (value: unknown, set: (next: string) => void) => {
        if (typeof value === "string" && value) { set(value); filled += 1; }
      };
      const applyNumber = (value: unknown, set: (next: string) => void) => {
        if (typeof value === "number") { set(String(value)); filled += 1; }
      };

      applyText(found.investmentName, setName);
      applyText(found.issuerName, setIssuer);
      applyText(found.investmentNumber, setNumber);
      applyText(found.brokerName, setBroker);
      applyText(found.dpId, setDpId);
      applyText(found.clientId, setClientId);
      applyText(found.orderReference, setOrderReference);
      applyText(found.ifscCode, setIfsc);
      applyText(found.investmentDate, setInvestmentDate);
      applyNumber(found.amountPaidRupees, setAmount);
      applyNumber(found.faceValueRupees, setFaceValue);
      applyNumber(found.interestRatePercent, setRate);
      applyText(found.firstPayoutDate, setFirstPayoutDate);
      applyText(found.maturityDate, setMaturityDate);
      applyText(found.notes, setNotes);

      const scannedFrequency = typeof found.payoutFrequency === "string" ? found.payoutFrequency as PayoutFrequency : null;
      const scannedInterestType = typeof found.interestType === "string" ? found.interestType as InterestType : null;
      if (scannedFrequency) { setFrequency(scannedFrequency); filled += 1; }
      if (typeof found.dayCountBasis === "string") { setDayCountBasis(found.dayCountBasis as DayCountBasis); filled += 1; }
      if (scannedInterestType) { setInterestType(scannedInterestType); filled += 1; }

      /*
       * A bond that pays its interest out along the way repays the principal
       * and nothing else at the end, so the maturity amount is the face value
       * — determinate, and not worth leaving blank just because no document
       * prints it under that heading. A cumulative product is the opposite:
       * the interest is rolled up into the final payment, so the figure has to
       * come off the paperwork and is left empty when it does not.
       */
      const principalAtMaturity = typeof found.faceValueRupees === "number"
        ? found.faceValueRupees
        : typeof found.amountPaidRupees === "number" ? found.amountPaidRupees : null;
      const repaysPrincipalOnly = scannedFrequency !== null
        && scannedFrequency !== "on-maturity"
        && scannedInterestType !== "cumulative";
      if (typeof found.expectedMaturityRupees === "number") {
        setMaturityAmount(String(found.expectedMaturityRupees));
        filled += 1;
      } else if (repaysPrincipalOnly && principalAtMaturity !== null) {
        setMaturityAmount(String(principalAtMaturity));
        filled += 1;
      }

      /*
       * When the documents show interest was paid to the seller, the purchase
       * landed part-way through a coupon period, so interest runs from the
       * previous coupon date rather than from the purchase.
       *
       * The date is derived here rather than asked for: stepping one period
       * back from the first payout is exact, where having the model divide an
       * accrued amount by a daily rate is arithmetic it can quietly get wrong.
       * A date the documents state outright is still preferred.
       */
      const statedStart = typeof found.interestStartDate === "string" ? found.interestStartDate : null;
      const paidAccruedInterest = typeof found.accruedInterestPaidRupees === "number" && found.accruedInterestPaidRupees > 0;
      const scannedFirstPayout = typeof found.firstPayoutDate === "string" ? found.firstPayoutDate : null;
      const derivedStart = paidAccruedInterest && scannedFirstPayout && scannedFrequency
        ? previousCouponDate(scannedFirstPayout, scannedFrequency)
        : null;
      applyText(statedStart ?? derivedStart, setInterestStartDate);

      if (Array.isArray(found.repaymentSchedule)) {
        const rows = (found.repaymentSchedule as { dueDate: string; interestRupees: number; principalRupees: number }[])
          .map((row) => ({
            dueDate: row.dueDate,
            interestPaise: Math.round(row.interestRupees * 100),
            principalPaise: Math.round(row.principalRupees * 100),
          }));
        setScannedSchedule(rows);
        if (rows.length) filled += 1;
      }

      // These are the papers this investment should be filed with, so they
      // carry through to the documents step instead of being asked for twice.
      // Each keeps the role it was scanned under, so the schedule is filed as a
      // schedule rather than as another copy of the certificate.
      setAttachments(attached.map(({ role, file }) => ({
        file,
        documentType: role === "schedule" ? "repayment-schedule" : certificateType(type),
      })));

      toast.success(filled
        ? `Read ${filled} field${filled === 1 ? "" : "s"} — check each against the documents`
        : "Nothing could be read from those documents");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The documents could not be read");
    } finally {
      setScanning(false);
    }
  };

  /** Accepts one document into its slot and re-reads whatever is attached. */
  const attachForScan = (role: "deal" | "schedule", file: File | null) => {
    if (!file) return;
    if (!allowedDocumentTypes.has(file.type) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
      toast.error("Each file must be a PDF, JPG, JPEG or PNG up to 10 MB");
      return;
    }
    const next = { deal: dealSheetFile, schedule: scheduleFile, [role]: file };
    if (role === "deal") setDealSheetFile(file); else setScheduleFile(file);
    void runScan(next);
  };

  const resolvedBankName = bankName.trim();
  const bankNameInvalid = /\d/.test(bankName);

  /*
   * Resolves the code once it is long enough to mean anything, and names the
   * branch back. The bank name is filled in from the answer only when it is
   * still blank, so a lookup never overwrites what someone typed.
   */
  useEffect(() => {
    if (ifsc.length !== 11) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/ifsc?code=${ifsc}`, { signal: controller.signal });
        const payload = await response.json() as { bank?: string; branch?: string | null; city?: string | null };
        if (!response.ok || !payload.bank) { setIfscLookup({ code: ifsc, branch: null }); return; }
        setIfscLookup({ code: ifsc, branch: [payload.bank, payload.branch, payload.city].filter(Boolean).join(" · ") });
        setBankName((current) => current.trim() ? current : payload.bank ?? current);
      } catch {
        // An aborted or failed lookup leaves the typed code alone; the format
        // check still stands on its own at save time.
      }
    }, 400);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [ifsc]);

  const resolvedIfsc = ifscLookup?.code === ifsc ? ifscLookup : null;
  const ifscBranch = resolvedIfsc?.branch ?? null;
  const ifscError = resolvedIfsc !== null && resolvedIfsc.branch === null;
  const bondDocument = isBondType(type);
  const draft = useMemo(() => ({
    type,
    name: name || "New investment",
    issuer: issuer || "Issuer",
    investmentNumber: number,
    investmentDate,
    principalPaise: parseRupeesToPaise(amount),
    faceValuePaise: faceValue ? parseRupeesToPaise(faceValue) : undefined,
    interestStartDate: interestStartDate || undefined,
    annualRateBps: Math.round((Number(rate) || 0) * 100),
    interestType,
    compoundingFrequency,
    dayCountBasis,
    payoutFrequency: frequency,
    firstPayoutDate: frequency === "on-maturity" ? maturityDate : firstPayoutDate,
    maturityDate,
    expectedMaturityPaise: maturityAmount ? parseRupeesToPaise(maturityAmount) : undefined,
    tdsApplicable,
    expectedTdsRateBps: tdsApplicable ? Math.round((Number(tdsRate) || 0) * 100) : 0,
  }), [amount, compoundingFrequency, dayCountBasis, faceValue, firstPayoutDate, frequency, interestStartDate, interestType, investmentDate, issuer, maturityAmount, maturityDate, name, number, rate, tdsApplicable, tdsRate, type]);

  const schedule = useMemo(() => {
    try { return generatePayoutSchedule(draft); } catch { return []; }
  }, [draft]);
  const firstProjection = schedule[0];

  const next = () => {
    if (step === 2 && (!name.trim() || !issuer.trim() || parseRupeesToPaise(amount) <= 0n)) {
      toast.error("Add the investment name, issuer and a valid amount");
      return;
    }
    const invalidFirstPayout = frequency !== "on-maturity" && (!firstPayoutDate || firstPayoutDate < investmentDate || firstPayoutDate > maturityDate);
    if (step === 3 && (!rate || !maturityDate || maturityDate <= investmentDate || invalidFirstPayout)) {
      toast.error("Check the interest rate and payout dates");
      return;
    }
    setStep((current) => Math.min(6, current + 1));
  };

  const save = async () => {
    if (!initialInvestment && !accountNumber) {
      setStep(5);
      toast.error("Enter the account the payouts are credited to");
      return;
    }
    if (/\d/.test(resolvedBankName)) {
      setStep(5);
      toast.error("Bank name is invalid — it cannot contain numbers");
      return;
    }
    if (advisorMobile && !/^[6-9]\d{9}$/.test(advisorMobile)) {
      setStep(5);
      toast.error("Enter a 10-digit advisor mobile number");
      return;
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      setStep(5);
      toast.error("Enter a valid IFSC code, e.g. HDFC0001234");
      return;
    }
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      setStep(5);
      toast.error("Enter a valid account number (9 to 18 digits)");
      return;
    }

    // A bond has to be filed with its paperwork: the terms live in the
    // agreement, not in this form, and a holding with no document behind it
    // cannot be reconciled against the broker later. Scanning already supplies
    // one, so this only stops someone who typed everything by hand.
    if (bondDocument && !attachments.length && !initialInvestment) {
      setStep(6);
      toast.error("Attach the bond agreement or deal sheet before saving");
      return;
    }
    const investment: PortfolioInvestment = {
      ...draft,
      id: initialInvestment?.id ?? "",
      status: initialInvestment?.status ?? "active",
      schedule,
      documents: initialInvestment?.documents ?? [],
      forms: initialInvestment?.forms ?? [],
      activity: initialInvestment?.activity ?? [],
    };
    setSaving(true);
    try {
      const result = await syncInvestment(investment, { bankName: resolvedBankName, ifscCode: ifsc, accountNumber, paymentMode, nominee, broker, dpId, clientId, orderReference, advisor, advisorMobile, notes }, scannedSchedule, { panLinked, declarationApplicable }, attachments);
      if (result.warning) toast.warning(result.warning);
      await onSave(result.investmentId);
      onOpenChange(false);
      resetForm();
      toast.success(initialInvestment ? `${name} updated` : `${name} saved with ${result.scheduleCount} expected payouts`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Investment could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStep(1); setType("fixed-deposit"); setName(""); setIssuer(""); setNumber("");
    setInvestmentDate(new Date().toISOString().slice(0, 10)); setAmount(""); setRate("");
    setMaturityDate(""); setMaturityAmount(""); setInterestType("simple"); setCompoundingFrequency("quarterly"); setDayCountBasis("actual-365"); setFrequency("quarterly");
    setFirstPayoutDate(""); setTdsApplicable(false); setTdsRate(""); setPanLinked(false);
    setDeclarationApplicable(false); setBankName(""); setIfsc(""); setIfscLookup(null); setAccountNumber(""); setPaymentMode("bank-transfer");
    setNominee(""); setBroker(""); setAdvisor(""); setAdvisorMobile(""); setNotes(""); setAttachments([]);
    setFaceValue(""); setInterestStartDate(""); setDpId(""); setClientId(""); setOrderReference("");
    setDealSheetFile(null); setScheduleFile(null); setScannedSchedule([]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="add-investment-sheet" showCloseButton>
        <SheetHeader className="add-sheet-header">
          <div className="add-sheet-title-row">
            <span className="brand-mark mini"><Landmark aria-hidden="true" /></span>
            <div><SheetTitle>{initialInvestment ? "Edit investment" : "Add investment"}</SheetTitle><SheetDescription>Step {step} of 6 · {steps[step - 1]}</SheetDescription></div>
          </div>
          <div className="stepper" aria-label={`Step ${step} of 6`}>
            {steps.map((label, index) => <span className={index + 1 <= step ? "complete" : ""} key={label}><i>{index + 1 < step ? <Check /> : index + 1}</i><small>{label}</small></span>)}
          </div>
        </SheetHeader>

        <div className="add-sheet-body">
          {step === 1 && (
            <div className="form-section">
              <FormHeading title="What are you investing in?" description="Choose the closest type. You can change it later with an audit entry." />
              <RadioGroup value={type} onValueChange={(value) => setType(value as InvestmentType)} className="type-option-grid">
                {investmentTypes.map(({ value, title, note, icon: Icon }) => (
                  <label className="type-option" key={value} data-selected={type === value}>
                    <RadioGroupItem value={value} className="sr-only" />
                    <span><Icon aria-hidden="true" /></span><b>{title}</b><small>{note}</small>
                    {type === value && <Check className="selected-check" aria-hidden="true" />}
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {step === 2 && (
            <div className="form-section">
              <FormHeading title="Investment details" description="Enter the values shown on the receipt or certificate." />
              {/*
                Two named slots rather than one heap of files. Which paper is
                which stops being a guess — for whoever is filling the form,
                and for the reader, which is told the role of each document and
                can prefer the deal sheet's terms over a statement's summary.
                A deposit has only one paper, so it gets one slot.
              */}
              <div className="scan-slots">
                <ScanSlot
                  label={bondDocument ? "Deal sheet or bond agreement" : "Deposit receipt or certificate"}
                  hint={bondDocument ? "Issuer, coupon rate, price breakdown" : "The terms as issued"}
                  file={dealSheetFile}
                  disabled={scanning}
                  onSelect={(file) => attachForScan("deal", file)}
                />
                {bondDocument && (
                  <ScanSlot
                    label="Repayment or interest schedule"
                    hint="Payout dates and amounts"
                    file={scheduleFile}
                    disabled={scanning}
                    onSelect={(file) => attachForScan("schedule", file)}
                  />
                )}
              </div>
              <p className="scan-note">
                {scanning
                  ? <><Loader2 className="spinning" aria-hidden="true" /> Reading the documents…</>
                  : "Each document is read as soon as it is attached, and re-read when the other arrives. Every value is yours to check before saving."}
              </p>
              <div className="field-grid">
                <Field label="Investment name" value={name} setValue={setName} placeholder="e.g. Secure Income FD" />
                {/*
                  Suggestions, not a fixed list: a deposit's issuer is a bank
                  from the picker, but a bond or NCD is issued by a company
                  that will never appear there. Offering the banks still keeps
                  FD issuer names spelled one way, which matters because this
                  value is snapshotted onto every investment and shown in
                  reports.
                */}
                <Field label="Issuer / bank / company" value={issuer} setValue={setIssuer} placeholder="Name shown on the certificate" list={ISSUER_SUGGESTIONS_ID} />
                <datalist id={ISSUER_SUGGESTIONS_ID}>
                  {indianBankGroups.flatMap((group) => group.banks).map((bank) => <option value={bank} key={bank} />)}
                </datalist>
                <Field label="FD / folio / bond number" value={number} setValue={setNumber} placeholder="Certificate number" />
                <Field label="Investment date" value={investmentDate} setValue={setInvestmentDate} type="date" />
                <Field label="Amount paid (₹)" value={amount} setValue={setAmount} inputMode="decimal" placeholder="10,00,000" />
                <div className="form-field">
                  <Label htmlFor="field-face-value">Face value (₹) <span className="field-optional">only if different</span></Label>
                  <Input id="field-face-value" value={faceValue} onChange={(event) => setFaceValue(event.target.value)} inputMode="decimal" placeholder="Same as amount paid" />
                  <p className="field-note">A bond bought from another investor is paid for at market price, but the issuer pays interest on the face value printed on it. Leave blank for a deposit.</p>
                </div>
                <Field label="Expected maturity amount (₹)" value={maturityAmount} setValue={setMaturityAmount} inputMode="decimal" placeholder="10,00,000" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="form-section">
              <FormHeading title="Interest schedule" description="We will generate an editable expected payout schedule." />
              <div className="field-grid">
                <div className="form-field"><Label>Interest type</Label><Select value={interestType} onValueChange={(value) => { const nextType = value as InterestType; setInterestType(nextType); if (nextType !== "simple") setFrequency("on-maturity"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="simple">Simple</SelectItem><SelectItem value="compound">Compound</SelectItem><SelectItem value="cumulative">Cumulative</SelectItem></SelectContent></Select></div>
                <Field label="Annual interest rate (%)" value={rate} setValue={setRate} inputMode="decimal" placeholder="9.00" />
                <div className="form-field"><Label>Payout frequency</Label><Select value={frequency} disabled={interestType !== "simple"} onValueChange={(value) => setFrequency(value as PayoutFrequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{payoutOptions.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{interestType !== "simple" && <p className="field-note">Compound/cumulative interest is credited on maturity.</p>}</div>
                {interestType !== "simple" && <div className="form-field"><Label>Compounding frequency</Label><Select value={compoundingFrequency} onValueChange={(value) => setCompoundingFrequency(value as CompoundingFrequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="half-yearly">Half-yearly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></div>}
                <div className="form-field"><Label>Interest day-count basis</Label><Select value={dayCountBasis} onValueChange={(value) => setDayCountBasis(value as DayCountBasis)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="actual-365">Actual / 365</SelectItem><SelectItem value="actual-actual">Actual / Actual</SelectItem><SelectItem value="30-360">30 / 360</SelectItem></SelectContent></Select><p className="field-note">Use the basis printed in the issuer&apos;s terms.</p></div>
                <div className="form-field">
                  <Label htmlFor="field-interest-start">Interest accrues from <span className="field-optional">only if different</span></Label>
                  <Input id="field-interest-start" type="date" value={interestStartDate} onChange={(event) => setInterestStartDate(event.target.value)} max={maturityDate || undefined} />
                  <p className="field-note">Buying a bond part-way through a coupon period means paying the seller the interest earned so far, then collecting the whole coupon. Set the previous coupon date here. Leave blank for a deposit.</p>
                </div>
                {frequency !== "on-maturity" && <Field label="First payout date" value={firstPayoutDate} setValue={setFirstPayoutDate} type="date" min={interestStartDate || investmentDate} max={maturityDate || undefined} />}
                <Field label="Maturity date" value={maturityDate} setValue={setMaturityDate} type="date" />
              </div>
              {firstProjection && <CalculationPreview projection={firstProjection} rate={rate} amount={draft.principalPaise} />}
            </div>
          )}

          {step === 4 && (
            <div className="form-section">
              <FormHeading title="TDS settings" description="Suggested tax values stay editable and are never treated as verified." />
              <ToggleRow
                label="TDS applicable"
                description="Calculate expected deduction for each payout"
                checked={tdsApplicable}
                onCheckedChange={(checked) => {
                  setTdsApplicable(checked);
                  if (checked) setTdsRate((current) => suggestedTdsRate(current, panLinked));
                }}
              />
              {tdsApplicable && (
                <div className="form-field">
                  <Label htmlFor="field-tds-rate">Expected TDS rate (%)</Label>
                  <Input id="field-tds-rate" value={tdsRate} onChange={(event) => setTdsRate(event.target.value)} inputMode="decimal" placeholder={RATE_WITH_PAN} />
                  <p className="field-note">
                    {panLinked
                      ? `${RATE_WITH_PAN}% applies where a PAN is on record.`
                      : `${RATE_WITHOUT_PAN}% applies while no PAN is on record. Linking the PAN halves it.`}
                    {" Use the issuer's own rate wherever it differs."}
                  </p>
                </div>
              )}
              <ToggleRow
                label="PAN linked"
                description={panLinked
                  ? `Deduction runs at ${RATE_WITH_PAN}%. PAN itself is not stored.`
                  : `Without a PAN on record, deduction runs at ${RATE_WITHOUT_PAN}%. PAN itself is not stored.`}
                checked={panLinked}
                onCheckedChange={(checked) => {
                  setPanLinked(checked);
                  if (tdsApplicable) setTdsRate((current) => suggestedTdsRate(current, checked));
                }}
              />
              <ToggleRow
                label="Exemption / declaration applicable"
                description={`${DECLARATION_FORM_TYPE} is filed each financial year. Record it from the Forms tab; a year without one is flagged.`}
                checked={declarationApplicable}
                onCheckedChange={setDeclarationApplicable}
              />
              {firstProjection && (
                <div className="tds-preview">
                  <div><span>Gross interest</span><b>{formatMoney(firstProjection.grossInterestPaise)}</b></div>
                  <div><span>Expected TDS</span><b>− {formatMoney(firstProjection.expectedTdsPaise)}</b></div>
                  <div><span>Expected net payout</span><strong>{formatMoney(firstProjection.expectedNetPaise)}</strong></div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="form-section">
              <FormHeading title="Account & references" description="Account and demat numbers are stored in full for reconciliation, and stay masked on screen." />
              <div className="field-grid">
                <div className="form-field">
                  <Label htmlFor="field-bank-name">Bank name</Label>
                  <Input
                    id="field-bank-name"
                    value={bankName}
                    onChange={(event) => setBankName(event.target.value)}
                    placeholder="Type to search"
                    list={BANK_SUGGESTIONS_ID}
                    maxLength={100}
                    aria-invalid={bankNameInvalid}
                    autoComplete="off"
                  />
                  <datalist id={BANK_SUGGESTIONS_ID}>
                    {allBanks.map((bank) => <option value={bank} key={bank} />)}
                  </datalist>
                  {bankNameInvalid && <p className="field-error">Invalid — a bank name cannot contain numbers.</p>}
                </div>
                <div className="form-field">
                  <Label htmlFor="field-ifsc">IFSC code</Label>
                  <Input
                    id="field-ifsc"
                    value={ifsc}
                    onChange={(event) => setIfsc(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
                    placeholder="e.g. HDFC0001234"
                    autoCapitalize="characters"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={ifscError}
                  />
                  {ifscBranch && <p className="field-note">{ifscBranch}</p>}
                  {ifscError && <p className="field-error">No branch found for this IFSC.</p>}
                </div>
                <MaskedField label="Receiving account number" value={accountNumber} setValue={(value) => setAccountNumber(value.replace(/\D/g, "").slice(0, 18))} inputMode="numeric" placeholder="Account the payouts are credited to" />
                <div className="form-field"><Label>Payment mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank-transfer">Bank transfer</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="broker-wallet">Broker wallet</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                <Field label="Nominee" value={nominee} setValue={setNominee} placeholder="Optional" />
                <Field label="Broker / platform" value={broker} setValue={setBroker} placeholder="Who the purchase went through" maxLength={100} />
                <MaskedField label="DP ID" value={dpId} setValue={setDpId} placeholder="Optional · e.g. IN304877" maxLength={40} />
                <MaskedField label="Demat client ID" value={clientId} setValue={setClientId} placeholder="Optional" maxLength={40} />
                <Field label="Order / settlement reference" value={orderReference} setValue={setOrderReference} placeholder="Optional" maxLength={80} />
                <Field label="Advisor name" value={advisor} setValue={setAdvisor} placeholder="Optional" />
                <Field label="Advisor mobile" value={advisorMobile} setValue={(value) => setAdvisorMobile(value.replace(/\D/g, "").slice(0, 10))} inputMode="tel" placeholder="Optional · 10 digits" />
              </div>
              <div className="form-field"><Label htmlFor="investment-notes">Notes</Label><Textarea id="investment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any helpful reference or instruction" /></div>
              <div className="privacy-note"><LockKeyhole aria-hidden="true" /> Account and demat numbers are stored for reconciliation and stay masked. Do not repeat them in notes.</div>
            </div>
          )}

          {step === 6 && (
            <div className="form-section">
              <FormHeading
                title="Documents & review"
                description={attachments.length
                  ? "Everything listed here is filed with this investment."
                  : bondDocument
                    ? "Attach the bond agreement or deal sheet — a holding without its paperwork is hard to reconcile later."
                    : "Upload a certificate now or add documents later."}
              />
              {attachments.length > 0 && (
                <div className="scanned-file-list">
                  {attachments.map((item) => (
                    <div className="scanned-file" data-selected key={`${item.file.name}:${item.file.size}`}>
                      <FileText aria-hidden="true" />
                      <b>{item.file.name}</b>
                      <small>{documentTypeLabel(item.documentType)}</small>
                      <button
                        type="button"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => setAttachments((current) => current.filter((entry) => entry.file !== item.file))}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="upload-zone">
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? []);
                  event.currentTarget.value = "";
                  const usable = chosen.filter((file) => allowedDocumentTypes.has(file.type) && file.size > 0 && file.size <= MAX_DOCUMENT_BYTES);
                  if (usable.length < chosen.length) toast.error("Each file must be a PDF, JPG, JPEG or PNG up to 10 MB");
                  if (!usable.length) return;
                  setAttachments((current) => {
                    // Re-picking a file already on the list replaces nothing and
                    // adds nothing; without this, saving would upload it twice.
                    const seen = new Set(current.map((entry) => `${entry.file.name}:${entry.file.size}`));
                    const additions = usable
                      .filter((file) => !seen.has(`${file.name}:${file.size}`))
                      .map((file) => ({ file, documentType: certificateType(type) }));
                    return [...current, ...additions].slice(0, MAX_ATTACHMENTS);
                  });
                }} />
                <UploadCloud aria-hidden="true" />
                <b>{attachments.length ? "Add another document" : bondDocument ? "Add bond document" : "Add investment document"}</b>
                <span>PDF, JPG, JPEG or PNG · max 10 MB each · private access</span>
              </label>
              <div className="review-card">
                <span className="review-icon"><Landmark /></span>
                <div><small>{investmentTypes.find((item) => item.value === type)?.title}</small><h3>{issuer || "Issuer name"}</h3><p>{name || "Investment name"}</p></div>
                <div className="review-amount"><small>Principal</small><strong>{formatMoney(draft.principalPaise)}</strong><span>{rate}% p.a.</span></div>
              </div>
              <div className="review-stats">
                <div><span>Expected payouts</span><b>{schedule.length}</b></div>
                <div><span>First expected net</span><b>{firstProjection ? formatMoney(firstProjection.expectedNetPaise) : "Custom"}</b></div>
                <div><span>Maturity</span><b>{formatDate(maturityDate)}</b></div>
              </div>
              <p className="review-disclaimer">Saving creates expected records only. You will confirm actual payouts and verified TDS separately.</p>
            </div>
          )}
        </div>

        <SheetFooter className="add-sheet-footer">
          <Button variant="outline" onClick={() => step === 1 ? onOpenChange(false) : setStep(step - 1)}>{step > 1 && <ChevronLeft />}{step === 1 ? "Cancel" : "Back"}</Button>
          {step < 6 ? <Button onClick={next}>Continue <ChevronRight /></Button> : <Button onClick={() => void save()} disabled={saving}><Check /> {saving ? "Saving…" : "Save investment"}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FormHeading({ title, description }: { title: string; description: string }) {
  return <div className="form-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function Field({ label, value, setValue, ...props }: { label: string; value: string; setValue: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="form-field"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => setValue(event.target.value)} {...props} /></div>;
}

/**
 * A field whose value is hidden until asked for.
 *
 * The DP and client ids together identify a demat account, so they are treated
 * the way the rest of the app treats account numbers — kept out of sight on a
 * screen someone might be sharing or standing beside. They are still stored
 * whole, because reconciling a holding against the depository needs them whole;
 * it is only the display that is guarded.
 */
/** One named document slot, showing what belongs in it and what is in it. */
function ScanSlot({ label, hint, file, disabled, onSelect }: {
  label: string;
  hint: string;
  file: File | null;
  disabled: boolean;
  onSelect: (file: File | null) => void;
}) {
  return (
    <label className="scan-slot" data-filled={file !== null}>
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          event.currentTarget.value = "";
          onSelect(next);
        }}
      />
      {file ? <Check aria-hidden="true" /> : <ScanLine aria-hidden="true" />}
      <b>{label}</b>
      <small>{file ? file.name : hint}</small>
    </label>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="toggle-row"><span><b>{label}</b><small>{description}</small></span><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>;
}

function CalculationPreview({ projection, rate, amount }: { projection: ReturnType<typeof generatePayoutSchedule>[number]; rate: string; amount: bigint }) {
  return (
    <div className="calculation-preview">
      <span className="calculation-icon"><CalendarDays /></span>
      <div><small>First expected payout · {formatDate(projection.dueDate)}</small><strong>{formatMoney(projection.grossInterestPaise)} gross</strong><p>{formatMoney(amount)} × {rate}% × period fraction</p></div>
      <span className="projection-count">Auto</span>
    </div>
  );
}

type ScheduleRow = { dueDate: string; interestPaise: number; principalPaise: number };

async function syncInvestment(investment: PortfolioInvestment, extra: Record<string, string>, schedule: ScheduleRow[], flags: { panLinked: boolean; declarationApplicable: boolean }, files: Attachment[]) {
    const response = await apiFetch(investment.id ? `/api/investments/${investment.id}` : "/api/investments", {
      method: investment.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investmentType: investment.type,
        investmentName: investment.name,
        issuerName: investment.issuer,
        investmentNumber: investment.investmentNumber,
        principalPaise: Number(investment.principalPaise),
        faceValuePaise: investment.faceValuePaise === undefined ? undefined : Number(investment.faceValuePaise),
        interestRateBps: investment.annualRateBps,
        interestType: investment.interestType,
        compoundingFrequency: investment.compoundingFrequency,
        dayCountBasis: investment.dayCountBasis,
        payoutFrequency: investment.payoutFrequency,
        investmentDate: investment.investmentDate,
        interestStartDate: investment.interestStartDate,
        firstPayoutDate: investment.firstPayoutDate,
        maturityDate: investment.maturityDate,
        expectedMaturityPaise: investment.expectedMaturityPaise === undefined ? undefined : Number(investment.expectedMaturityPaise),
        tdsApplicable: investment.tdsApplicable,
        expectedTdsRateBps: investment.expectedTdsRateBps,
        panLinked: flags.panLinked,
        declarationApplicable: flags.declarationApplicable,
        bankName: extra.bankName,
        ifscCode: extra.ifscCode,
        accountNumber: extra.accountNumber,
        // Sent only when the documents supplied one; otherwise the server
        // projects the schedule from the rate as before.
        repaymentSchedule: schedule.length ? schedule : undefined,
        paymentMode: extra.paymentMode,
        nominee: extra.nominee,
        brokerPlatform: extra.broker,
        dpId: extra.dpId,
        clientId: extra.clientId,
        orderReference: extra.orderReference,
        advisorName: extra.advisor,
        advisorMobile: extra.advisorMobile,
        notes: extra.notes,
      }),
    });
    const result = await response.json() as { investmentId?: string; scheduleCount?: number; warning?: string | null; error?: string };
    if (!response.ok || !result.investmentId) throw new Error(result.error ?? "Investment could not be saved");
    // Uploaded one at a time so a single rejected file cannot take the rest
    // with it; the investment is already saved either way.
    let failed = 0;
    for (const attachment of files) {
      const upload = await uploadDocumentFile(attachment.file, {
        investmentId: result.investmentId,
        documentType: attachment.documentType,
        financialYear: investment.schedule[0]?.financialYear ?? "",
      });
      if (!upload.ok) failed += 1;
    }
    if (failed) {
      toast.warning(failed === files.length
        ? "Investment saved, but the documents need to be uploaded again"
        : `Investment saved. ${failed} of ${files.length} documents need to be uploaded again`);
    }
    return { investmentId: result.investmentId, scheduleCount: result.scheduleCount ?? investment.schedule.length, warning: result.warning };
}

function isBondType(type: InvestmentType) {
  return ["corporate-bond", "government-bond", "ncd", "debenture", "government-security"].includes(type);
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function paiseToInput(value: bigint) {
  const rupees = value / 100n;
  const paise = value % 100n;
  return paise ? `${rupees}.${paise.toString().padStart(2, "0")}` : rupees.toString();
}
