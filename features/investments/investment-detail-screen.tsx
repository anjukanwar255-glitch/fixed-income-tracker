"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Landmark,
  ReceiptIndianRupee,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calculateInterest, formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

type Props = {
  investment: PortfolioInvestment;
  onBack: () => void;
};

export function InvestmentDetailScreen({ investment, onBack }: Props) {
  const [confirmingPayout, setConfirmingPayout] = useState<string | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set(investment.schedule.slice(0, 1).map((item) => item.id)));
  const annualInterest = calculateInterest(investment.principalPaise, investment.annualRateBps);
  const received = investment.schedule
    .filter((item) => confirmed.has(item.id))
    .reduce((sum, item) => sum + item.expectedNetPaise, 0n);
  const activePayout = investment.schedule.find((item) => item.id === confirmingPayout);

  const saveConfirmation = () => {
    if (!activePayout) return;
    const amount = receivedAmount.replace(/,/g, "");
    if (!/^\d+(\.\d{0,2})?$/.test(amount)) {
      toast.error("Enter the amount credited to your bank");
      return;
    }
    setConfirmed((current) => new Set(current).add(activePayout.id));
    setConfirmingPayout(null);
    setReceivedAmount("");
    toast.success("Payout confirmed. An activity entry was added.");
  };

  const summary = [
    ["Principal", formatMoney(investment.principalPaise)],
    ["Annual interest", formatMoney(annualInterest)],
    ["Interest received", formatMoney(received)],
    ["Pending interest", formatMoney(annualInterest > received ? annualInterest - received : 0n)],
    ["TDS deducted", formatMoney(received / 9n)],
    ["Net interest", formatMoney(received)],
    ["Next payout", investment.schedule.find((item) => !confirmed.has(item.id)) ? formatDate(investment.schedule.find((item) => !confirmed.has(item.id))!.dueDate) : "—"],
    ["Maturity amount", formatMoney(investment.expectedMaturityPaise ?? investment.principalPaise)],
  ];

  return (
    <div className="screen detail-screen">
      <button className="back-button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Investments</button>
      <section className="detail-hero">
        <div className="detail-icon"><Landmark aria-hidden="true" /></div>
        <div className="detail-title">
          <span>{labelType(investment.type)}</span>
          <h1>{investment.issuer}</h1>
          <p>{investment.name} · •••• {investment.investmentNumber.slice(-4)}</p>
        </div>
        <Badge className="status-active">Active</Badge>
        <div className="detail-key-numbers">
          <div><span>Investment</span><strong>{formatMoney(investment.principalPaise)}</strong></div>
          <div><span>Interest rate</span><strong>{(investment.annualRateBps / 100).toFixed(2)}% <small>p.a.</small></strong></div>
          <div><span>Maturity</span><strong>{formatDate(investment.maturityDate)}</strong></div>
        </div>
      </section>

      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList variant="line" className="detail-tab-list scrollbar-none">
          {[
            ["overview", "Overview"], ["payouts", "Payouts"], ["tds", "TDS"],
            ["documents", "Documents"], ["forms", "Forms"], ["activity", "Activity"],
          ].map(([value, label]) => <TabsTrigger value={value} key={value}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="detail-tab-content">
          <div className="detail-summary-grid">
            {summary.map(([label, value]) => <div className="detail-summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          <section className="calculation-note">
            <ShieldCheck aria-hidden="true" />
            <div><b>How the next payout is calculated</b><p>{formatMoney(investment.principalPaise)} × {(investment.annualRateBps / 100).toFixed(2)}% × 3/12 = {formatMoney(calculateInterest(investment.principalPaise, investment.annualRateBps, 3))} gross. TDS remains expected until actual deduction is entered.</p></div>
          </section>
          <PayoutList investment={investment} confirmed={confirmed} onConfirm={setConfirmingPayout} limit={3} />
        </TabsContent>

        <TabsContent value="payouts" className="detail-tab-content">
          <SectionTitle title="Interest payout schedule" description={`${investment.schedule.length} generated payouts · user editable`} />
          <PayoutList investment={investment} confirmed={confirmed} onConfirm={setConfirmingPayout} />
        </TabsContent>

        <TabsContent value="tds" className="detail-tab-content">
          <SectionTitle title="TDS reconciliation" description="Expected, deducted and PAN-reflected values are tracked separately" />
          <div className="tds-reconciliation-card">
            <div><span>Expected TDS</span><strong>₹9,000</strong></div>
            <div><span>Actual deducted</span><strong>₹9,000</strong></div>
            <div><span>PAN reflected</span><strong>₹8,000</strong></div>
            <div className="tds-difference"><span>Difference</span><strong>₹1,000</strong><Badge variant="destructive">Mismatch</Badge></div>
          </div>
          <Button variant="outline"><CheckCircle2 /> Mark TDS as verified</Button>
        </TabsContent>

        <TabsContent value="documents" className="detail-tab-content">
          <SectionTitle title="Documents" description="Private files linked to this investment" />
          <div className="document-row"><span><FileText /><b>Bond certificate.pdf</b><small>Investment certificate · 1.2 MB</small></span><Button variant="ghost" size="icon" aria-label="Download document"><Download /></Button></div>
          <Button variant="outline"><Upload /> Upload document</Button>
        </TabsContent>

        <TabsContent value="forms" className="detail-tab-content">
          <SectionTitle title="Forms & declarations" description="Configurable by financial year" />
          <div className="form-status-row"><span><FileText /><b>Form 15G</b><small>FY 2026-27</small></span><Badge className="status-pending">Pending</Badge></div>
          <div className="form-status-row"><span><FileText /><b>Issuer declaration</b><small>FY 2026-27</small></span><Badge className="status-received">Accepted</Badge></div>
        </TabsContent>

        <TabsContent value="activity" className="detail-tab-content">
          <SectionTitle title="Activity history" description="Historical events are never silently overwritten" />
          <div className="activity-list">
            <Activity date="05 Jul 2026" title="TDS ₹2,250 verified" icon={ShieldCheck} />
            <Activity date="30 Jun 2026" title="User confirmed ₹20,250 received" icon={Check} />
            <Activity date="01 Apr 2026" title="Investment created" icon={Landmark} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(confirmingPayout)} onOpenChange={(open) => !open && setConfirmingPayout(null)}>
        <DialogContent className="confirm-dialog">
          <DialogHeader>
            <DialogTitle>Confirm payout received</DialogTitle>
            <DialogDescription>Record the amount actually credited. This does not verify PAN credit.</DialogDescription>
          </DialogHeader>
          <div className="confirmation-expected">
            <span>Expected net amount</span>
            <strong>{activePayout ? formatMoney(activePayout.expectedNetPaise) : "—"}</strong>
          </div>
          <div className="form-field"><Label htmlFor="received-amount">Amount received</Label><Input id="received-amount" inputMode="decimal" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} placeholder="20,250" /></div>
          <div className="form-field"><Label htmlFor="received-date">Received date</Label><Input id="received-date" type="date" defaultValue="2026-09-30" /></div>
          <div className="form-field"><Label htmlFor="transaction-ref">Transaction reference (optional)</Label><Input id="transaction-ref" placeholder="Bank UTR / reference" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmingPayout(null)}>Cancel</Button><Button onClick={saveConfirmation}>Confirm received</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayoutList({ investment, confirmed, onConfirm, limit }: { investment: PortfolioInvestment; confirmed: Set<string>; onConfirm: (id: string) => void; limit?: number }) {
  const rows = useMemo(() => investment.schedule.slice(0, limit), [investment.schedule, limit]);
  return (
    <div className="detail-payout-list">
      {rows.map((payout) => {
        const isReceived = confirmed.has(payout.id);
        const isPast = payout.dueDate < "2026-09-06";
        return (
          <div className="detail-payout-row" key={payout.id}>
            <span className={`payout-date-icon ${isReceived ? "received" : ""}`}><CalendarDays aria-hidden="true" /></span>
            <span className="detail-payout-date"><b>{formatDate(payout.dueDate)}</b><small>{payout.financialYear}</small></span>
            <span><small>Gross</small><b>{formatMoney(payout.grossInterestPaise)}</b></span>
            <span><small>Expected TDS</small><b>{formatMoney(payout.expectedTdsPaise)}</b></span>
            <span><small>Expected net</small><b>{formatMoney(payout.expectedNetPaise)}</b></span>
            {isReceived ? <Badge className="status-received"><CheckCircle2 /> Received</Badge> : isPast ? <Button size="sm" onClick={() => onConfirm(payout.id)}>Confirm payout</Button> : <Badge className="status-upcoming"><Clock3 /> Upcoming</Badge>}
          </div>
        );
      })}
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function Activity({ date, title, icon: Icon }: { date: string; title: string; icon: typeof ShieldCheck }) {
  return <div className="activity-row"><span className="activity-icon"><Icon aria-hidden="true" /></span><span><b>{title}</b><small>{date}</small></span></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function labelType(value: string) {
  return value.split("-").map((word) => word === "ncd" ? "NCD" : word[0].toUpperCase() + word.slice(1)).join(" ");
}
