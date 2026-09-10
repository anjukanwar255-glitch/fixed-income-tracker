import type { AssetClass, InvestmentType } from "@/core/models/financial";

/**
 * Every kind of holding the app records, in one place.
 *
 * The add form and the portfolio filter both read this. They used to keep
 * separate lists, and the filter's was shorter — so a government bond or a
 * debenture could be added and then never appear under any tab but "All".
 *
 * `assetClass` is what actually drives behaviour. A stock is not owed a rate
 * and never matures; a policy is paid for over years rather than bought once.
 * Reading those differences off the class keeps the form and the maths from
 * having to know every individual type.
 */
export const investmentTypeCatalog: {
  value: InvestmentType;
  /** Full name, as offered when adding. */
  title: string;
  /** Short name, for a filter tab or a row badge. */
  shortLabel: string;
  note: string;
  assetClass: AssetClass;
  /** Heading this type is offered under when adding. */
  group: string;
}[] = [
  { value: "fixed-deposit", title: "Fixed Deposit", shortLabel: "FD", note: "Bank or small finance bank", assetClass: "fixed-income", group: "Fixed income" },
  { value: "corporate-fd", title: "Corporate FD", shortLabel: "Corporate FD", note: "Company fixed deposit", assetClass: "fixed-income", group: "Fixed income" },
  { value: "corporate-bond", title: "Corporate Bond", shortLabel: "Bond", note: "Listed or unlisted bond", assetClass: "fixed-income", group: "Fixed income" },
  { value: "government-bond", title: "Government Bond", shortLabel: "Govt Bond", note: "Sovereign bond", assetClass: "fixed-income", group: "Fixed income" },
  { value: "ncd", title: "NCD", shortLabel: "NCD", note: "Non-convertible debenture", assetClass: "fixed-income", group: "Fixed income" },
  { value: "debenture", title: "Debenture", shortLabel: "Debenture", note: "Other debenture", assetClass: "fixed-income", group: "Fixed income" },
  { value: "government-security", title: "Government Security", shortLabel: "G-Sec", note: "T-bill or G-Sec", assetClass: "fixed-income", group: "Fixed income" },
  { value: "stocks", title: "Stocks", shortLabel: "Stocks", note: "Listed shares held in demat", assetClass: "equity", group: "Equity & funds" },
  { value: "mutual-fund-lumpsum", title: "Mutual Fund — Lumpsum", shortLabel: "MF Lumpsum", note: "Bought in one go", assetClass: "mutual-fund", group: "Equity & funds" },
  { value: "mutual-fund-sip", title: "Mutual Fund — SIP", shortLabel: "MF SIP", note: "Bought by instalment", assetClass: "mutual-fund", group: "Equity & funds" },
  { value: "insurance", title: "Insurance Policy", shortLabel: "Insurance", note: "Endowment, ULIP or money-back", assetClass: "insurance", group: "Insurance" },
  { value: "term-insurance", title: "Term Insurance", shortLabel: "Term", note: "Pure cover, no maturity value", assetClass: "insurance", group: "Insurance" },
  { value: "other", title: "Other", shortLabel: "Other", note: "Anything else you want tracked", assetClass: "fixed-income", group: "Fixed income" },
];

export const investmentTypeLabels: Record<string, string> = Object.fromEntries(
  investmentTypeCatalog.map((entry) => [entry.value, entry.shortLabel]),
);

const BY_VALUE = new Map(investmentTypeCatalog.map((entry) => [entry.value, entry]));

export function assetClassOf(type: InvestmentType): AssetClass {
  return BY_VALUE.get(type)?.assetClass ?? "fixed-income";
}

/** Lent at a stated rate, so a payout schedule can be projected from it. */
export function earnsInterest(type: InvestmentType) {
  return assetClassOf(type) === "fixed-income";
}

/** Held as units at a price that moves, so its worth has to be told to us. */
export function holdsUnits(type: InvestmentType) {
  const assetClass = assetClassOf(type);
  return assetClass === "equity" || assetClass === "mutual-fund";
}

/** Paid for over time rather than bought once. */
export function takesContributions(type: InvestmentType) {
  return type === "mutual-fund-sip" || assetClassOf(type) === "insurance";
}

/** Buys cover, so a sum assured matters more than a return. */
export function providesCover(type: InvestmentType) {
  return assetClassOf(type) === "insurance";
}

/**
 * Whether the holding has an end date at all. A stock or an open-ended fund
 * does not, so nothing should demand one.
 */
export function hasMaturity(type: InvestmentType) {
  return !holdsUnits(type);
}
