"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, DatabaseBackup, Download, Eye, EyeOff, LogOut, Pencil, ReceiptIndianRupee, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { deleteUser } from "firebase/auth";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";
import { InstallAppButton } from "@/features/app/pwa";
import { maskPhoneNumber } from "@/hooks/use-firebase-auth";
import { apiFetch, getFirebaseAuth } from "@/lib/firebase-client";
import type { Entitlement } from "@/lib/billing";
import { PlanGrid, type Plan, planPeriodLabel, usePlanCheckout } from "@/features/billing/plan-checkout";
import { isOneTimePlan } from "@/lib/plans";
import { PayoutConfirmDialog, type PayoutTarget } from "@/features/investments/payout-confirm-dialog";
import { assessmentYear } from "@/core/tax/declarations";
import { IssuerMark } from "@/components/issuer-mark";

type PayoutFilter = "upcoming" | "due" | "received" | "not-received" | "all";

export function PayoutsScreen({ investments, financialYear, onDataChanged }: { investments: PortfolioInvestment[]; financialYear: string; onDataChanged: () => Promise<unknown> }) {
  const [filter, setFilter] = useState<PayoutFilter>("upcoming");
  const [holding, setHolding] = useState("all");
  const [target, setTarget] = useState<PayoutTarget | null>(null);

  /*
   * Only the holdings that actually have a payout in this year are offered.
   * Listing every investment would put choices in the filter that empty the
   * list the moment they are picked.
   */
  const withPayouts = useMemo(() => investments
    .filter((investment) => investment.schedule.some((payout) => payout.financialYear === financialYear))
    .sort((a, b) => a.name.localeCompare(b.name)), [investments, financialYear]);

  /*
   * A holding picked here can stop having payouts when the year is changed in
   * the header. Falling back to all of them beats leaving the filter naming
   * something that is no longer among its own choices, over an empty list with
   * no visible reason for being empty.
   */
  const selected = withPayouts.some((investment) => investment.id === holding) ? holding : "all";

  const allRows = useMemo(() => investments
    .flatMap((investment) => investment.schedule.map((payout) => ({ investment, payout })))
    .filter(({ payout }) => payout.financialYear === financialYear)
    .filter(({ investment }) => selected === "all" || investment.id === selected)
    .sort((a, b) => a.payout.dueDate.localeCompare(b.payout.dueDate)), [investments, financialYear, selected]);
  const rows = allRows.filter(({ payout }) => {
    if (filter === "all") return true;
    if (filter === "received") return payout.status === "received" || payout.status === "partial-received";
    if (filter === "not-received") return payout.status === "not-received" || payout.status === "overdue";
    if (filter === "due") return payout.status === "due-today" || payout.status === "overdue";
    return payout.status === "upcoming";
  });
  /*
   * The card answers the year that is selected, not a rolling window. A
   * ninety-day look-ahead ignored the filter on the year it happened to
   * overlap and went empty on every other one, so it read as a different
   * measure depending on which year you were standing in.
   */
  const summaryTotal = allRows.reduce((sum, { payout }) => sum + (payout.receivedAmountPaise ?? payout.expectedNetPaise), 0n);
  const receivedCount = allRows.filter(({ payout }) => payout.receivedAmountPaise !== undefined).length;

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">Cash flow · {financialYear}</p><h1>Payouts</h1></div></header>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as PayoutFilter)} className="filter-tabs"><TabsList variant="line"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="due">Due</TabsTrigger><TabsTrigger value="received">Received</TabsTrigger><TabsTrigger value="not-received">Not received</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs>
      {withPayouts.length > 1 && (
        <div className="payout-holding-filter">
          <Select value={selected} onValueChange={setHolding}>
            <SelectTrigger aria-label="Investment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All investments ({withPayouts.length})</SelectItem>
              {withPayouts.map((investment) => (
                <SelectItem value={investment.id} key={investment.id}>{investment.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="secondary-summary"><span><CalendarClock /> {financialYear}</span><strong>{formatMoney(summaryTotal)}</strong><small>{allRows.length} payout{allRows.length === 1 ? "" : "s"} · {receivedCount} received</small></div>
      <div className="simple-list">
        {rows.map(({ investment, payout }) => {
          const settled = payout.status === "received" || payout.status === "partial-received";
          return (
          <div className="simple-row" key={`${investment.id}-${payout.id}`}>
            <IssuerMark name={investment.issuer || investment.name} website={investment.issuerWebsite} />
            <span className="row-copy"><b>{investment.name}</b><small>{investment.issuer} · {formatDate(payout.dueDate)}</small></span>
            <span className="row-value"><b>{formatMoney(payout.receivedAmountPaise ?? payout.expectedNetPaise)}</b><small>{payout.receivedAmountPaise === undefined ? "Expected net" : "Bank confirmed"}</small></span>
            {settled
              ? <Badge className={payout.status === "partial-received" ? "status-pending" : "status-received"}>{labelStatus(payout.status)}</Badge>
              : payout.status === "upcoming"
                ? <Badge className="status-upcoming">{labelStatus(payout.status)}</Badge>
                : (
                  <span className="payout-actions">
                    <Button size="sm" onClick={() => setTarget({ investment, payout, outcome: "received" })}>Received</Button>
                    <Button size="sm" variant="outline" onClick={() => setTarget({ investment, payout, outcome: "not-received" })}>Not received</Button>
                  </span>
                )}
          </div>
          );
        })}
        {!rows.length && <InlineEmpty icon={CalendarClock} title={`No ${filter === "all" ? "" : `${filter.replace("-", " ")} `}payouts`} detail={`Nothing falls due in ${financialYear}. Change the year in the header to look elsewhere.`} />}
      </div>
      <PayoutConfirmDialog target={target} onOpenChange={(open) => !open && setTarget(null)} onSaved={onDataChanged} />
    </div>
  );
}

export function TdsScreen({ investments, onOpenInvestment, financialYear }: { investments: PortfolioInvestment[]; onOpenInvestment: (id: string) => void; financialYear: string }) {
  const rows = investments.map((investment) => {
    const payouts = investment.schedule.filter((payout) => payout.financialYear === financialYear);
    return {
      investment,
      expected: payouts.reduce((sum, payout) => sum + payout.expectedTdsPaise, 0n),
      actual: payouts.reduce((sum, payout) => sum + (payout.actualTdsPaise ?? 0n), 0n),
      reflected: payouts.reduce((sum, payout) => sum + (payout.reflectedAmountPaise ?? 0n), 0n),
      verifiedCount: payouts.filter((payout) => payout.tdsVerificationDate).length,
      mismatch: payouts.some((payout) => payout.tdsStatus === "mismatch"),
    };
  }).filter((row) => row.expected > 0n || row.actual > 0n || row.reflected > 0n);
  const expected = rows.reduce((sum, row) => sum + row.expected, 0n);
  const actual = rows.reduce((sum, row) => sum + row.actual, 0n);
  const reflected = rows.reduce((sum, row) => sum + row.reflected, 0n);
  const difference = absolute(actual - reflected);

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">{financialYear}{assessmentYear(financialYear) ? ` · filed in ${assessmentYear(financialYear)}` : ""}</p><h1>TDS reconciliation</h1></div></header>
      <div className="tds-metric-grid">
        <div><span>Expected TDS</span><strong>{formatMoney(expected)}</strong><small>From calculated payouts</small></div>
        <div><span>Actual deducted</span><strong>{formatMoney(actual)}</strong><small>Entered with payout confirmation</small></div>
        <div><span>PAN reflected</span><strong>{formatMoney(reflected)}</strong><small>Verified by you</small></div>
        <div className={difference > 0n ? "danger" : ""}><span>Difference</span><strong>{formatMoney(difference)}</strong><small>{difference > 0n ? "Needs verification" : "No recorded mismatch"}</small></div>
      </div>
      <div className="section-heading"><div><h2>Investment reconciliation</h2><p>Calculated values never count as verified credit</p></div></div>
      <div className="simple-list">
        {rows.map((row) => {
          const status = row.mismatch ? "Mismatch" : row.verifiedCount ? "Matched" : "Pending";
          return <button className="simple-row tds-row simple-row-button" key={row.investment.id} onClick={() => onOpenInvestment(row.investment.id)}>
            <span className="row-icon"><ReceiptIndianRupee /></span>
            <span className="row-copy"><b>{row.investment.issuer}</b><small>Expected {formatMoney(row.expected)} · Deducted {formatMoney(row.actual)}</small></span>
            <span className="row-value"><small>PAN reflected</small><b>{formatMoney(row.reflected)}</b></span>
            <Badge className={status === "Matched" ? "status-received" : status === "Mismatch" ? "status-mismatch" : "status-pending"}>{status}</Badge>
          </button>;
        })}
        {!rows.length && <InlineEmpty icon={ReceiptIndianRupee} title="No TDS records" detail={`No TDS data is available for ${financialYear}.`} />}
      </div>
      <div className="data-principle"><ShieldCheck /><p><strong>Verification rule.</strong> TDS is shown as reflected only after you confirm it from your tax record.</p></div>
    </div>
  );
}

type AccountProfile = {
  fullName: string;
  email: string | null;
  displayId: string | null;
  panMasked: string | null;
  dateOfBirth: string | null;
  mobileE164: string | null;
};

export function SubscriptionScreen({ entitlement, plans, displayName, email, phoneNumber, onBillingChanged }: {
  entitlement: Entitlement;
  plans: Plan[];
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  onBillingChanged: () => Promise<void>;
}) {
  const { busyPlan, subscribe } = usePlanCheckout({ displayName, email, phoneNumber, onActivated: onBillingChanged });

  const cancelRenewal = async () => {
    if (!window.confirm(`Cancel automatic renewal? Your access will continue until ${entitlement.currentPeriodEnd ? formatDate(entitlement.currentPeriodEnd) : "the current billing period ends"}.`)) return;
    const response = await apiFetch("/api/billing/subscription", { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { toast.error(result.error ?? "Subscription renewal could not be cancelled"); return; }
    await onBillingChanged();
    toast.success("Renewal cancelled. Access continues to the end of the period.");
  };

  const trialing = entitlement.state === "trial";
  const boughtOutright = Boolean(entitlement.planCode && isOneTimePlan(entitlement.planCode));
  const current = plans.find((plan) => plan.code === entitlement.planCode) ?? null;
  const accessUntil = entitlement.currentPeriodEnd ?? entitlement.trialEndsAt ?? null;

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">Billing</p><h1>Subscription</h1></div></header>

      {/*
        What is running now, stated once and plainly. A trial is a real state
        with a real end date, not an absence of a plan, so it gets the same
        card rather than an empty one.
      */}
      <section className="current-plan-card" data-trial={trialing}>
        <div className="current-plan-head">
          <span className="current-plan-eyebrow">{trialing ? "Free trial" : current ? "Current plan" : "No active plan"}</span>
          <h2>{trialing ? "Trial" : current?.label ?? "Not subscribed"}</h2>
          {current && !trialing && <p className="current-plan-amount">₹{current.amountPaise / 100}<span> / {planPeriodLabel(current.code)}</span></p>}
        </div>
        <div className="current-plan-facts">
          <span><small>Status</small><b>{trialing ? "Active trial" : entitlement.subscriptionStatus ?? "Inactive"}</b></span>
          <span><small>{trialing ? "Trial ends" : "Access through"}</small><b>{accessUntil ? formatDate(accessUntil) : "—"}</b></span>
          <span><small>Renewal</small><b>{boughtOutright ? "One payment" : entitlement.cancelAtPeriodEnd ? "Cancelled" : entitlement.state === "subscribed" ? "Automatic" : "Not started"}</b></span>
        </div>
        {trialing && <p className="current-plan-note">{entitlement.daysRemaining} day{entitlement.daysRemaining === 1 ? "" : "s"} left. Choose a plan below to continue without interruption.</p>}
        {boughtOutright && <p className="current-plan-note">Paid in full. Nothing renews and nothing will be charged again; access runs to the date above.</p>}
        {!boughtOutright && entitlement.cancelAtPeriodEnd && <p className="current-plan-note">Renewal is off. Access continues to the date above, then stops.</p>}
        {entitlement.state === "subscribed" && !boughtOutright && !entitlement.cancelAtPeriodEnd && (
          <div className="settings-actions"><Button variant="outline" onClick={() => void cancelRenewal()}>Cancel renewal</Button></div>
        )}
      </section>

      <div className="section-heading"><div><h2>{current ? "Change your plan" : "Choose a plan"}</h2><p>Every plan carries the same features; only the billing period differs</p></div></div>
      {!entitlement.billingConfigured && (
        <div className="mismatch-note">
          <AlertTriangle /> Payments are not switched on yet, so the plans below cannot be bought. Nothing can be charged until then.
        </div>
      )}
      <PlanGrid
        plans={plans}
        entitlement={entitlement}
        busyPlan={busyPlan}
        currentPlan={entitlement.planCode}
        onChoose={(code) => void subscribe(code)}
      />

      <section className="settings-card">
        <div className="section-heading"><div><h2>What stays yours</h2><p>Subscribed or not</p></div><ShieldCheck /></div>
        <div className="security-list">
          <span>Records <b>Kept for as long as the account exists</b></span>
          <span>Export <b>Available from Profile at any time</b></span>
          <span>Payment details <b>Held by the payment provider, never stored here</b></span>
        </div>
      </section>
    </div>
  );
}

export function ProfileScreen({ profile, displayName, phoneNumber, onSignOut, onProfileSaved, onNavigate }: {
  profile: AccountProfile | null;
  displayName: string;
  phoneNumber: string | null;
  onSignOut: () => Promise<void>;
  onProfileSaved: () => Promise<void>;
  /** Subscription and feedback have no room in the phone's bottom bar. */
  onNavigate: (screen: "subscription" | "feedback") => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [editing, setEditing] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ configured: boolean; latest: { createdAt: string; status: string } | null } | null>(null);

  useEffect(() => {
    void apiFetch("/api/backups", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setBackupStatus(await response.json() as typeof backupStatus);
    });
  }, []);

  const runBackup = async (verify = false) => {
    setBackupBusy(true);
    try {
      const response = await apiFetch("/api/backups", { method: verify ? "PUT" : "POST" });
      const result = await response.json() as { error?: string; createdAt?: string; backup?: { createdAt: string } };
      if (!response.ok) throw new Error(result.error ?? "Backup operation failed");
      toast.success(verify ? "Latest backup downloaded and decrypted successfully" : "Encrypted backup created");
      setBackupStatus({ configured: true, latest: { createdAt: result.backup?.createdAt ?? result.createdAt ?? new Date().toISOString(), status: "completed" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup operation failed");
    } finally { setBackupBusy(false); }
  };

  const exportAccount = async (format: "json" | "csv") => {
    const response = await apiFetch(`/api/account/export${format === "csv" ? "?format=csv" : ""}`);
    if (!response.ok) { toast.error("Account export could not be prepared"); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `fixed-income-export.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    if (!window.confirm("Permanently delete your account, investments and documents? Active subscriptions will also be cancelled.")) return;
    const response = await apiFetch("/api/account", { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { toast.error(result.error ?? "Account could not be deleted"); return; }
    const current = getFirebaseAuth().currentUser;
    if (current) await deleteUser(current).catch(() => undefined);
    await onSignOut();
  };

  return (
    <div className="screen secondary-screen profile-screen">
      <header className="screen-header">
        <div><p className="screen-kicker">Account</p><h1>Profile &amp; security</h1></div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit details</Button>
      </header>
      <section className="profile-card">
        <span className="profile-avatar"><UserRound /></span>
        <div><h2>{displayName}</h2><p>Verified by mobile OTP</p></div>
        <Badge className="status-received"><CheckCircle2 /> Authenticated</Badge>
        <div className="profile-details">
          <span>
            <small>Mobile</small>
            <b className="phone-reveal">
              {revealed ? formatPhoneNumber(phoneNumber) : maskPhoneNumber(phoneNumber)}
              {phoneNumber && (
                <button onClick={() => setRevealed((value) => !value)} aria-label={revealed ? "Hide mobile number" : "Show full mobile number"} aria-pressed={revealed}>
                  {revealed ? <EyeOff /> : <Eye />}
                </button>
              )}
            </b>
          </span>
          <span><small>Account ID</small><b className="account-reference">{profile?.displayId ?? "Assigned once setup is complete"}</b></span>
          <span><small>Email</small><b>{profile?.email || "Not added"}</b></span>
          <span><small>PAN</small><b>{profile?.panMasked || "Not added"}</b></span>
          <span><small>Date of birth</small><b>{profile?.dateOfBirth ? formatDate(profile.dateOfBirth) : "Not added"}</b></span>
          <span><small>Portfolio access</small><b>Private to this account</b></span>
        </div>
      </section>

      <EditProfileDialog
        open={editing}
        profile={profile}
        onOpenChange={setEditing}
        onSaved={async () => { setEditing(false); await onProfileSaved(); }}
      />
      <section className="settings-card mobile-only-card">
        <div className="section-heading"><div><h2>More</h2><p>Also in the sidebar on a larger screen</p></div><ReceiptIndianRupee /></div>
        <div className="settings-actions">
          <Button variant="outline" onClick={() => onNavigate("subscription")}>Subscription</Button>
          <Button variant="outline" onClick={() => onNavigate("feedback")}>Write to us</Button>
        </div>
      </section>
      <section className="settings-card"><div className="section-heading"><div><h2>Data protection</h2><p>Your financial records use account-level ownership checks</p></div><ShieldCheck /></div><div className="security-list"><span>Encrypted connection <b>Active</b></span><span>Secure storage <b>Active</b></span><span>Document access <b>Private</b></span></div></section>
      <section className="settings-card app-install-card"><div className="section-heading"><div><h2>Use as an app</h2><p>Install it on your phone for a standalone, home-screen experience</p></div><Download /></div><InstallAppButton /></section>
      <section className="settings-card"><div className="section-heading"><div><h2>Backup &amp; recovery</h2><p>Encrypted copies of your records, kept apart from the app</p></div><DatabaseBackup /></div><div className="security-list"><span>Backups <b>{backupStatus?.configured ? "On" : "Not set up yet"}</b></span><span>Latest snapshot <b>{backupStatus?.latest ? formatDateTime(backupStatus.latest.createdAt) : "Not created"}</b></span></div><div className="settings-actions"><Button variant="outline" disabled={backupBusy || !backupStatus?.configured} onClick={() => void runBackup()}><DatabaseBackup /> Back up now</Button><Button variant="outline" disabled={backupBusy || !backupStatus?.latest} onClick={() => void runBackup(true)}><ShieldCheck /> Test recovery</Button></div></section>
      <section className="settings-card"><div className="section-heading"><div><h2>Your data</h2><p>Download a portable copy or permanently delete the account</p></div><Download /></div><div className="settings-actions"><Button variant="outline" onClick={() => void exportAccount("csv")}><Download /> Portfolio CSV</Button><Button variant="outline" onClick={() => void exportAccount("json")}><Download /> Full JSON</Button><Button variant="destructive" onClick={() => void deleteAccount()}><Trash2 /> Delete account</Button></div><div className="legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></div></section>
      <Button variant="outline" disabled={signingOut} onClick={() => { setSigningOut(true); void onSignOut().finally(() => setSigningOut(false)); }}>
        <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Edits the same fields account setup collects, through the same endpoint.
 * PAN arrives already masked and cannot be read back, so the field starts empty
 * and only overwrites the stored value when the investor types a new one.
 */
function EditProfileDialog({ open, profile, onOpenChange, onSaved }: {
  open: boolean;
  profile: AccountProfile | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirm-dialog">
        {/* Mounted only while open, so each visit starts from the stored record
            without an effect re-seeding the fields. */}
        {open && <EditProfileForm profile={profile} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditProfileForm({ profile, onCancel, onSaved }: {
  profile: AccountProfile | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [pan, setPan] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (fullName.trim().length < 2) { toast.error("Enter your full name"); return; }
    if (pan && !PAN_PATTERN.test(pan)) { toast.error("That PAN doesn't look right. The format is ABCDE1234F."); return; }
    setSaving(true);
    try {
      const response = await apiFetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), pan, dateOfBirth }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your profile could not be saved");
      await onSaved();
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your profile could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit your details</DialogTitle>
        <DialogDescription>These appear on your reports and reconciliation records.</DialogDescription>
      </DialogHeader>
      <div className="form-field"><Label htmlFor="profile-name">Full name</Label><Input id="profile-name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
      <div className="form-field"><Label htmlFor="profile-email">Email</Label><Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="form-field">
        <Label htmlFor="profile-pan">PAN</Label>
        <Input id="profile-pan" maxLength={10} placeholder={profile?.panMasked || "ABCDE1234F"} value={pan} onChange={(event) => setPan(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} />
        <p className="field-note">{profile?.panMasked ? `Currently ${profile.panMasked}. Leave blank to keep it.` : "Stored masked; never shown in full."}</p>
      </div>
      <div className="form-field"><Label htmlFor="profile-dob">Date of birth</Label><Input id="profile-dob" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</Button>
      </DialogFooter>
    </>
  );
}

/** `+919876543210` → `+91 98765 43210`. Only rendered on an explicit reveal. */
function formatPhoneNumber(value: string | null) {
  if (!value) return "Not linked";
  const local = value.replace(/\D/g, "").slice(-10);
  return local.length === 10 ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : value;
}

function InlineEmpty({ icon: Icon, title, detail }: { icon: typeof CalendarClock; title: string; detail: string }) { return <div className="inline-empty"><Icon /><span><b>{title}</b><small>{detail}</small></span></div>; }
function absolute(value: bigint) { return value < 0n ? -value : value; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value.includes("T") ? value : `${value}T00:00:00Z`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function labelStatus(value: string) { return value.split("-").map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" "); }
