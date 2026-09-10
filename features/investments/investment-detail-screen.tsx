"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  History,
  Landmark,
  Pencil,
  ShieldCheck,
  Upload,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { MaskedField } from "@/components/masked-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { calculateFinancialYear, calculateInterest, formatMoney, parseRupeesToPaise } from "@/core/finance/calculations";
import { DECLARATION_FORM_TYPE, declarationPending } from "@/core/tax/declarations";
import { contributionTotals } from "@/core/finance/contributions";
import { earnsInterest, holdsUnits, providesCover } from "@/core/data/investment-types";
import { apiFetch, downloadDocument, uploadDocumentFile } from "@/lib/firebase-client";
import type { PayoutProjection, PortfolioInvestment } from "@/core/models/financial";

type Props = {
  investment: PortfolioInvestment;
  onBack: () => void;
  onDataChanged: () => Promise<boolean>;
  onEdit: () => void;
};

type PayoutDialog = { payout: PayoutProjection; outcome: "received" | "not-received" } | null;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

export function InvestmentDetailScreen({ investment, onBack, onDataChanged, onEdit }: Props) {
  const [payoutDialog, setPayoutDialog] = useState<PayoutDialog>(null);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [actualTds, setActualTds] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [payoutRemarks, setPayoutRemarks] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);
  const [tdsDialog, setTdsDialog] = useState<PayoutProjection | null>(null);
  const [tdsReflected, setTdsReflected] = useState(true);
  const [reflectedAmount, setReflectedAmount] = useState("");
  const [verificationDate, setVerificationDate] = useState(todayIso());
  const [tdsRemarks, setTdsRemarks] = useState("");
  const [savingTds, setSavingTds] = useState(false);
  const [contributionDialog, setContributionDialog] = useState<{ entry: PortfolioInvestment["contributions"][number]; outcome: "paid" | "missed" } | null>(null);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidDate, setPaidDate] = useState(todayIso());
  const [paidReference, setPaidReference] = useState("");
  const [savingContribution, setSavingContribution] = useState(false);
  const [declarationOpen, setDeclarationOpen] = useState(false);
  const [declarationStatus, setDeclarationStatus] = useState("submitted");
  const [declarationDate, setDeclarationDate] = useState(todayIso());
  const [acknowledgement, setAcknowledgement] = useState("");
  const [savingDeclaration, setSavingDeclaration] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const lent = earnsInterest(investment.type);
  const unitPriced = holdsUnits(investment.type);
  const covered = providesCover(investment.type);
  const contributions = investment.contributions ?? [];
  const totals = contributionTotals(contributions);
  const contributionLabel = covered ? "Premiums" : "Instalments";

  const annualInterest = calculateInterest(investment.principalPaise, investment.annualRateBps);
  const receivedSchedules = investment.schedule.filter((item) => item.status === "received" || item.status === "partial-received");
  // A credit on an amortising bond is part interest and part principal
  // coming back. Counting the whole of it as interest would overstate the
  // return and, at the year end, the income being declared.
  const principalReceived = receivedSchedules.reduce((sum, item) => sum + item.principalRepaidPaise, 0n);
  const grossReceived = receivedSchedules.reduce((sum, item) => sum + (item.receivedAmountPaise ?? 0n) + (item.actualTdsPaise ?? 0n) - item.principalRepaidPaise, 0n);
  const netReceived = receivedSchedules.reduce((sum, item) => sum + (item.receivedAmountPaise ?? 0n) - item.principalRepaidPaise, 0n);
  const actualTdsTotal = receivedSchedules.reduce((sum, item) => sum + (item.actualTdsPaise ?? 0n), 0n);
  const expectedTdsTotal = investment.schedule.reduce((sum, item) => sum + item.expectedTdsPaise, 0n);
  const reflectedTdsTotal = investment.schedule.reduce((sum, item) => sum + (item.reflectedAmountPaise ?? 0n), 0n);
  const nextPayout = investment.schedule.find((item) => !["received", "partial-received"].includes(item.status));
  /*
   * A holding that earns no interest has no interest to report. Showing the
   * same nine tiles for a stock would fill most of them with zeroes and a
   * maturity amount it will never reach — which reads as a broken record
   * rather than as a different kind of holding.
   */
  const marketValue = unitPriced && investment.units && investment.currentPricePerUnitPaise !== undefined
    ? BigInt(Math.round(investment.units * Number(investment.currentPricePerUnitPaise)))
    : null;
  const nextDue = contributions.find((entry) => entry.status !== "paid" && entry.status !== "missed");

  const summary = unitPriced
    ? [
      ["Invested", formatMoney(investment.principalPaise)],
      ["Units held", investment.units ? String(investment.units) : "—"],
      ["Cost per unit", investment.costPerUnitPaise === undefined ? "—" : formatMoney(investment.costPerUnitPaise, 2)],
      ["Current price", investment.currentPricePerUnitPaise === undefined ? "Not entered" : formatMoney(investment.currentPricePerUnitPaise, 2)],
      ["Current value", marketValue === null ? "Enter a price" : formatMoney(marketValue)],
      ["Gain / loss", marketValue === null ? "—" : formatMoney(marketValue - investment.principalPaise)],
      ["Paid in so far", formatMoney(totals.paid > 0n ? totals.paid : investment.principalPaise)],
      ["Next instalment", nextDue ? formatDate(nextDue.dueDate) : "—"],
      ["Valued on", investment.valuationDate ? formatDate(investment.valuationDate) : "—"],
    ]
    : covered
      ? [
        ["Sum assured", investment.sumAssuredPaise === undefined ? "—" : formatMoney(investment.sumAssuredPaise)],
        ["Premium", investment.contributionPaise === undefined ? "—" : formatMoney(investment.contributionPaise)],
        ["Premiums paid", formatMoney(totals.paid)],
        ["Premiums scheduled", formatMoney(totals.scheduled)],
        ["Missed", String(totals.missed)],
        ["Next premium", nextDue ? formatDate(nextDue.dueDate) : "—"],
        ["Policy number", investment.policyNumber ?? "—"],
        ["Maturity", investment.maturityDate ? formatDate(investment.maturityDate) : "No maturity value"],
        ["Maturity benefit", investment.expectedMaturityPaise === undefined ? "—" : formatMoney(investment.expectedMaturityPaise)],
      ]
      : [
        ["Principal", formatMoney(investment.principalPaise)],
        ["Annual interest", formatMoney(annualInterest)],
        ["Interest received", formatMoney(grossReceived)],
        ["Pending interest", formatMoney(annualInterest > grossReceived ? annualInterest - grossReceived : 0n)],
        ["Principal repaid", formatMoney(principalReceived)],
        ["TDS deducted", formatMoney(actualTdsTotal)],
        ["Net interest", formatMoney(netReceived)],
        ["Next payout", nextPayout ? formatDate(nextPayout.dueDate) : "—"],
        ["Maturity amount", formatMoney(investment.expectedMaturityPaise ?? investment.principalPaise)],
      ];


  const openContribution = (entry: PortfolioInvestment["contributions"][number], outcome: "paid" | "missed") => {
    setContributionDialog({ entry, outcome });
    setPaidAmount(outcome === "paid" ? paiseToInput(entry.amountPaise) : "");
    setPaidDate(todayIso());
    setPaidReference("");
  };

  const saveContribution = async () => {
    if (!contributionDialog) return;
    setSavingContribution(true);
    try {
      const response = await apiFetch("/api/contributions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contributionId: contributionDialog.entry.id,
          outcome: contributionDialog.outcome,
          paidAmountPaise: contributionDialog.outcome === "paid" ? Number(parseRupeesToPaise(paidAmount)) : undefined,
          paidDate: contributionDialog.outcome === "paid" ? paidDate : undefined,
          paymentReference: paidReference || undefined,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The payment could not be saved");
      await onDataChanged();
      setContributionDialog(null);
      toast.success(contributionDialog.outcome === "paid" ? "Payment recorded" : "Marked as missed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The payment could not be saved");
    } finally {
      setSavingContribution(false);
    }
  };

  const currentFinancialYear = calculateFinancialYear(todayIso());
  const declarationDue = declarationPending(investment, currentFinancialYear);

  const saveDeclaration = async () => {
    setSavingDeclaration(true);
    try {
      const response = await apiFetch("/api/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investmentId: investment.id,
          financialYear: currentFinancialYear,
          status: declarationStatus,
          submissionDate: declarationStatus === "submitted" || declarationStatus === "accepted" ? declarationDate : undefined,
          acknowledgementNumber: acknowledgement || undefined,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The declaration could not be saved");
      await onDataChanged();
      setDeclarationOpen(false);
      setAcknowledgement("");
      toast.success(`${DECLARATION_FORM_TYPE} recorded for ${currentFinancialYear}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The declaration could not be saved");
    } finally {
      setSavingDeclaration(false);
    }
  };

  const openPayout = (payout: PayoutProjection, outcome: "received" | "not-received") => {
    setPayoutDialog({ payout, outcome });
    setReceivedAmount(outcome === "received" ? paiseToInput(payout.expectedNetPaise) : "");
    setActualTds(outcome === "received" ? paiseToInput(payout.expectedTdsPaise) : "");
    setReceivedDate(todayIso()); setAccountNumber(investment.accountNumber ?? ""); setPaymentReference(""); setFollowUpDate(""); setPayoutRemarks("");
  };

  const savePayout = async () => {
    if (!payoutDialog) return;
    if (payoutDialog.outcome === "received" && parseRupeesToPaise(receivedAmount) < 0n) return;
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      toast.error("Enter a valid account number (9 to 18 digits)"); return;
    }
    setSavingPayout(true);
    try {
      const response = await apiFetch("/api/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduleId: payoutDialog.payout.id,
          outcome: payoutDialog.outcome,
          receivedAmountPaise: payoutDialog.outcome === "received" ? Number(parseRupeesToPaise(receivedAmount)) : undefined,
          receivedDate: payoutDialog.outcome === "received" ? receivedDate : undefined,
          actualTdsPaise: payoutDialog.outcome === "received" ? Number(parseRupeesToPaise(actualTds)) : undefined,
          principalRepaidPaise: Number(payoutDialog.payout.principalRepaidPaise),
          bankAccountNumber: accountNumber,
          paymentReference,
          followUpDate: payoutDialog.outcome === "not-received" && followUpDate ? followUpDate : undefined,
          remarks: payoutRemarks,
        }),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? "Payout could not be saved");
      await onDataChanged();
      setPayoutDialog(null);
      toast.success(payoutDialog.outcome === "received" ? "Payout confirmation saved" : "Payout marked not received");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payout could not be saved");
    } finally {
      setSavingPayout(false);
    }
  };

  const openTdsVerification = (payout: PayoutProjection) => {
    setTdsDialog(payout); setTdsReflected(true);
    setReflectedAmount(paiseToInput(payout.actualTdsPaise ?? payout.expectedTdsPaise));
    setVerificationDate(todayIso()); setTdsRemarks("");
  };

  const saveTdsVerification = async () => {
    if (!tdsDialog) return;
    setSavingTds(true);
    try {
      const response = await apiFetch("/api/tds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduleId: tdsDialog.id,
          reflected: tdsReflected,
          reflectedAmountPaise: Number(parseRupeesToPaise(tdsReflected ? reflectedAmount : "0")),
          verificationDate,
          remarks: tdsRemarks,
        }),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? "TDS verification could not be saved");
      await onDataChanged(); setTdsDialog(null);
      toast.success(result.status === "matched" ? "TDS credit matched" : "TDS verification saved with a mismatch");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "TDS verification could not be saved");
    } finally {
      setSavingTds(false);
    }
  };

  const saveDocument = async (documentId: string, fileName: string) => {
    try {
      await downloadDocument(documentId, fileName);
    } catch {
      toast.error("Document could not be downloaded");
    }
  };

  const uploadDocument = async (file?: File) => {
    if (!file) return;
    if (!allowedDocumentTypes.has(file.type) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
      toast.error("Upload a PDF, JPG, JPEG or PNG up to 10 MB");
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const response = await uploadDocumentFile(file, {
        investmentId: investment.id,
        documentType: isBondType(investment.type) ? "bond-document" : "investment-document",
        financialYear: calculateFinancialYear(investment.investmentDate),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Document could not be uploaded");
      await onDataChanged(); toast.success("Document uploaded securely");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document could not be uploaded");
    } finally {
      setUploading(false); if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const updateInvestmentStatus = async (action: "mature" | "close" | "archive") => {
    setStatusBusy(true);
    try {
      const response = await apiFetch(`/api/investments/${investment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Investment could not be updated");
      await onDataChanged();
      toast.success(action === "archive" ? "Investment archived" : `Investment marked ${action === "mature" ? "matured" : "closed"}`);
      if (action === "archive") onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Investment could not be updated");
    } finally {
      setStatusBusy(false);
    }
  };

  const deleteDocument = async (documentId: string) => {
    if (!window.confirm("Permanently delete this document? This cannot be undone.")) return;
    const response = await apiFetch(`/api/documents/${documentId}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { toast.error(result.error ?? "Document could not be deleted"); return; }
    await onDataChanged();
    toast.success("Document deleted");
  };

  return (
    <div className="screen detail-screen">
      <button className="back-button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Investments</button>
      <section className="detail-hero">
        <div className="detail-icon"><Landmark aria-hidden="true" /></div>
        <div className="detail-title">
          <span>{labelType(investment.type)}</span><h1>{investment.issuer}</h1>
          <p>{investment.name}{investment.investmentNumber ? ` · •••• ${investment.investmentNumber.slice(-4)}` : ""}</p>
        </div>
        <Badge className={investment.status === "active" ? "status-active" : "status-upcoming"}>{labelType(investment.status)}</Badge>
        <div className="detail-actions">
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
          {investment.status === "active" && <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void updateInvestmentStatus("mature")}><CheckCircle2 /> Mark matured</Button>}
          <Button size="sm" variant="ghost" disabled={statusBusy} onClick={() => void updateInvestmentStatus("archive")}><Archive /> Archive</Button>
        </div>
        <div className="detail-key-numbers">
          <div><span>Investment</span><strong>{formatMoney(investment.principalPaise)}</strong></div>
          <div><span>Interest rate</span><strong>{(investment.annualRateBps / 100).toFixed(2)}% <small>p.a.</small></strong></div>
          <div><span>Maturity</span><strong>{formatDate(investment.maturityDate)}</strong></div>
        </div>
      </section>

      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList variant="line" className="detail-tab-list scrollbar-none">
          {[
            ["overview", "Overview"],
            ...(lent ? [["payouts", "Payouts"], ["tds", "TDS"]] : []),
            ...(contributions.length ? [["contributions", contributionLabel]] : []),
            ["documents", "Documents"],
            ...(lent ? [["forms", "Forms"]] : []),
            ["activity", "Activity"],
          ].map(([value, label]) => <TabsTrigger value={value} key={value}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="detail-tab-content">
          <div className="detail-summary-grid">{summary.map(([label, value]) => <div className="detail-summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          <section className="calculation-note"><ShieldCheck aria-hidden="true" /><div><b>Calculation basis</b><p>{formatMoney(investment.principalPaise)} × {(investment.annualRateBps / 100).toFixed(2)}% p.a. Expected values remain separate from bank-confirmed and PAN-verified values.</p></div></section>
          <PayoutList investment={investment} onConfirm={openPayout} limit={3} />
        </TabsContent>

        <TabsContent value="payouts" className="detail-tab-content">
          <SectionTitle title="Interest payout schedule" description={`${investment.schedule.length} expected payout${investment.schedule.length === 1 ? "" : "s"}`} />
          <PayoutList investment={investment} onConfirm={openPayout} />
        </TabsContent>

        <TabsContent value="tds" className="detail-tab-content">
          <SectionTitle title="TDS reconciliation" description="Expected, deducted and PAN-reflected values remain separate" />
          <div className="tds-reconciliation-card">
            <div><span>Expected TDS</span><strong>{formatMoney(expectedTdsTotal)}</strong></div>
            <div><span>Actual deducted</span><strong>{formatMoney(actualTdsTotal)}</strong></div>
            <div><span>PAN reflected</span><strong>{formatMoney(reflectedTdsTotal)}</strong></div>
            <div className="tds-difference"><span>Pending / difference</span><strong>{formatMoney(absolute(actualTdsTotal - reflectedTdsTotal))}</strong></div>
          </div>
          <div className="simple-list">
            {receivedSchedules.map((payout) => (
              <div className="simple-row tds-row" key={payout.id}>
                <span className="row-icon"><ShieldCheck /></span>
                <span className="row-copy"><b>{formatDate(payout.dueDate)}</b><small>Deducted {payout.actualTdsPaise === undefined ? "not entered" : formatMoney(payout.actualTdsPaise)}</small></span>
                <span className="row-value"><small>PAN reflected</small><b>{payout.reflectedAmountPaise === undefined ? "Not verified" : formatMoney(payout.reflectedAmountPaise)}</b></span>
                <Button size="sm" variant="outline" onClick={() => openTdsVerification(payout)}>{payout.tdsVerificationDate ? "Update verification" : "Verify TDS"}</Button>
              </div>
            ))}
            {!receivedSchedules.length && <InlineEmpty icon={ShieldCheck} title="No TDS confirmations yet" detail="Confirm a received payout before verifying its PAN credit." />}
          </div>
        </TabsContent>

        <TabsContent value="documents" className="detail-tab-content">
          <SectionTitle title="Documents" description="Private files linked to this investment" />
          <div className="simple-list">
            {investment.documents.map((document) => (
              <div className="document-row" key={document.id}><span><FileText /><b>{document.documentName}</b><small>{labelType(document.documentType)} · {formatBytes(document.sizeBytes)}</small></span><span className="document-actions"><Button variant="ghost" size="icon" aria-label={`Download ${document.documentName}`} onClick={() => void saveDocument(document.id, document.documentName)}><Download /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${document.documentName}`} onClick={() => void deleteDocument(document.id)}><Trash2 /></Button></span></div>
            ))}
            {!investment.documents.length && <InlineEmpty icon={FileText} title="No documents uploaded" detail="Add a PDF, JPG, JPEG or PNG up to 10 MB." />}
          </div>
          <input ref={uploadRef} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => void uploadDocument(event.target.files?.[0])} />
          <Button variant="outline" disabled={uploading} onClick={() => uploadRef.current?.click()}><Upload /> {uploading ? "Uploading…" : "Upload document"}</Button>
        </TabsContent>

        <TabsContent value="contributions" className="detail-tab-content">
          <SectionTitle title={contributionLabel} description={covered ? "A missed premium lapses the policy, so each one is tracked" : "Each instalment, and whether it actually went"} />
          <div className="tds-metric-grid">
            <div><span>Scheduled</span><strong>{formatMoney(totals.scheduled)}</strong><small>{contributions.length} in total</small></div>
            <div><span>Paid so far</span><strong>{formatMoney(totals.paid)}</strong><small>{totals.paidCount} recorded</small></div>
            <div className={totals.missed > 0 ? "danger" : ""}><span>Missed or overdue</span><strong>{totals.missed}</strong><small>{totals.missed > 0 ? "Needs attention" : "Nothing outstanding"}</small></div>
          </div>
          <div className="detail-payout-list">
            {contributions.map((entry) => {
              const settled = entry.status === "paid";
              return (
                <div className="detail-payout-row" key={entry.id}>
                  <span className={`payout-date-icon ${settled ? "received" : ""}`}><CalendarDays aria-hidden="true" /></span>
                  <span className="detail-payout-date"><b>{formatDate(entry.dueDate)}</b><small>{entry.financialYear}</small></span>
                  <span><small>Due</small><b>{formatMoney(entry.amountPaise)}</b></span>
                  <span><small>{settled ? "Paid" : "Status"}</small><b>{settled ? formatMoney(entry.paidAmountPaise ?? entry.amountPaise) : labelType(entry.status)}</b></span>
                  {settled
                    ? <Badge className="status-received"><CheckCircle2 /> Paid</Badge>
                    : entry.status === "upcoming"
                      ? <Badge className="status-upcoming"><Clock3 /> Upcoming</Badge>
                      : <span className="payout-actions"><Button size="sm" onClick={() => openContribution(entry, "paid")}>Paid</Button><Button size="sm" variant="outline" onClick={() => openContribution(entry, "missed")}>Missed</Button></span>}
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="forms" className="detail-tab-content">
          <SectionTitle title="Forms & declarations" description={`${DECLARATION_FORM_TYPE} is filed for each financial year separately`} />
          {declarationDue && (
            <div className="mismatch-note">
              <AlertTriangle /> {DECLARATION_FORM_TYPE} for {currentFinancialYear} has not been recorded. Until it is, tax will be deducted on every payout this year.
            </div>
          )}
          {investment.declarationApplicable && (
            <Button size="sm" onClick={() => setDeclarationOpen(true)}>Record {DECLARATION_FORM_TYPE} for {currentFinancialYear}</Button>
          )}
          {investment.forms.map((form) => <div className="form-status-row" key={form.id}><span><FileText /><b>{form.formType}</b><small>{form.financialYear}{form.submissionDate ? ` · filed ${formatDate(form.submissionDate)}` : ""}</small></span><Badge className={form.status === "accepted" ? "status-received" : "status-pending"}>{labelType(form.status)}</Badge></div>)}
          {!investment.forms.length && !investment.declarationApplicable && <InlineEmpty icon={FileText} title="No declaration needed" detail="Turn on the exemption toggle in the investment's TDS settings if one applies." />}
        </TabsContent>

        <TabsContent value="activity" className="detail-tab-content">
          <SectionTitle title="Activity history" description="Saved events are append-only and never silently replaced" />
          <div className="activity-list">
            {investment.activity.map((activity) => <Activity key={activity.id} date={formatDateTime(activity.createdAt)} title={activity.summary} />)}
            {!investment.activity.length && <InlineEmpty icon={History} title="No activity recorded" detail="Saved changes will appear here." />}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(payoutDialog)} onOpenChange={(open) => !open && setPayoutDialog(null)}>
        <DialogContent className="confirm-dialog">
          <DialogHeader><DialogTitle>{payoutDialog?.outcome === "received" ? "Confirm payout received" : "Mark payout not received"}</DialogTitle><DialogDescription>{payoutDialog?.outcome === "received" ? "Record the amount actually credited. This does not verify PAN credit." : "Keep this payout visible for follow-up with the issuer."}</DialogDescription></DialogHeader>
          <div className="confirmation-expected"><span>Expected credit</span><strong>{payoutDialog ? formatMoney(payoutDialog.payout.expectedNetPaise) : "—"}</strong></div>
          {payoutDialog && payoutDialog.payout.principalRepaidPaise > 0n && (
            <div className="confirmation-split">
              <span><small>Interest</small><b>{formatMoney(payoutDialog.payout.grossInterestPaise)}</b></span>
              <span><small>Principal returned</small><b>{formatMoney(payoutDialog.payout.principalRepaidPaise)}</b></span>
              <span><small>TDS</small><b>{formatMoney(payoutDialog.payout.expectedTdsPaise)}</b></span>
            </div>
          )}
          {payoutDialog?.outcome === "received" ? <>
            <FormField label="Amount received" id="received-amount"><Input id="received-amount" inputMode="decimal" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} /></FormField>
            <FormField label="Received date" id="received-date"><Input id="received-date" type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></FormField>
            <FormField label="Actual TDS deducted" id="actual-tds"><Input id="actual-tds" inputMode="decimal" value={actualTds} onChange={(event) => setActualTds(event.target.value)} /></FormField>
            <MaskedField label="Credited to account" value={accountNumber} setValue={(value) => setAccountNumber(value.replace(/\D/g, "").slice(0, 18))} inputMode="numeric" placeholder="Account the money landed in" />
            <FormField label="Transaction reference (optional)" id="transaction-ref"><Input id="transaction-ref" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></FormField>
          </> : <FormField label="Follow-up date (optional)" id="follow-up-date"><Input id="follow-up-date" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></FormField>}
          <FormField label="Remarks (optional)" id="payout-remarks"><Textarea id="payout-remarks" value={payoutRemarks} onChange={(event) => setPayoutRemarks(event.target.value)} /></FormField>
          {payoutDialog?.outcome === "received" && parseRupeesToPaise(receivedAmount) !== payoutDialog.payout.expectedNetPaise && <div className="mismatch-note"><AlertTriangle /> Expected {formatMoney(payoutDialog.payout.expectedNetPaise)}; entered {formatMoney(parseRupeesToPaise(receivedAmount))}.</div>}
          <DialogFooter><Button variant="outline" onClick={() => setPayoutDialog(null)}>Cancel</Button><Button disabled={savingPayout} onClick={() => void savePayout()}>{savingPayout ? "Saving…" : "Save confirmation"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(contributionDialog)} onOpenChange={(open) => !open && setContributionDialog(null)}>
        <DialogContent className="confirm-dialog">
          <DialogHeader>
            <DialogTitle>{contributionDialog?.outcome === "paid" ? `Record ${covered ? "premium" : "instalment"} paid` : "Mark as missed"}</DialogTitle>
            <DialogDescription>{contributionDialog ? `Due ${formatDate(contributionDialog.entry.dueDate)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="confirmation-expected"><span>Amount due</span><strong>{contributionDialog ? formatMoney(contributionDialog.entry.amountPaise) : "—"}</strong></div>
          {contributionDialog?.outcome === "paid" && <>
            <FormField label="Amount paid" id="contribution-amount"><Input id="contribution-amount" inputMode="decimal" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} /></FormField>
            <FormField label="Date paid" id="contribution-date"><Input id="contribution-date" type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} /></FormField>
            <FormField label="Reference (optional)" id="contribution-ref"><Input id="contribution-ref" value={paidReference} onChange={(event) => setPaidReference(event.target.value)} maxLength={120} /></FormField>
          </>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributionDialog(null)}>Cancel</Button>
            <Button disabled={savingContribution} onClick={() => void saveContribution()}>{savingContribution ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declarationOpen} onOpenChange={setDeclarationOpen}>
        <DialogContent className="confirm-dialog">
          <DialogHeader>
            <DialogTitle>Record {DECLARATION_FORM_TYPE}</DialogTitle>
            <DialogDescription>For {currentFinancialYear}. A declaration covers one financial year and has to be filed again in April.</DialogDescription>
          </DialogHeader>
          <FormField label="Status" id="declaration-status">
            <Select value={declarationStatus} onValueChange={setDeclarationStatus}>
              <SelectTrigger id="declaration-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Submitted to the issuer</SelectItem>
                <SelectItem value="accepted">Accepted by the issuer</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {(declarationStatus === "submitted" || declarationStatus === "accepted") && (
            <FormField label="Date filed" id="declaration-date">
              <Input id="declaration-date" type="date" value={declarationDate} onChange={(event) => setDeclarationDate(event.target.value)} />
            </FormField>
          )}
          <FormField label="Acknowledgement number (optional)" id="declaration-ack">
            <Input id="declaration-ack" value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)} maxLength={80} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclarationOpen(false)}>Cancel</Button>
            <Button disabled={savingDeclaration} onClick={() => void saveDeclaration()}>{savingDeclaration ? "Saving…" : "Save declaration"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(tdsDialog)} onOpenChange={(open) => !open && setTdsDialog(null)}>
        <DialogContent className="confirm-dialog">
          <DialogHeader><DialogTitle>Verify TDS credit</DialogTitle><DialogDescription>Enter only what you confirmed in your tax/PAN record.</DialogDescription></DialogHeader>
          <div className="toggle-row"><span><b>TDS reflected against PAN</b><small>Turn off if no credit is visible</small></span><Switch checked={tdsReflected} onCheckedChange={setTdsReflected} /></div>
          {tdsReflected && <FormField label="Amount reflected" id="reflected-amount"><Input id="reflected-amount" inputMode="decimal" value={reflectedAmount} onChange={(event) => setReflectedAmount(event.target.value)} /></FormField>}
          <FormField label="Verification date" id="verification-date"><Input id="verification-date" type="date" value={verificationDate} onChange={(event) => setVerificationDate(event.target.value)} /></FormField>
          <FormField label="Reference / remarks (optional)" id="tds-remarks"><Textarea id="tds-remarks" value={tdsRemarks} onChange={(event) => setTdsRemarks(event.target.value)} /></FormField>
          <DialogFooter><Button variant="outline" onClick={() => setTdsDialog(null)}>Cancel</Button><Button disabled={savingTds} onClick={() => void saveTdsVerification()}>{savingTds ? "Saving…" : "Save verification"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayoutList({ investment, onConfirm, limit }: { investment: PortfolioInvestment; onConfirm: (payout: PayoutProjection, outcome: "received" | "not-received") => void; limit?: number }) {
  const rows = useMemo(() => investment.schedule.slice(0, limit), [investment.schedule, limit]);
  if (!rows.length) return <InlineEmpty icon={CalendarDays} title="No payout schedule" detail="Add a custom schedule when the issuer provides its dates." />;
  return <div className="detail-payout-list">{rows.map((payout) => {
    const settled = payout.status === "received" || payout.status === "partial-received";
    const actionable = payout.status !== "upcoming";
    return <div className="detail-payout-row" key={payout.id}>
      <span className={`payout-date-icon ${settled ? "received" : ""}`}><CalendarDays aria-hidden="true" /></span>
      <span className="detail-payout-date"><b>{formatDate(payout.dueDate)}</b><small>{payout.financialYear}</small></span>
      <span><small>Interest</small><b>{formatMoney(payout.grossInterestPaise)}</b>{payout.principalRepaidPaise > 0n && <small>+{formatMoney(payout.principalRepaidPaise)} principal</small>}</span>
      <span><small>Expected TDS</small><b>{formatMoney(payout.expectedTdsPaise)}</b></span>
      <span><small>{settled ? "Received" : "Expected credit"}</small><b>{formatMoney(payout.receivedAmountPaise ?? payout.expectedNetPaise)}</b></span>
      {settled ? <Badge className="status-received"><CheckCircle2 /> {labelType(payout.status)}</Badge> : payout.status === "not-received" ? <Button size="sm" onClick={() => onConfirm(payout, "received")}>Update receipt</Button> : actionable ? <span className="payout-actions"><Button size="sm" onClick={() => onConfirm(payout, "received")}>Received</Button><Button size="sm" variant="outline" onClick={() => onConfirm(payout, "not-received")}>Not received</Button></span> : <Badge className="status-upcoming"><Clock3 /> Upcoming</Badge>}
    </div>;
  })}</div>;
}

function FormField({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="form-field"><Label htmlFor={id}>{label}</Label>{children}</div>; }
function SectionTitle({ title, description }: { title: string; description: string }) { return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>; }
function InlineEmpty({ icon: Icon, title, detail }: { icon: typeof FileText; title: string; detail: string }) { return <div className="inline-empty"><Icon /><span><b>{title}</b><small>{detail}</small></span></div>; }
function isBondType(type: PortfolioInvestment["type"]) { return ["corporate-bond", "government-bond", "ncd", "debenture", "government-security"].includes(type); }
function Activity({ date, title }: { date: string; title: string }) { return <div className="activity-row"><span className="activity-icon"><History aria-hidden="true" /></span><span><b>{title}</b><small>{date}</small></span></div>; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function paiseToInput(value: bigint) { const rupees = value / 100n; const paise = value % 100n; return paise ? `${rupees}.${paise.toString().padStart(2, "0")}` : rupees.toString(); }
function absolute(value: bigint) { return value < 0n ? -value : value; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function labelType(value: string) { return value.split("-").map((word) => word.toLowerCase() === "ncd" ? "NCD" : word.slice(0, 1).toUpperCase() + word.slice(1)).join(" "); }
