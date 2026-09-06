import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fixed Income Tracker",
  description: "Track fixed deposits, bonds, interest payouts, TDS credit, forms and maturity in one secure ledger.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
