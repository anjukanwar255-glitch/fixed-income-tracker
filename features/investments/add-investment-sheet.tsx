"use client";

import { useMemo, useState } from "react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { indianBankGroups } from "@/core/data/indian-banks";
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
const MANUAL_BANK = "manual-bank";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const knownBanks: Set<string> = new Set(indianBankGroups.flatMap((group) => group.banks));
const ISSUER_SUGGESTIONS_ID = "issuer-bank-suggestions";

const payoutOptions: { value: PayoutFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "on-maturity", label: "On maturity" },
];

const investmentTypes: { value: InvestmentType; title: string; note: string; icon: typeof Landmark }[] = [
  { value: "fixed-deposit", title: "Fixed Deposit", note: "Bank or small finance bank", icon: Landmark },
  { value: "corporate-fd", title: "Corporate FD", note: "Company fixed deposit", icon: Building2 },
  { value: "corporate-bond", title: "Corporate Bond", note: "Listed or unlisted bond", icon: Banknote },
  { value: "government-bond", title: "Government Bond", note: "Sovereign bond", icon: Landmark },
  { value: "ncd", title: "NCD", note: "Non-convertible debenture", icon: ReceiptIndianRupee },
  { value: "debenture", title: "Debenture", note: "Other debenture", icon: FileText },
  { value: "government-security", title: "Government Security", note: "T-bill or G-Sec", icon: Landmark },
  { value: "other", title: "Other", note: "Custom fixed-income product", icon: FileText },
];

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
  const [bankOption, setBankOption] = useState(() => initialInvestment?.bankName ? (knownBanks.has(initialInvestment.bankName) ? initialInvestment.bankName : MANUAL_BANK) : "");
  const [manualBankName, setManualBankName] = useState(() => initialInvestment?.bankName && !knownBanks.has(initialInvestment.bankName) ? initialInvestment.bankName : "");
  const [accountNumber, setAccountNumber] = useState(initialInvestment?.accountNumber ?? "");
  const [paymentMode, setPaymentMode] = useState(initialInvestment?.paymentMode ?? "bank-transfer");
  const [nominee, setNominee] = useState(initialInvestment?.nominee ?? "");
  const [broker, setBroker] = useState(initialInvestment?.brokerPlatform ?? "");
  const [dpId, setDpId] = useState(initialInvestment?.dpId ?? "");
  const [clientId, setClientId] = useState(initialInvestment?.clientId ?? "");
  const [orderReference, setOrderReference] = useState(initialInvestment?.orderReference ?? "");
  const [advisor, setAdvisor] = useState(initialInvestment?.advisorName ?? "");
  const [notes, setNotes] = useState(initialInvestment?.notes ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  /**
   * Documents that came from a scan, carried forward so step 6 already has
   * them: they are the certificate this investment should be filed with, and
   * asking for them a second time is asking for the same files twice.
   */
  const [scannedFiles, setScannedFiles] = useState<File[]>([]);
  /**
   * The two documents are held in named slots rather than one heap, so it is
   * clear which paper is which — both to whoever is filling the form and to
   * the reader, which is told the role of each file it is given.
   */
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
      applyText(found.investmentDate, setInvestmentDate);
      applyNumber(found.amountPaidRupees, setAmount);
      applyNumber(found.faceValueRupees, setFaceValue);
      applyNumber(found.expectedMaturityRupees, setMaturityAmount);
      applyNumber(found.interestRatePercent, setRate);
      applyText(found.firstPayoutDate, setFirstPayoutDate);
      applyText(found.maturityDate, setMaturityDate);
      applyText(found.notes, setNotes);

      const scannedFrequency = typeof found.payoutFrequency === "string" ? found.payoutFrequency as PayoutFrequency : null;
      if (scannedFrequency) { setFrequency(scannedFrequency); filled += 1; }
      if (typeof found.dayCountBasis === "string") { setDayCountBasis(found.dayCountBasis as DayCountBasis); filled += 1; }
      if (typeof found.interestType === "string") { setInterestType(found.interestType as InterestType); filled += 1; }

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

      // These are the papers this investment should be filed with, so they
      // carry through to the documents step instead of being asked for twice.
      const files = attached.map((entry) => entry.file);
      setScannedFiles(files);
      setSelectedFile(files[0]);

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

  const resolvedBankName = bankOption === MANUAL_BANK ? manualBankName.trim() : bankOption;
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
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      setStep(5);
      toast.error("Enter a valid account number (9 to 18 digits)");
      return;
    }
    if (selectedFile && (!allowedDocumentTypes.has(selectedFile.type) || selectedFile.size <= 0 || selectedFile.size > MAX_DOCUMENT_BYTES)) {
      toast.error("Upload a PDF, JPG, JPEG or PNG up to 10 MB");
      return;
    }
    // A bond has to be filed with its paperwork: the terms live in the
    // agreement, not in this form, and a holding with no document behind it
    // cannot be reconciled against the broker later. Scanning already supplies
    // one, so this only stops someone who typed everything by hand.
    if (bondDocument && !selectedFile && !initialInvestment) {
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
      const result = await syncInvestment(investment, { bankName: resolvedBankName, accountNumber, paymentMode, nominee, broker, dpId, clientId, orderReference, advisor, notes }, { panLinked, declarationApplicable }, selectedFile);
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
    setDeclarationApplicable(false); setBankOption(""); setManualBankName(""); setAccountNumber(""); setPaymentMode("bank-transfer");
    setNominee(""); setBroker(""); setAdvisor(""); setNotes(""); setSelectedFile(null);
    setFaceValue(""); setInterestStartDate(""); setDpId(""); setClientId(""); setOrderReference("");
    setScannedFiles([]); setDealSheetFile(null); setScheduleFile(null);
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
              <ToggleRow label="TDS applicable" description="Calculate expected deduction for each payout" checked={tdsApplicable} onCheckedChange={setTdsApplicable} />
              {tdsApplicable && <Field label="Expected TDS rate (%)" value={tdsRate} setValue={setTdsRate} inputMode="decimal" placeholder="10.00" />}
              <ToggleRow label="PAN linked" description="Stored as a status only; PAN stays masked" checked={panLinked} onCheckedChange={setPanLinked} />
              <ToggleRow label="Exemption / declaration applicable" description="Track form submission by financial year" checked={declarationApplicable} onCheckedChange={setDeclarationApplicable} />
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
              <FormHeading title="Account & references" description="Only the last four account digits are displayed or stored here." />
              <div className="field-grid">
                <div className="form-field">
                  <Label>Bank name</Label>
                  <Select value={bankOption} onValueChange={setBankOption}>
                    <SelectTrigger><SelectValue placeholder="Choose receiving bank" /></SelectTrigger>
                    <SelectContent position="popper" className="bank-select-content">
                      {indianBankGroups.map((group, index) => (
                        <SelectGroup key={group.label}>
                          {index > 0 && <SelectSeparator />}
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.banks.map((bank) => <SelectItem value={bank} key={bank}>{bank}</SelectItem>)}
                        </SelectGroup>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={MANUAL_BANK}>Other bank — enter manually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {bankOption === MANUAL_BANK && <Field label="Enter bank name" value={manualBankName} setValue={setManualBankName} placeholder="Type the receiving bank" maxLength={100} autoFocus />}
                <MaskedField label="Receiving account number" value={accountNumber} setValue={(value) => setAccountNumber(value.replace(/\D/g, "").slice(0, 18))} inputMode="numeric" placeholder="Account the payouts are credited to" />
                <div className="form-field"><Label>Payment mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank-transfer">Bank transfer</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="broker-wallet">Broker wallet</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                <Field label="Nominee" value={nominee} setValue={setNominee} placeholder="Optional" />
                <Field label="Broker / platform" value={broker} setValue={setBroker} placeholder="Who the purchase went through" maxLength={100} />
                <MaskedField label="DP ID" value={dpId} setValue={setDpId} placeholder="Optional · e.g. IN304877" maxLength={40} />
                <MaskedField label="Demat client ID" value={clientId} setValue={setClientId} placeholder="Optional" maxLength={40} />
                <Field label="Order / settlement reference" value={orderReference} setValue={setOrderReference} placeholder="Optional" maxLength={80} />
                <Field label="Advisor name" value={advisor} setValue={setAdvisor} placeholder="Optional" />
              </div>
              <div className="form-field"><Label htmlFor="investment-notes">Notes</Label><Textarea id="investment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any helpful reference or instruction" /></div>
              <div className="privacy-note"><LockKeyhole aria-hidden="true" /> Account and demat numbers are stored for reconciliation and stay masked. Do not repeat them in notes.</div>
            </div>
          )}

          {step === 6 && (
            <div className="form-section">
              <FormHeading
                title="Documents & review"
                description={scannedFiles.length
                  ? "Carried over from the scan. Choose which one to file with this investment."
                  : bondDocument
                    ? "Attach the bond agreement or deal sheet — a holding without its paperwork is hard to reconcile later."
                    : "Upload a certificate now or add documents later."}
              />
              {/*
                Files that came from a scan are offered as choices rather than
                re-requested. They are already on the device and already read;
                asking for them again is asking twice for the same thing.
              */}
              {scannedFiles.length > 0 && (
                <div className="scanned-file-list" role="radiogroup" aria-label="Document to file">
                  {scannedFiles.map((file) => (
                    <label key={file.name} className="scanned-file" data-selected={selectedFile?.name === file.name}>
                      <input
                        type="radio"
                        name="scanned-document"
                        checked={selectedFile?.name === file.name}
                        onChange={() => setSelectedFile(file)}
                      />
                      <FileText aria-hidden="true" />
                      <b>{file.name}</b>
                      {selectedFile?.name === file.name && <Check aria-hidden="true" />}
                    </label>
                  ))}
                </div>
              )}
              <label className="upload-zone">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && (!allowedDocumentTypes.has(file.type) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES)) {
                    event.currentTarget.value = "";
                    toast.error("Upload a PDF, JPG, JPEG or PNG up to 10 MB");
                    return;
                  }
                  if (file) setSelectedFile(file);
                }} />
                <UploadCloud aria-hidden="true" />
                <b>{scannedFiles.length ? "Attach a different document" : selectedFile?.name ?? (bondDocument ? "Add bond document" : "Add investment document")}</b>
                <span>PDF, JPG, JPEG or PNG · max 10 MB · private access</span>
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

async function syncInvestment(investment: PortfolioInvestment, extra: Record<string, string>, flags: { panLinked: boolean; declarationApplicable: boolean }, file: File | null) {
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
        accountNumber: extra.accountNumber,
        paymentMode: extra.paymentMode,
        nominee: extra.nominee,
        brokerPlatform: extra.broker,
        dpId: extra.dpId,
        clientId: extra.clientId,
        orderReference: extra.orderReference,
        advisorName: extra.advisor,
        notes: extra.notes,
      }),
    });
    const result = await response.json() as { investmentId?: string; scheduleCount?: number; warning?: string | null; error?: string };
    if (!response.ok || !result.investmentId) throw new Error(result.error ?? "Investment could not be saved");
    if (file) {
      const upload = await uploadDocumentFile(file, {
        investmentId: result.investmentId,
        documentType: isBondType(investment.type) ? "bond-certificate" : "investment-certificate",
        financialYear: investment.schedule[0]?.financialYear ?? "",
      });
      if (!upload.ok) toast.warning("Investment saved, but the document needs to be uploaded again");
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
