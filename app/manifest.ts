import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portfolio",
    short_name: "Portfolio",
    description: "Track fixed deposits, bonds, payouts, TDS and maturity dates in one private ledger.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#0b6660",
    lang: "en-IN",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
