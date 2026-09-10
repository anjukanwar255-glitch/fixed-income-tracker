"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarClock, CirclePlus, Home, Landmark, Menu, ReceiptIndianRupee, UserRound, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { calculateFinancialYear } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";
import { AccountSetup } from "@/features/auth/account-setup";
import { AuthFlow } from "@/features/auth/auth-flow";
import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { SubscriptionGate } from "@/features/billing/subscription-gate";
import { FinancialYearSelect, financialYearsFor } from "@/features/app/financial-year-select";
import { AddInvestmentSheet } from "@/features/investments/add-investment-sheet";
import { InvestmentDetailScreen } from "@/features/investments/investment-detail-screen";
import { InvestmentListScreen } from "@/features/investments/investment-list-screen";
import { PayoutsScreen, ProfileScreen, TdsScreen } from "@/features/app/secondary-screens";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import { apiFetch } from "@/lib/firebase-client";
import type { Entitlement, PlanCode } from "@/lib/billing";

type Screen = "home" | "investments" | "payouts" | "tds" | "profile";

const navItems: { value: Screen; label: string; icon: typeof Home }[] = [
  { value: "home", label: "Home", icon: Home },
  { value: "investments", label: "Investments", icon: WalletCards },
  { value: "payouts", label: "Payouts", icon: CalendarClock },
  { value: "tds", label: "TDS", icon: ReceiptIndianRupee },
  { value: "profile", label: "Profile", icon: UserRound },
];

