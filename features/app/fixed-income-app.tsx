"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarClock, CirclePlus, Home, Landmark, Menu, ReceiptIndianRupee, UserRound, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { PortfolioInvestment } from "@/core/models/financial";
import { demoInvestments } from "@/data/demo";
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

export function FixedIncomeApp({ authenticated, displayName }: { authenticated: boolean; displayName: string }) {
  const [splash, setSplash] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [financialYear, setFinancialYear] = useState("FY 2026-27");
  const [investments, setInvestments] = useState<PortfolioInvestment[]>(demoInvestments);
  const [samplePortfolio, setSamplePortfolio] = useState(true);
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 720);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void fetch("/api/investments", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { investments?: StoredInvestment[] } | null) => {
        if (!payload?.investments?.length) return;
        setInvestments(payload.investments.map(fromStoredInvestment));
        setSamplePortfolio(false);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [authenticated]);

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
          <div className="topbar-actions">{samplePortfolio && <span className="sample-badge">Sample portfolio</span>}<Button variant="ghost" size="icon" aria-label="Notifications" className="notification-button"><Bell /><i /></Button><button className="topbar-avatar" onClick={() => navigate("profile")}>{displayName.slice(0, 1).toUpperCase()}</button></div>
        </header>

        <main className="app-content">
          {selected ? (
            <InvestmentDetailScreen investment={selected} onBack={() => setSelectedInvestmentId(null)} />
          ) : screen === "home" ? (
            <DashboardScreen displayName={displayName} financialYear={financialYear} investments={investments} onFinancialYearChange={setFinancialYear} onOpenInvestment={openInvestment} onViewInvestments={() => navigate("investments")} />
          ) : screen === "investments" ? (
            <InvestmentListScreen investments={investments} onOpenInvestment={openInvestment} onAddInvestment={() => setAddOpen(true)} />
          ) : screen === "payouts" ? (
            <PayoutsScreen investments={investments} />
          ) : screen === "tds" ? (
            <TdsScreen />
          ) : (
            <ProfileScreen displayName={displayName} />
          )}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {navItems.map(({ value, label, icon: Icon }) => (
          <button data-active={!selected && screen === value} key={value} onClick={() => navigate(value)}><Icon /><small>{label}</small></button>
        ))}
      </nav>
      <button className="mobile-floating-add" onClick={() => setAddOpen(true)} aria-label="Add investment"><CirclePlus /></button>

      <AddInvestmentSheet open={addOpen} onOpenChange={setAddOpen} onSave={(investment) => { setInvestments((current) => samplePortfolio ? [investment] : [investment, ...current]); setSamplePortfolio(false); setSelectedInvestmentId(investment.id); }} />
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
  }>;
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
      status: payout.status,
    })),
  };
}
