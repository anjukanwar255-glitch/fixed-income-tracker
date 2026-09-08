import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/features/app/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio",
  applicationName: "Portfolio",
  description: "Track fixed deposits, bonds, interest payouts, TDS credit, forms and maturity in one secure ledger.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Portfolio",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/app-icon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/app-icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b6660",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body className="antialiased"><PwaRegistration />{children}</body>
    </html>
  );
}