export function FixedIncomeApp() {
  const auth = useFirebaseAuth();
  const authenticated = auth.status === "signed-in";
  const [splash, setSplash] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [financialYear, setFinancialYear] = useState(() => calculateFinancialYear(new Date().toISOString().slice(0, 10)));
  const [account, setAccount] = useState<{ uid: string; profile: AccountProfile | null; complete: boolean } | null>(null);
  const [portfolio, setPortfolio] = useState<{ uid: string; investments: PortfolioInvestment[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<BillingPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const uid = auth.user?.uid ?? null;
  /**
   * Account and records stay bound to the uid they were fetched for, so signing
   * out and signing in as someone else can never render the previous account's
   * details while the new fetch is still in flight.
   */
  const ownAccount = account?.uid === uid && uid ? account : null;
  const investments = portfolio?.uid === uid && uid ? portfolio.investments : [];
  const displayName = ownAccount?.profile?.fullName?.trim() || "Investor";
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingInvestment, setEditingInvestment] = useState<PortfolioInvestment | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 720);
    return () => window.clearTimeout(timer);
  }, []);

  const loadAccount = useCallback(async () => {
    if (!uid) return;
    try {
      const response = await apiFetch("/api/profile", { cache: "no-store" });
      if (!response.ok) throw new Error("Profile unavailable");
      const payload = await response.json() as { profile: AccountProfile | null; complete: boolean };
      setAccount({ uid, profile: payload.profile, complete: payload.complete });
    } catch {
      setLoadError(true);
    }
  }, [uid]);

  const loadPortfolio = useCallback(async () => {
    if (!uid) return false;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiFetch("/api/investments", { cache: "no-store" });
      if (!response.ok) throw new Error("Portfolio unavailable");
      const payload = await response.json() as { investments?: StoredInvestment[] };
      setPortfolio({ uid, investments: (payload.investments ?? []).map(fromStoredInvestment) });
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const loadBilling = useCallback(async () => {
    if (!uid) return;
    try {
      const response = await apiFetch("/api/billing/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Billing status unavailable");
      setBilling(await response.json() as BillingPayload);
    } catch {
      setLoadError(true);
    }
  }, [uid]);

  const loadReminders = useCallback(async () => {
    if (!uid) return;
    const response = await apiFetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setReminders(((await response.json()) as { reminders: Reminder[] }).reminders);
  }, [uid]);

  useEffect(() => { const timer = window.setTimeout(() => void loadAccount(), 0); return () => window.clearTimeout(timer); }, [loadAccount]);
  useEffect(() => { const timer = window.setTimeout(() => void loadPortfolio(), 0); return () => window.clearTimeout(timer); }, [loadPortfolio]);
  useEffect(() => { const timer = window.setTimeout(() => void loadBilling(), 0); return () => window.clearTimeout(timer); }, [loadBilling]);
  useEffect(() => { if (!billing?.entitlement.entitled) return; const timer = window.setTimeout(() => void loadReminders(), 0); return () => window.clearTimeout(timer); }, [billing?.entitlement.entitled, loadReminders]);

  if (splash || auth.status === "loading") {
    return (
      <main className="splash-screen">
        <div className="splash-logo"><Landmark aria-hidden="true" /></div>
        <h1>Portfolio</h1>
        <p>Every payout. Clearly accounted.</p>
        <span className="splash-loader"><i /></span>
      </main>
    );
  }

  if (auth.status === "configuration-error") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><span className="brand-mark"><Landmark aria-hidden="true" /></span><span>Portfolio</span></div>
          <div className="auth-heading"><h1>Security check unavailable</h1><p>The app could not start its security protection. Reload the page; if this continues, use the Support page.</p></div>
          <Button size="lg" className="w-full" onClick={() => window.location.reload()}>Reload app</Button>
        </section>
      </main>
    );
  }

  if (!authenticated) return <AuthFlow />;

  // The account row is resolved before anything else: a new investor must land
  // on setup rather than on a dashboard that cannot name them.
  if (!ownAccount) {
    return loadError ? (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><span className="brand-mark"><Landmark aria-hidden="true" /></span><span>Portfolio</span></div>
          <div className="auth-heading"><h1>We couldn&apos;t load your account</h1><p>Your records are safe. Check the connection and try again.</p></div>
          <Button size="lg" className="w-full" onClick={() => void loadAccount()}>Try again</Button>
        </section>
      </main>
    ) : (
      <main className="splash-screen">
        <div className="splash-logo"><Landmark aria-hidden="true" /></div>
        <h1>Portfolio</h1>
        <p>Preparing your account…</p>
        <span className="splash-loader"><i /></span>
      </main>
    );
  }

  if (!ownAccount.complete) {
    return (
      <AccountSetup
        phoneNumber={auth.user.phoneNumber}
        onComplete={async () => { await loadAccount(); await loadPortfolio(); }}
      />
    );
  }

  if (!billing) {
    return <main className="splash-screen"><div className="splash-logo"><Landmark aria-hidden="true" /></div><h1>Portfolio</h1><p>Checking account access…</p><span className="splash-loader"><i /></span></main>;
  }

  if (!billing.entitlement.entitled) {
    return <SubscriptionGate entitlement={billing.entitlement} plans={billing.plans} displayName={displayName} email={ownAccount.profile?.email ?? null} phoneNumber={auth.user?.phoneNumber ?? null} onActivated={loadBilling} onSignOut={auth.signOut} />;
  }

  const selected = investments.find((investment) => investment.id === selectedInvestmentId);
  const openInvestment = (id: string) => setSelectedInvestmentId(id);
  const openAddInvestment = () => { setEditingInvestment(null); setAddOpen(true); };
  const openEditInvestment = (investment: PortfolioInvestment) => { setEditingInvestment(investment); setAddOpen(true); };
  const navigate = (value: Screen) => {
    setSelectedInvestmentId(null);
    setScreen(value);
  };

  // Profile has nothing that varies by year, and an investment's own screen
  // shows its whole life rather than a slice of it.
  const showFinancialYear = !selected && screen !== "profile";
  const financialYears = financialYearsFor(investments, new Date().toISOString().slice(0, 10));

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="sidebar-brand"><span className="brand-mark"><Landmark /></span><span><b>Portfolio</b><small>Fixed income</small></span></div>
        <nav aria-label="Primary navigation">
          {navItems.map(({ value, label, icon: Icon }) => (
            <button data-active={!selected && screen === value} key={value} onClick={() => navigate(value)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={openAddInvestment}><CirclePlus /> Add investment</button>
        <div className="sidebar-trust"><span><Landmark /></span><p><b>Audit-safe records</b><small>Expected, actual and verified values stay separate.</small></p></div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation"><Menu /></button>
          <div className="mobile-brand"><span className="brand-mark mini"><Landmark /></span><b>Portfolio</b></div>
          <div className="topbar-actions">{showFinancialYear && <FinancialYearSelect value={financialYear} years={financialYears} onChange={setFinancialYear} />}<span className="cloud-status">{billing.entitlement.state === "trial" ? `${billing.entitlement.daysRemaining} trial days left` : "Premium active"}</span><div className="notification-wrap"><button className="notification-button" aria-label={`${reminders.length} upcoming reminders`} aria-expanded={reminderOpen} onClick={() => setReminderOpen((value) => !value)}><Bell />{reminders.length > 0 && <i />}</button>{reminderOpen && <div className="notification-panel"><header><b>Upcoming reminders</b><small>Next 30 days</small></header>{reminders.length ? reminders.slice(0, 8).map((reminder) => <button key={reminder.id} onClick={() => { setSelectedInvestmentId(reminder.investmentId); setReminderOpen(false); }}><b>{reminder.title}</b><small>{reminder.body}</small></button>) : <p>No payout or maturity is due in the next 30 days.</p>}</div>}</div><button className="topbar-avatar" onClick={() => navigate("profile")}>{displayName.slice(0, 1).toUpperCase()}</button></div>
        </header>

        <main className="app-content">
          {loadError ? (
            <div className="empty-state"><span><Landmark aria-hidden="true" /></span><h2>Portfolio unavailable</h2><p>Your records are safe. Check the connection and try again.</p><Button onClick={() => void loadPortfolio()}>Try again</Button></div>
          ) : loading || portfolio?.uid !== uid ? (
            <div className="empty-state portfolio-loading"><span><Landmark aria-hidden="true" /></span><h2>Loading your portfolio</h2><p>Fetching your private investment records…</p></div>
          ) : selected ? (
            <InvestmentDetailScreen investment={selected} onBack={() => setSelectedInvestmentId(null)} onEdit={() => openEditInvestment(selected)} onDataChanged={loadPortfolio} />
          ) : screen === "home" ? (
            <DashboardScreen displayName={displayName} financialYear={financialYear} investments={investments} onOpenInvestment={openInvestment} onViewInvestments={() => navigate("investments")} onAddInvestment={openAddInvestment} />
          ) : screen === "investments" ? (
            <InvestmentListScreen investments={investments} onOpenInvestment={openInvestment} onAddInvestment={openAddInvestment} financialYear={financialYear} />
          ) : screen === "payouts" ? (
            <PayoutsScreen investments={investments} onOpenInvestment={openInvestment} financialYear={financialYear} />
          ) : screen === "tds" ? (
            <TdsScreen investments={investments} onOpenInvestment={openInvestment} financialYear={financialYear} />
          ) : (
            <ProfileScreen profile={ownAccount.profile} displayName={displayName} phoneNumber={auth.user?.phoneNumber ?? null} entitlement={billing.entitlement} onSignOut={auth.signOut} onProfileSaved={loadAccount} onBillingChanged={loadBilling} />
          )}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {navItems.map(({ value, label, icon: Icon }) => (
          <button data-active={!selected && screen === value} key={value} onClick={() => navigate(value)}><Icon /><small>{label}</small></button>
        ))}
      </nav>
      <button className="mobile-floating-add" onClick={openAddInvestment} aria-label="Add investment"><CirclePlus /></button>

      <AddInvestmentSheet key={editingInvestment?.id ?? "new"} open={addOpen} initialInvestment={editingInvestment} onOpenChange={(open) => { setAddOpen(open); if (!open) setEditingInvestment(null); }} onSave={async (investmentId) => { const loaded = await loadPortfolio(); if (loaded) setSelectedInvestmentId(investmentId); }} />
      <Toaster position="top-center" richColors />
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

type BillingPayload = {
  entitlement: Entitlement;
  plans: Array<{ code: PlanCode; label: string; amountPaise: number; period: string; interval: number }>;
};

type Reminder = { id: string; category: "payout" | "maturity"; investmentId: string; dueDate: string; title: string; body: string };

type StoredInvestment = {
  id: string;
  investmentType: PortfolioInvestment["type"];
  investmentName: string;
  issuerNameSnapshot: string;
  investmentNumber: string;
  investmentDate: string;
  principalPaise: number;
  faceValuePaise?: number | null;
  interestStartDate?: string | null;
  interestRateBps: number;
  interestType: PortfolioInvestment["interestType"];
  compoundingFrequency: PortfolioInvestment["compoundingFrequency"];
  dayCountBasis: PortfolioInvestment["dayCountBasis"];
  payoutFrequency: PortfolioInvestment["payoutFrequency"];
  firstPayoutDate: string | null;
  maturityDate: string;
  expectedMaturityPaise: number | null;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
  panLinked: boolean;
  declarationApplicable: boolean;
  bankName: string | null;
  ifscCode?: string | null;
  accountNumber?: string | null;
  paymentMode: string | null;
  nominee: string | null;
  brokerPlatform: string | null;
  dpId?: string | null;
  clientId?: string | null;
  orderReference?: string | null;
  advisorName: string | null;
  advisorMobile?: string | null;
  notes: string | null;
  status: PortfolioInvestment["status"];
  schedule: Array<{
    id: string;
    dueDate: string;
    financialYear: string;
    grossInterestPaise: number;
    principalRepaidPaise: number | null;
    expectedTdsPaise: number;
    expectedNetPaise: number;
    status: PortfolioInvestment["schedule"][number]["status"];
    receivedAmountPaise: number | null;
    receivedDate: string | null;
    actualTdsPaise: number | null;
    paymentReference: string | null;
    payoutRemarks: string | null;
    followUpDate: string | null;
    tdsReflected: boolean | null;
    reflectedAmountPaise: number | null;
    tdsVerificationDate: string | null;
    tdsStatus: PortfolioInvestment["schedule"][number]["tdsStatus"];
  }>;
  documents: Array<{ id: string; documentName: string; documentType: string; financialYear: string | null; mimeType: string; sizeBytes: number; createdAt: string }>;
  forms: Array<{ id: string; formType: string; financialYear: string; status: string; submissionDate: string | null }>;
  activity: Array<{ id: string; action: string; summary: string; createdAt: string }>;
};

function fromStoredInvestment(value: StoredInvestment): PortfolioInvestment {
  return {
    id: value.id,
    type: value.investmentType,
    name: value.investmentName,
    issuer: value.issuerNameSnapshot,
    investmentNumber: value.investmentNumber,
    investmentDate: value.investmentDate,
    principalPaise: BigInt(value.principalPaise),
    faceValuePaise: value.faceValuePaise ? BigInt(value.faceValuePaise) : undefined,
    interestStartDate: value.interestStartDate ?? undefined,
    annualRateBps: value.interestRateBps,
    interestType: value.interestType,
    compoundingFrequency: value.compoundingFrequency ?? "quarterly",
    dayCountBasis: value.dayCountBasis ?? "actual-365",
    payoutFrequency: value.payoutFrequency,
    firstPayoutDate: value.firstPayoutDate ?? value.maturityDate,
    maturityDate: value.maturityDate,
    expectedMaturityPaise: value.expectedMaturityPaise === null ? undefined : BigInt(value.expectedMaturityPaise),
    tdsApplicable: value.tdsApplicable,
    expectedTdsRateBps: value.expectedTdsRateBps,
    panLinked: value.panLinked,
    declarationApplicable: value.declarationApplicable,
    bankName: value.bankName ?? undefined,
    ifscCode: value.ifscCode ?? undefined,
    accountNumber: value.accountNumber ?? undefined,
    paymentMode: value.paymentMode ?? undefined,
    nominee: value.nominee ?? undefined,
    brokerPlatform: value.brokerPlatform ?? undefined,
    dpId: value.dpId ?? undefined,
    clientId: value.clientId ?? undefined,
    orderReference: value.orderReference ?? undefined,
    advisorName: value.advisorName ?? undefined,
    advisorMobile: value.advisorMobile ?? undefined,
    notes: value.notes ?? undefined,
    status: value.status,
    schedule: value.schedule.map((payout) => ({
      id: payout.id,
      dueDate: payout.dueDate,
      financialYear: payout.financialYear,
      grossInterestPaise: BigInt(payout.grossInterestPaise),
      principalRepaidPaise: BigInt(payout.principalRepaidPaise ?? 0),
      expectedTdsPaise: BigInt(payout.expectedTdsPaise),
      expectedNetPaise: BigInt(payout.expectedNetPaise),
      status: resolvePayoutStatus(payout.status, payout.dueDate),
      receivedAmountPaise: payout.receivedAmountPaise === null ? undefined : BigInt(payout.receivedAmountPaise),
      receivedDate: payout.receivedDate ?? undefined,
      actualTdsPaise: payout.actualTdsPaise === null ? undefined : BigInt(payout.actualTdsPaise),
      paymentReference: payout.paymentReference ?? undefined,
      payoutRemarks: payout.payoutRemarks ?? undefined,
      followUpDate: payout.followUpDate ?? undefined,
      tdsReflected: payout.tdsReflected ?? undefined,
      reflectedAmountPaise: payout.reflectedAmountPaise === null ? undefined : BigInt(payout.reflectedAmountPaise),
      tdsVerificationDate: payout.tdsVerificationDate ?? undefined,
      tdsStatus: payout.tdsStatus,
    })),
    documents: value.documents.map((document) => ({ ...document, financialYear: document.financialYear ?? undefined })),
    forms: value.forms.map((form) => ({ ...form, submissionDate: form.submissionDate ?? undefined })),
    activity: value.activity,
  };
}

function resolvePayoutStatus(status: PortfolioInvestment["schedule"][number]["status"], dueDate: string) {
  if (["received", "partial-received", "not-received"].includes(status)) return status;
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due-today";
  return "upcoming";
}
