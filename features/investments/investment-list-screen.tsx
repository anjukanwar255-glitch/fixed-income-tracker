"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Landmark, Search, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

type Props = {
  investments: PortfolioInvestment[];
  onOpenInvestment: (id: string) => void;
  onAddInvestment: () => void;
};

const typeLabels: Record<string, string> = {
  "fixed-deposit": "FD",
  "corporate-fd": "Corporate FD",
  "corporate-bond": "Bond",
  "government-bond": "Govt Bond",
  ncd: "NCD",
  debenture: "Debenture",
  "government-security": "G-Sec",
  other: "Other",
};

export function InvestmentListScreen({ investments, onOpenInvestment, onAddInvestment }: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("active");
  const filtered = useMemo(() => investments.filter((investment) => {
    const matchesQuery = `${investment.issuer} ${investment.name} ${investment.investmentNumber}`.toLowerCase().includes(query.toLowerCase());
    const matchesType = type === "all" || investment.type === type;
    const matchesStatus = status === "all" || investment.status === status;
    return matchesQuery && matchesType && matchesStatus;
  }), [investments, query, status, type]);

  return (
    <div className="screen investment-screen">
      <header className="screen-header stacked-header">
        <div>
          <p className="screen-kicker">Your portfolio</p>
          <h1>Investments</h1>
        </div>
        <Button onClick={onAddInvestment}>Add investment</Button>
      </header>

      <div className="search-filter-row">
        <label className="search-box">
          <Search aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issuer or number" />
        </label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="status-filter" aria-label="Investment status"><SlidersHorizontal /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="matured">Matured</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={type} onValueChange={setType} className="type-tabs">
        <TabsList variant="line" className="scrollbar-none">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="fixed-deposit">FD</TabsTrigger>
          <TabsTrigger value="corporate-fd">Corporate FD</TabsTrigger>
          <TabsTrigger value="corporate-bond">Bond</TabsTrigger>
          <TabsTrigger value="ncd">NCD</TabsTrigger>
          <TabsTrigger value="government-security">G-Sec</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="investment-summary-line">
        <span>{filtered.length} investments</span>
        <strong>{formatMoney(filtered.reduce((sum, investment) => sum + investment.principalPaise, 0n))}</strong>
      </div>

      {filtered.length ? (
        <div className="investment-list">
          {filtered.map((investment) => {
            const nextPayout = investment.schedule.find((payout) => payout.dueDate >= "2026-09-06");
            return (
              <button className="investment-card" key={investment.id} onClick={() => onOpenInvestment(investment.id)}>
                <span className="investment-logo"><Landmark aria-hidden="true" /></span>
                <span className="investment-main">
                  <span className="investment-title-row">
                    <span><b>{investment.issuer}</b><small>{typeLabels[investment.type]} · {investment.name}</small></span>
                    <Badge className="status-active">Active</Badge>
                  </span>
                  <span className="investment-numbers">
                    <span><small>Principal</small><b>{formatMoney(investment.principalPaise)}</b></span>
                    <span><small>Interest</small><b>{(investment.annualRateBps / 100).toFixed(2)}% p.a.</b></span>
                  </span>
                  <span className="investment-dates">
                    <span><CalendarDays aria-hidden="true" /> Next payout <b>{nextPayout ? formatDate(nextPayout.dueDate) : "On maturity"}</b></span>
                    <span>Maturity <b>{formatDate(investment.maturityDate)}</b></span>
                  </span>
                </span>
                <ChevronRight className="card-chevron" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span><Landmark aria-hidden="true" /></span>
          <h2>No investments found</h2>
          <p>Try changing the filters or add your first investment.</p>
          <Button onClick={onAddInvestment}>Add your first investment</Button>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
