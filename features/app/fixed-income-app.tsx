"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CirclePlus, Home, Landmark, Menu, ReceiptIndianRupee, UserRound, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { calculateFinancialYear } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";
import { AuthFlow } from "@/features/auth/auth-flow";
import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { AddInvestmentSheet } from "@/features/investments/add-investment-sheet";
import { InvestmentDetailScreen } from "@/features/investments/investment-detail-screen";
import { InvestmentListScreen } from "@/features/investments/investment-list-screen";
import { PayoutsScreen, ProfileScreen, TdsScreen } from "@/features/app/secondary-screens";

type Screen = "home" | "investments" | "payouts" | "tds" | "profile";

const navItems: { value: Screen; label: string; icon: typeof Home }[] = [
  { value: "home", label: "Home", icon: Home },
  { value: "investments", label: "Investments", icon: WalletCards },
  { value: "payouts", label: "Payouts", icon: CalendarClock },
  { value: "tds", label: "TDS", icon: ReceiptIndianRupee },
  { value: "profile", label: "Profile", icon: UserRound },
];

export function FixedIncomeApp({ authenticated, displayName, email }: { authenticated: boolean; displayName: string; email: string }) {
  const [splash, setSplash] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [financialYear, setFinancialYear] = useState(() => calculateFinancialYear(new Date().toISOString().slice(0, 10)));
  const [investments, setInvestments] = useState<PortfolioInvestment[]>([]);
  const [loading, setLoading] = useState(authenticated);
  const [loadError, setLoadError] = useState(false);
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 720);
    return () => window.clearTimeout(timer);
  }, []);

  const loadPortfolio = useCallback(async () => {
    if (!authenticated) return false;
    setLoading(true);
    setLoadError(false);
    const controller = new AbortController();
    try {
      const response = await fetch("/api/investments", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Portfolio unavailable");
      const payload = await response.json() as { investments?: StoredInvestment[] };
      setInvestments((payload.investments ?? []).map(fromStoredInvestment));
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => { void loadPortfolio(); }, [loadPortfolio]);

  if (splash) {
    return (
      <main className="splash-screen">
        <div className="splash-logo"><Landmark aria-hidden="true" /></div>
        <h1>Fixed Income Tracker</h1>
        <p>Every payout. Clearly accounted.</p>
        <span className="splash-loader"><i /></span>
      </main>
    );
  }

  if (!authenticated) return <AuthFlow />;

  const selected = investments.find((investment) => investment.id === selectedInvestmentId);
  const openInvestment = (id: string) => setSelectedInvestmentId(id);
  const navigate = (value: Screen) => {
    setSelectedInvestmentId(null);
    setScreen(value);
  };

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="sidebar-brand"><span className="brand-mark"><Landmark /></span><span><b>Fixed Income</b><small>Tracker</small></span></div>
        <nav aria-label="Primary navigation">
          {navItems.map(({ value, label, icon: Icon }) => (
            <button data-active={!selected && screen === value} key={value} onClick={() => navigate(value)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={() => setAddOpen(true)}><CirclePlus /> Add investment</button>
        <div className="sidebar-trust"><span><Landmark /></span><p><b>Audit-safe records</b><small>Expected, actual and verified values stay separate.</small></p></div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation"><Menu /></button>
          <div className="mobile-brand"><span className="brand-mark mini"><Landmark /></span><b>Fixed Income</b></div>
          <div className="topbar-actions"><span className="cloud-status">Private account</span><button className="topbar-avatar" onClick={() => navigate("profile")}>{displayName.slice(0, 1).toUpperCase()}</button></div>
        </header>

        <main className="app-content">
          {loading ? (
            <div className="empty-state portfolio-loading"><span><Landmark aria-hidden="true" /></span><h2>Loading your portfolio</h2><p>Fetching your private investment records…</p></div>
          ) : loadError ? (
            <div className="empty-state"><span><Landmark aria-hidden="true" /></span><h2>Portfolio unavailable</h2><p>Your records are safe. Check the connection and try again.</p><Button onClick={() => void loadPortfolio()}>Try again</Button></div>
          ) : selected ? (
            <InvestmentDetailScreen investment={selected} onBack={() => setSelectedInvestmentId(null)} onDataChanged={loadPortfolio} />
          ) : screen === "home" ? (
            <DashboardScreen displayName={displayName} financialYear={financialYear} investments={investments} onFinancialYearChange={setFinancialYear} onOpenInvestment={openInvestment} onViewInvestments={() => navigate("investments")} onAddInvestment={() => setAddOpen(true)} />
          ) : screen === "investments" ? (
            <InvestmentListScreen investments={investments} onOpenInvestment={openInvestment} onAddInvestment={() => setAddOpen(true)} />
          ) : screen === "payouts" ? (
            <PayoutsScreen investments={investments} onOpenInvestment={openInvestment} />
          ) : screen === "tds" ? (
            <TdsScreen investments={investments} onOpenInvestment={openInvestment} financialYear={financialYear} />
          ) : (
            <ProfileScreen displayName={displayName} email={email} />
          )}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {navItems.map(({ value, label, icon: Icon }) => (
          <button data-active={!selected && screen === value} key={value} onClick={() => navigate(value)}><Icon /><small>{label}</small></button>
        ))}
      </nav>
      <button className="mobile-floating-add" onClick={() => setAddOpen(true)} aria-label="Add investment"><CirclePlus /></button>

      <AddInvestmentSheet open={addOpen} onOpenChange={setAddOpen} onSave={async (investmentId) => { const loaded = await loadPortfolio(); if (loaded) setSelectedInvestmentId(investmentId); }} />
      <Toaster position="top-center" richColors />
    </div>
  );
}

type StoredInvestment = {
  id: string;
  investmentType: PortfolioInvestment["type"];
  investmentName: string;
  issuerNameSnapshot: string;
  investmentNumber: string;
  investmentDate: string;
  principalPaise: number;
  interestRateBps: number;
  interestType: PortfolioInvestment["interestType"];
  payoutFrequency: PortfolioInvestment["payoutFrequency"];
  firstPayoutDate: string | null;
  maturityDate: string;
  expectedMaturityPaise: number | null;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
  status: PortfolioInvestment["status"];
  schedule: Array<{
    id: string;
    dueDate: string;
    financialYear: string;
    grossInterestPaise: number;
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
    annualRateBps: value.interestRateBps,
    interestType: value.interestType,
    payoutFrequency: value.payoutFrequency,
    firstPayoutDate: value.firstPayoutDate ?? value.maturityDate,
    maturityDate: value.maturityDate,
    expectedMaturityPaise: value.expectedMaturityPaise === null ? undefined : BigInt(value.expectedMaturityPaise),
    tdsApplicable: value.tdsApplicable,
    expectedTdsRateBps: value.expectedTdsRateBps,
    status: value.status,
    schedule: value.schedule.map((payout) => ({
      id: payout.id,
      dueDate: payout.dueDate,
      financialYear: payout.financialYear,
      grossInterestPaise: BigInt(payout.grossInterestPaise),
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
