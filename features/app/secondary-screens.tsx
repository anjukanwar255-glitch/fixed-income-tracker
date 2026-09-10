"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, DatabaseBackup, Download, Eye, EyeOff, Landmark, LogOut, Pencil, ReceiptIndianRupee, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { deleteUser } from "firebase/auth";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calculateFinancialYear, formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";
import { InstallAppButton } from "@/features/app/pwa";
import { maskPhoneNumber } from "@/hooks/use-firebase-auth";
import { apiFetch, getFirebaseAuth } from "@/lib/firebase-client";
import type { Entitlement } from "@/lib/billing";

type PayoutFilter = "upcoming" | "due" | "received" | "not-received" | "all";

export function PayoutsScreen({ investments, onOpenInvestment, financialYear }: { investments: PortfolioInvestment[]; onOpenInvestment: (id: string) => void; financialYear: string }) {
  const [filter, setFilter] = useState<PayoutFilter>("upcoming");
  const [{ today, ninetyDays }] = useState(() => {
    const now = new Date();
    return {
      today: now.toISOString().slice(0, 10),
      ninetyDays: new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10),
    };
  });
  const allRows = useMemo(() => investments
    .flatMap((investment) => investment.schedule.map((payout) => ({ investment, payout })))
    .filter(({ payout }) => payout.financialYear === financialYear)
    .sort((a, b) => a.payout.dueDate.localeCompare(b.payout.dueDate)), [investments, financialYear]);
  const rows = allRows.filter(({ payout }) => {
    if (filter === "all") return true;
    if (filter === "received") return payout.status === "received" || payout.status === "partial-received";
    if (filter === "not-received") return payout.status === "not-received" || payout.status === "overdue";
    if (filter === "due") return payout.status === "due-today" || payout.status === "overdue";
    return payout.status === "upcoming";
  });
  /*
   * A ninety-day look-ahead only means something inside the year running now.
   * On any other year the same window is empty, and an empty "next 90 days"
   * reads as "nothing is coming" rather than "you are looking at 2024". So the
   * card becomes the year's own total once the year is not the current one.
   */
  const currentFinancialYear = calculateFinancialYear(today);
  const showingCurrentYear = financialYear === currentFinancialYear;
  const summaryRows = showingCurrentYear
    ? allRows.filter(({ payout }) => payout.dueDate >= today && payout.dueDate <= ninetyDays && payout.status === "upcoming")
    : allRows;
  const summaryLabel = showingCurrentYear ? "Next 90 days" : `${financialYear} total`;
  const summaryTotal = summaryRows.reduce((sum, { payout }) => sum + (payout.receivedAmountPaise ?? payout.expectedNetPaise), 0n);

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">Cash flow · {financialYear}</p><h1>Payouts</h1></div></header>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as PayoutFilter)} className="filter-tabs"><TabsList variant="line"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="due">Due</TabsTrigger><TabsTrigger value="received">Received</TabsTrigger><TabsTrigger value="not-received">Not received</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs>
      <div className="secondary-summary"><span><CalendarClock /> {summaryLabel}</span><strong>{formatMoney(summaryTotal)}</strong><small>{summaryRows.length} payout{summaryRows.length === 1 ? "" : "s"}{showingCurrentYear ? " expected" : ""}</small></div>
      <div className="simple-list">
        {rows.map(({ investment, payout }) => (
          <button className="simple-row simple-row-button" key={`${investment.id}-${payout.id}`} onClick={() => onOpenInvestment(investment.id)}>
            <span className="row-icon"><Landmark /></span>
            <span className="row-copy"><b>{investment.name}</b><small>{investment.issuer} · {formatDate(payout.dueDate)}</small></span>
            <span className="row-value"><b>{formatMoney(payout.receivedAmountPaise ?? payout.expectedNetPaise)}</b><small>{payout.receivedAmountPaise === undefined ? "Expected net" : "Bank confirmed"}</small></span>
            <Badge className={payout.status === "received" ? "status-received" : payout.status === "overdue" || payout.status === "not-received" ? "status-mismatch" : "status-upcoming"}>{labelStatus(payout.status)}</Badge>
          </button>
        ))}
        {!rows.length && <InlineEmpty icon={CalendarClock} title={`No ${filter === "all" ? "" : `${filter.replace("-", " ")} `}payouts`} detail={`Nothing falls due in ${financialYear}. Change the year in the header to look elsewhere.`} />}
      </div>
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
      <header className="screen-header"><div><p className="screen-kicker">{financialYear}</p><h1>TDS reconciliation</h1></div></header>
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
  panMasked: string | null;
  dateOfBirth: string | null;
  mobileE164: string | null;
};

