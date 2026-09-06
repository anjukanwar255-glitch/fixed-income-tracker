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
  LockKeyhole,
  ReceiptIndianRupee,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, generatePayoutSchedule, parseRupeesToPaise } from "@/core/finance/calculations";
import type { InterestType, InvestmentType, PayoutFrequency, PortfolioInvestment } from "@/core/models/financial";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (investmentId: string) => Promise<void> | void;
};

const steps = ["Type", "Details", "Interest", "TDS", "Account", "Documents"];

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

export function AddInvestmentSheet({ open, onOpenChange, onSave }: Props) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<InvestmentType>("fixed-deposit");
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [number, setNumber] = useState("");
  const [investmentDate, setInvestmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [maturityAmount, setMaturityAmount] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("simple");
  const [frequency, setFrequency] = useState<PayoutFrequency>("quarterly");
  const [firstPayoutDate, setFirstPayoutDate] = useState("");
  const [tdsApplicable, setTdsApplicable] = useState(false);
  const [tdsRate, setTdsRate] = useState("");
  const [panLinked, setPanLinked] = useState(false);
  const [declarationApplicable, setDeclarationApplicable] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountLast4, setAccountLast4] = useState("");
  const [paymentMode, setPaymentMode] = useState("bank-transfer");
  const [nominee, setNominee] = useState("");
  const [broker, setBroker] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = useMemo(() => ({
    type,
    name: name || "New investment",
    issuer: issuer || "Issuer",
    investmentNumber: number,
    investmentDate,
    principalPaise: parseRupeesToPaise(amount),
    annualRateBps: Math.round((Number(rate) || 0) * 100),
    interestType,
    payoutFrequency: frequency,
    firstPayoutDate,
    maturityDate,
    expectedMaturityPaise: maturityAmount ? parseRupeesToPaise(maturityAmount) : undefined,
    tdsApplicable,
    expectedTdsRateBps: tdsApplicable ? Math.round((Number(tdsRate) || 0) * 100) : 0,
  }), [amount, firstPayoutDate, frequency, interestType, investmentDate, issuer, maturityAmount, maturityDate, name, number, rate, tdsApplicable, tdsRate, type]);

  const schedule = useMemo(() => {
    try { return generatePayoutSchedule(draft); } catch { return []; }
  }, [draft]);
  const firstProjection = schedule[0];

  const next = () => {
    if (step === 2 && (!name.trim() || !issuer.trim() || parseRupeesToPaise(amount) <= 0n)) {
      toast.error("Add the investment name, issuer and a valid amount");
      return;
    }
    if (step === 3 && (!rate || !maturityDate || !firstPayoutDate || maturityDate <= investmentDate || firstPayoutDate < investmentDate)) {
      toast.error("Check the interest rate and payout dates");
      return;
    }
    setStep((current) => Math.min(6, current + 1));
  };

  const save = async () => {
    if (accountLast4 && !/^\d{4}$/.test(accountLast4)) {
      setStep(5);
      toast.error("Enter only the last 4 account digits");
      return;
    }
    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) {
      toast.error("Document must be 10 MB or smaller");
      return;
    }
    const investment: PortfolioInvestment = {
      ...draft,
      id: "",
      status: "active",
      schedule,
      documents: [],
      forms: [],
      activity: [],
    };
    setSaving(true);
    try {
      const result = await syncInvestment(investment, { bankName, accountLast4, paymentMode, nominee, broker, advisor, notes }, { panLinked, declarationApplicable }, selectedFile);
      if (result.warning) toast.warning(result.warning);
      await onSave(result.investmentId);
      onOpenChange(false);
      resetForm();
      toast.success(`${name} saved with ${result.scheduleCount} expected payouts`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Investment could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStep(1); setType("fixed-deposit"); setName(""); setIssuer(""); setNumber("");
    setInvestmentDate(new Date().toISOString().slice(0, 10)); setAmount(""); setRate("");
    setMaturityDate(""); setMaturityAmount(""); setInterestType("simple"); setFrequency("quarterly");
    setFirstPayoutDate(""); setTdsApplicable(false); setTdsRate(""); setPanLinked(false);
    setDeclarationApplicable(false); setBankName(""); setAccountLast4(""); setPaymentMode("bank-transfer");
    setNominee(""); setBroker(""); setAdvisor(""); setNotes(""); setSelectedFile(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="add-investment-sheet" showCloseButton>
        <SheetHeader className="add-sheet-header">
          <div className="add-sheet-title-row">
            <span className="brand-mark mini"><Landmark aria-hidden="true" /></span>
            <div><SheetTitle>Add investment</SheetTitle><SheetDescription>Step {step} of 6 · {steps[step - 1]}</SheetDescription></div>
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
              <div className="field-grid">
                <Field label="Investment name" value={name} setValue={setName} placeholder="e.g. Secure Income FD" />
                <Field label="Issuer / bank / company" value={issuer} setValue={setIssuer} placeholder="Name shown on the certificate" />
                <Field label="FD / folio / bond number" value={number} setValue={setNumber} placeholder="Certificate number" />
                <Field label="Investment date" value={investmentDate} setValue={setInvestmentDate} type="date" />
                <Field label="Investment amount (₹)" value={amount} setValue={setAmount} inputMode="decimal" placeholder="10,00,000" />
                <Field label="Expected maturity amount (₹)" value={maturityAmount} setValue={setMaturityAmount} inputMode="decimal" placeholder="10,00,000" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="form-section">
              <FormHeading title="Interest schedule" description="We will generate an editable expected payout schedule." />
              <div className="field-grid">
                <div className="form-field"><Label>Interest type</Label><Select value={interestType} onValueChange={(value) => setInterestType(value as InterestType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="simple">Simple</SelectItem><SelectItem value="compound">Compound</SelectItem><SelectItem value="cumulative">Cumulative</SelectItem></SelectContent></Select></div>
                <Field label="Annual interest rate (%)" value={rate} setValue={setRate} inputMode="decimal" placeholder="9.00" />
                <div className="form-field"><Label>Payout frequency</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as PayoutFrequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="half-yearly">Half-yearly</SelectItem><SelectItem value="yearly">Yearly</SelectItem><SelectItem value="on-maturity">On maturity</SelectItem><SelectItem value="custom">Custom schedule</SelectItem></SelectContent></Select></div>
                <Field label="First payout date" value={firstPayoutDate} setValue={setFirstPayoutDate} type="date" />
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
                <Field label="Bank name" value={bankName} setValue={setBankName} placeholder="Receiving bank" />
                <Field label="Account last 4 digits" value={accountLast4} setValue={(value) => setAccountLast4(value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" />
                <div className="form-field"><Label>Payment mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank-transfer">Bank transfer</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="broker-wallet">Broker wallet</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                <Field label="Nominee" value={nominee} setValue={setNominee} placeholder="Optional" />
                <Field label="Broker / platform" value={broker} setValue={setBroker} placeholder="Optional" />
                <Field label="Advisor name" value={advisor} setValue={setAdvisor} placeholder="Optional" />
              </div>
              <div className="form-field"><Label htmlFor="investment-notes">Notes</Label><Textarea id="investment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any helpful reference or instruction" /></div>
              <div className="privacy-note"><LockKeyhole aria-hidden="true" /> Full bank details are not required and should not be entered in notes.</div>
            </div>
          )}

          {step === 6 && (
            <div className="form-section">
              <FormHeading title="Documents & review" description="Upload a certificate now or add documents later." />
              <label className="upload-zone">
                <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
                <UploadCloud aria-hidden="true" />
                <b>{selectedFile?.name ?? "Add investment document"}</b>
                <span>PDF, JPG or PNG · private access</span>
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
    const response = await fetch("/api/investments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investmentType: investment.type,
        investmentName: investment.name,
        issuerName: investment.issuer,
        investmentNumber: investment.investmentNumber,
        principalPaise: Number(investment.principalPaise),
        interestRateBps: investment.annualRateBps,
        interestType: investment.interestType,
        payoutFrequency: investment.payoutFrequency,
        investmentDate: investment.investmentDate,
        firstPayoutDate: investment.firstPayoutDate,
        maturityDate: investment.maturityDate,
        expectedMaturityPaise: investment.expectedMaturityPaise === undefined ? undefined : Number(investment.expectedMaturityPaise),
        tdsApplicable: investment.tdsApplicable,
        expectedTdsRateBps: investment.expectedTdsRateBps,
        panLinked: flags.panLinked,
        declarationApplicable: flags.declarationApplicable,
        bankName: extra.bankName,
        accountLast4: extra.accountLast4,
        paymentMode: extra.paymentMode,
        nominee: extra.nominee,
        brokerPlatform: extra.broker,
        advisorName: extra.advisor,
        notes: extra.notes,
      }),
    });
    const result = await response.json() as { investmentId?: string; scheduleCount?: number; warning?: string | null; error?: string };
    if (!response.ok || !result.investmentId) throw new Error(result.error ?? "Investment could not be saved");
    if (file) {
      const body = new FormData();
      body.set("file", file);
      body.set("investmentId", result.investmentId);
      body.set("documentType", "investment-certificate");
      body.set("financialYear", investment.schedule[0]?.financialYear ?? "");
      const upload = await fetch("/api/documents", { method: "POST", body });
      if (!upload.ok) toast.warning("Investment saved, but the document needs to be uploaded again");
    }
    return { investmentId: result.investmentId, scheduleCount: result.scheduleCount ?? investment.schedule.length, warning: result.warning };
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
