"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedField } from "@/components/masked-field";
import { formatMoney, parseRupeesToPaise } from "@/core/finance/calculations";
import { apiFetch } from "@/lib/firebase-client";
import type { PayoutProjection, PortfolioInvestment } from "@/core/models/financial";

export type PayoutOutcome = "received" | "not-received";
export type PayoutTarget = { investment: PortfolioInvestment; payout: PayoutProjection; outcome: PayoutOutcome };

/**
 * Recording what actually arrived against what was expected.
 *
 * Shared by the investment's own screen and the payouts list, because it is
 * the same act from either place — and because a second copy would be a second
 * set of rules about what counts as received, which is the one thing this app
 * must not be vague about.
 *
 * A part payment needs no separate choice: an amount short of what was owed is
 * recorded as one, on the strength of the number entered.
 */
export function PayoutConfirmDialog({ target, onOpenChange, onSaved }: {
  target: PayoutTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onOpenChange(false)}>
      {/*
        Keyed on the payout, so opening a different one starts a fresh form
        rather than carrying over what was typed for the last. Remounting says
        that in one line; resetting each field on a change says it in seven,
        and only after the stale values have already rendered once.
      */}
      {target && <ConfirmForm key={`${target.payout.id}:${target.outcome}`} target={target} onOpenChange={onOpenChange} onSaved={onSaved} />}
    </Dialog>
  );
}

function ConfirmForm({ target, onOpenChange, onSaved }: {
  target: PayoutTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const owed = target.outcome === "received";
  const [receivedAmount, setReceivedAmount] = useState(() => owed ? paiseToInput(target.payout.expectedNetPaise) : "");
  const [receivedDate, setReceivedDate] = useState(todayIso);
  const [actualTds, setActualTds] = useState(() => owed ? paiseToInput(target.payout.expectedTdsPaise) : "");
  const [accountNumber, setAccountNumber] = useState(target.investment.accountNumber ?? "");
  const [paymentReference, setPaymentReference] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (target.outcome === "received" && parseRupeesToPaise(receivedAmount) < 0n) return;
    if (accountNumber && !ACCOUNT_PATTERN.test(accountNumber)) {
      toast.error("Enter a valid account number (9 to 18 digits)");
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduleId: target.payout.id,
          outcome: target.outcome,
          receivedAmountPaise: target.outcome === "received" ? Number(parseRupeesToPaise(receivedAmount)) : undefined,
          receivedDate: target.outcome === "received" ? receivedDate : undefined,
          actualTdsPaise: target.outcome === "received" ? Number(parseRupeesToPaise(actualTds)) : undefined,
          principalRepaidPaise: Number(target.payout.principalRepaidPaise),
          bankAccountNumber: accountNumber,
          paymentReference,
          followUpDate: target.outcome === "not-received" && followUpDate ? followUpDate : undefined,
          remarks,
        }),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? "Payout could not be saved");
      await onSaved();
      onOpenChange(false);
      toast.success(target.outcome === "not-received"
        ? "Payout marked not received"
        : result.status === "partial-received" ? "Recorded as a part payment" : "Payout confirmation saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payout could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const entered = parseRupeesToPaise(receivedAmount);
  const short = owed && entered < target.payout.expectedNetPaise;
  const over = owed && entered > target.payout.expectedNetPaise;

  return (
      <DialogContent className="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{owed ? "Confirm payout received" : "Mark payout not received"}</DialogTitle>
          <DialogDescription>{target.investment.name} · due {formatDate(target.payout.dueDate)}</DialogDescription>
        </DialogHeader>
        <div className="confirmation-expected"><span>Expected credit</span><strong>{formatMoney(target.payout.expectedNetPaise)}</strong></div>
        {target.payout.principalRepaidPaise > 0n && (
          <div className="confirmation-split">
            <span><small>Interest</small><b>{formatMoney(target.payout.grossInterestPaise)}</b></span>
            <span><small>Principal returned</small><b>{formatMoney(target.payout.principalRepaidPaise)}</b></span>
            <span><small>TDS</small><b>{formatMoney(target.payout.expectedTdsPaise)}</b></span>
          </div>
        )}
        {owed ? <>
          <Field label="Amount received" id="received-amount"><Input id="received-amount" inputMode="decimal" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} /></Field>
          <Field label="Received date" id="received-date"><Input id="received-date" type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></Field>
          <Field label="Actual TDS deducted" id="actual-tds"><Input id="actual-tds" inputMode="decimal" value={actualTds} onChange={(event) => setActualTds(event.target.value)} /></Field>
          <MaskedField label="Credited to account" value={accountNumber} setValue={(value) => setAccountNumber(value.replace(NON_DIGITS, "").slice(0, 18))} inputMode="numeric" placeholder="Account the money landed in" />
          <Field label="Transaction reference (optional)" id="transaction-ref"><Input id="transaction-ref" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></Field>
        </> : (
          <Field label="Follow-up date (optional)" id="follow-up-date"><Input id="follow-up-date" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></Field>
        )}
        <Field label="Remarks (optional)" id="payout-remarks"><Textarea id="payout-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field>
        {(short || over) && (
          <div className="mismatch-note">
            <AlertTriangle /> Expected {formatMoney(target.payout.expectedNetPaise)}; entered {formatMoney(entered)}.
            {short ? " This will be recorded as a part payment." : ""}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save confirmation"}</Button>
        </DialogFooter>
      </DialogContent>
  );
}

const ACCOUNT_PATTERN = /^\d{9,18}$/;
const NON_DIGITS = /\D/g;

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="form-field"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function paiseToInput(value: bigint) {
  const rupees = value / 100n;
  const paise = value % 100n;
  return paise === 0n ? rupees.toString() : `${rupees}.${paise.toString().padStart(2, "0")}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
