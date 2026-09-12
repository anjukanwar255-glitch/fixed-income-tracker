"use client";

import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

type Notice = { enabled: boolean; message: string; until: string | null };
type PublicSettings = { maintenance: Notice; supportUrl: string | null };

/**
 * Says the app is being worked on, in place of the page it replaces.
 *
 * Only the body goes. The sidebar, the header and the way back out all stay,
 * because someone who can still see where they are is waiting rather than
 * locked out — and a blank site tells them nothing about whether their records
 * are still there.
 *
 * Fetched separately from everything else and from a route that needs no
 * sign-in: an outage is exactly when someone cannot get past the sign-in
 * screen, and a notice only signed-in people can read is not a notice.
 */
export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetch("/api/public/settings", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((value: PublicSettings | null) => { if (!cancelled) setSettings(value); })
        // A failed check must not put the app into maintenance; the ordinary
        // state is the one that has to survive the settings being unreachable.
        .catch(() => undefined);
    };
    load();
    // Picked up without a reload, so turning it off reaches people already
    // sitting on the page.
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return {
    maintenance: settings?.maintenance.enabled ? settings.maintenance : null,
    supportUrl: settings?.supportUrl ?? null,
  };
}

export function MaintenanceNotice({ notice }: { notice: Notice }) {
  return (
    <div className="maintenance-notice" role="status">
      <span className="maintenance-icon"><Wrench aria-hidden="true" /></span>
      <h2>We are updating the app</h2>
      <p>{notice.message || "Some parts are briefly unavailable while an update is applied. Your records are untouched."}</p>
      {notice.until && <p className="maintenance-until">Expected back by {formatUntil(notice.until)}</p>}
    </div>
  );
}

function formatUntil(value: string) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "shortly";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(at);
}
