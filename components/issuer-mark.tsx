"use client";

import { useState } from "react";

import { issuerMark } from "@/core/data/issuer-mark";

/**
 * The issuer's mark: its logo where we have a site to fetch one from, and its
 * initials where we do not.
 *
 * The initials are not a placeholder waiting for the real thing — they are the
 * answer for every issuer whose paperwork names no website, which is most of
 * them. They are derived from the name, so they are right immediately, for
 * everyone, with nothing to look up and nothing to fail.
 *
 * The logo only ever loads from a domain the documents or the investor gave.
 * A domain guessed from a company name fetches whichever company owns that
 * address, and a holding wearing the wrong company's logo is worse than one
 * wearing none.
 */
export function IssuerMark({ name, website, size = "md" }: {
  name: string;
  website?: string;
  size?: "sm" | "md" | "lg";
}) {
  const { initials, colour } = issuerMark(name);
  // A logo that fails to load steps aside for the initials rather than leaving
  // a broken image where a company's identity should be.
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = Boolean(website) && !logoFailed;

  return (
    <span
      className={`issuer-mark issuer-mark-${size}`}
      style={showLogo ? undefined : { background: colour }}
      data-logo={showLogo || undefined}
      aria-hidden="true"
    >
      {showLogo ? (
        /* Served through our own route from an arbitrary issuer domain, which
           the image optimiser cannot be configured for ahead of time. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/logo?domain=${encodeURIComponent(website!)}`} alt="" onError={() => setLogoFailed(true)} />
      ) : initials}
    </span>
  );
}