export function ProfileScreen({ profile, displayName, phoneNumber, entitlement, onSignOut, onProfileSaved, onBillingChanged }: {
  profile: AccountProfile | null;
  displayName: string;
  phoneNumber: string | null;
  entitlement: Entitlement;
  onSignOut: () => Promise<void>;
  onProfileSaved: () => Promise<void>;
  onBillingChanged: () => Promise<void>;
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
      toast.success(verify ? "Latest Firebase backup downloaded and decrypted successfully" : "Encrypted Firebase backup created");
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

  const cancelRenewal = async () => {
    if (!window.confirm(`Cancel automatic renewal? Your access will continue until ${entitlement.currentPeriodEnd ? formatDate(entitlement.currentPeriodEnd) : "the current billing period ends"}.`)) return;
    const response = await apiFetch("/api/billing/subscription", { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { toast.error(result.error ?? "Subscription renewal could not be cancelled"); return; }
    toast.success("Automatic renewal cancelled. Access continues through the paid period.");
    await onBillingChanged();
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
      <section className="settings-card"><div className="section-heading"><div><h2>Data protection</h2><p>Your financial records use account-level ownership checks</p></div><ShieldCheck /></div><div className="security-list"><span>Encrypted connection <b>Active</b></span><span>Cloud database <b>Active</b></span><span>Document access <b>Private</b></span></div></section>
      <section className="settings-card app-install-card"><div className="section-heading"><div><h2>Use as an app</h2><p>Install it on your phone for a standalone, home-screen experience</p></div><Download /></div><InstallAppButton /></section>
      <section className="settings-card"><div className="section-heading"><div><h2>Subscription</h2><p>{entitlement.state === "trial" ? `${entitlement.daysRemaining} free-trial days remaining` : entitlement.planCode ? `${entitlement.planCode.replace("half-yearly", "6-month")} plan` : "No active plan"}</p></div><ReceiptIndianRupee /></div><div className="security-list"><span>Status <b>{entitlement.state === "trial" ? "Free trial" : entitlement.subscriptionStatus ?? "Inactive"}</b></span><span>Access through <b>{entitlement.currentPeriodEnd ? formatDate(entitlement.currentPeriodEnd) : entitlement.trialEndsAt ? formatDate(entitlement.trialEndsAt) : "—"}</b></span><span>Renewal <b>{entitlement.cancelAtPeriodEnd ? "Cancelled" : entitlement.state === "subscribed" ? "Automatic" : "Not started"}</b></span></div>{entitlement.state === "subscribed" && !entitlement.cancelAtPeriodEnd && <div className="settings-actions"><Button variant="outline" onClick={() => void cancelRenewal()}>Cancel renewal</Button></div>}</section>
      <section className="settings-card"><div className="section-heading"><div><h2>Backup &amp; recovery</h2><p>Encrypted portfolio snapshots are stored separately in Firebase Storage</p></div><DatabaseBackup /></div><div className="security-list"><span>Firebase backup <b>{backupStatus?.configured ? "Configured" : "Setup required"}</b></span><span>Latest snapshot <b>{backupStatus?.latest ? formatDateTime(backupStatus.latest.createdAt) : "Not created"}</b></span></div><div className="settings-actions"><Button variant="outline" disabled={backupBusy || !backupStatus?.configured} onClick={() => void runBackup()}><DatabaseBackup /> Back up now</Button><Button variant="outline" disabled={backupBusy || !backupStatus?.latest} onClick={() => void runBackup(true)}><ShieldCheck /> Test recovery</Button></div></section>
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
