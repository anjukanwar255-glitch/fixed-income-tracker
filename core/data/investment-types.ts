import type { InvestmentType } from "@/core/models/financial";

/**
 * Every kind of holding the app records, in one place.
 *
 * The add form and the portfolio filter both read this. They used to keep
 * separate lists, and the filter's was shorter — so a government bond or a
 * debenture could be added and then never appear under any tab but "All".
 */
export const investmentTypeCatalog: {
  value: InvestmentType;
  /** Full name, as offered when adding. */
  title: string;
  /** Short name, for a filter tab or a row badge. */
  shortLabel: string;
  note: string;
}[] = [
  { value: "fixed-deposit", title: "Fixed Deposit", shortLabel: "FD", note: "Bank or small finance bank" },
  { value: "corporate-fd", title: "Corporate FD", shortLabel: "Corporate FD", note: "Company fixed deposit" },
  { value: "corporate-bond", title: "Corporate Bond", shortLabel: "Bond", note: "Listed or unlisted bond" },
  { value: "government-bond", title: "Government Bond", shortLabel: "Govt Bond", note: "Sovereign bond" },
  { value: "ncd", title: "NCD", shortLabel: "NCD", note: "Non-convertible debenture" },
  { value: "debenture", title: "Debenture", shortLabel: "Debenture", note: "Other debenture" },
  { value: "government-security", title: "Government Security", shortLabel: "G-Sec", note: "T-bill or G-Sec" },
  { value: "other", title: "Other", shortLabel: "Other", note: "Custom fixed-income product" },
];

export const investmentTypeLabels: Record<string, string> = Object.fromEntries(
  investmentTypeCatalog.map((entry) => [entry.value, entry.shortLabel]),
);
