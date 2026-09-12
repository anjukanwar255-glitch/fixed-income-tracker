"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2, MessageSquare, Paperclip, ReceiptIndianRupee, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { subscriptionPlans, type PlanCode } from "@/lib/plans";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import { apiFetch } from "@/lib/firebase-client";

type Settings = {
  maintenance: { enabled: boolean; message: string; until: string | null };
  planRates: { code: PlanCode; amountPaise: number }[];
  supportUrl: string | null;
  updatedAt: string | null;
};

type Message = {
  id: string;
  userId: string | null;
  category: string;
  subject: string;
  message: string;
  status: string;
  appContext: string | null;
  attachmentCount: number;
  createdAt: string;
};

/**
 * The administrator's console, inside the app rather than beside it.
 *
 * It shares the sign-in that protects everything else, so there is no second
 * credential to leak or rotate, and no endpoint that has to be reachable from
 * another origin. It also means the maintenance switch cannot be stranded:
 * a console on a separate site would be unreachable exactly when that site is
 * the thing that is down, leaving the notice stuck on.
 */
export function AdminConsole() {
  const auth = useFirebaseAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch("/api/admin/settings", { cache: "no-store" });
    if (response.status === 403 || response.status === 401) { setPermitted(false); return; }
    if (!response.ok) { toast.error("Settings could not be loaded"); return; }
    setPermitted(true);
    setSettings(await response.json() as Settings);

    const feedback = await apiFetch("/api/admin/feedback", { cache: "no-store" });
    if (feedback.ok) setMessages(((await feedback.json()) as { messages: Message[] }).messages);
  }, []);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [auth.status, load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await apiFetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maintenance: {
            enabled: settings.maintenance.enabled,
            message: settings.maintenance.message,
            until: settings.maintenance.until || null,
          },
          planRates: settings.planRates,
          supportUrl: settings.supportUrl || null,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Settings could not be saved");
      toast.success(settings.maintenance.enabled ? "Maintenance notice is on" : "Settings saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Settings could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (auth.status === "loading" || (auth.status === "signed-in" && permitted === null)) {
    return <main className="admin-shell"><p className="admin-loading"><Loader2 className="spinning" /> Checking access…</p><Toaster position="top-center" /></main>;
  }

  if (auth.status !== "signed-in" || !permitted) {
    return (
      <main className="admin-shell">
        <section className="admin-card admin-denied">
          <span className="brand-mark"><Landmark aria-hidden="true" /></span>
          <h1>Administrator access only</h1>
          <p>Sign in with an account that has the administrator role. Nothing here is available otherwise.</p>
          <Button onClick={() => { window.location.href = "/"; }}>Go to the app</Button>
        </section>
        <Toaster position="top-center" />
      </main>
    );
  }

  const setMaintenance = (patch: Partial<Settings["maintenance"]>) =>
    setSettings((current) => current && ({ ...current, maintenance: { ...current.maintenance, ...patch } }));

  const rateFor = (code: PlanCode) =>
    settings?.planRates.find((rate) => rate.code === code)?.amountPaise
    ?? subscriptionPlans.find((plan) => plan.code === code)!.amountPaise;

  const setRate = (code: PlanCode, rupees: string) => {
    const amountPaise = Math.round(Number(rupees) * 100);
    setSettings((current) => {
      if (!current) return current;
      const others = current.planRates.filter((rate) => rate.code !== code);
      // A blank or nonsense figure removes the override rather than storing a
      // zero, which would read as free rather than as "unset".
      return { ...current, planRates: Number.isFinite(amountPaise) && amountPaise > 0 ? [...others, { code, amountPaise }] : others };
    });
  };

  return (
    <main className="admin-shell">
      <header className="admin-head">
        <span className="brand-mark"><Landmark aria-hidden="true" /></span>
        <div><h1>Admin console</h1><p>Portfolio · {settings?.updatedAt ? `last changed ${formatWhen(settings.updatedAt)}` : "no changes yet"}</p></div>
        <Button variant="outline" onClick={() => { window.location.href = "/"; }}>Back to the app</Button>
      </header>

      <section className="admin-card">
        <div className="admin-card-head"><span className="admin-icon"><Wrench aria-hidden="true" /></span><div><h2>Maintenance notice</h2><p>Replaces the page body. The app stays open and signed in.</p></div></div>
        <div className="admin-toggle-row">
          <div><b>Show the notice</b><small>Everyone sees it within a minute, without reloading.</small></div>
          <Switch checked={settings?.maintenance.enabled ?? false} onCheckedChange={(checked) => setMaintenance({ enabled: checked })} />
        </div>
        <div className="form-field">
          <Label htmlFor="admin-message">What to say</Label>
          <Textarea id="admin-message" rows={3} maxLength={500} value={settings?.maintenance.message ?? ""} onChange={(event) => setMaintenance({ message: event.target.value })} placeholder="Some parts are briefly unavailable while an update is applied. Your records are untouched." />
        </div>
        <div className="form-field">
          <Label htmlFor="admin-until">Expected back by <span className="field-optional">optional</span></Label>
          <Input id="admin-until" type="datetime-local" value={toLocalInput(settings?.maintenance.until ?? null)} onChange={(event) => setMaintenance({ until: fromLocalInput(event.target.value) })} />
          <p className="field-note">Left blank, the notice gives no end time rather than a guessed one.</p>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head"><span className="admin-icon"><ReceiptIndianRupee aria-hidden="true" /></span><div><h2>Subscription prices</h2><p>What each plan costs. Everything else about a plan stays in the code.</p></div></div>
        <div className="field-grid">
          {subscriptionPlans.map((plan) => (
            <div className="form-field" key={plan.code}>
              <Label htmlFor={`rate-${plan.code}`}>{plan.label} (₹)</Label>
              <Input id={`rate-${plan.code}`} inputMode="decimal" value={String(rateFor(plan.code) / 100)} onChange={(event) => setRate(plan.code, event.target.value)} />
            </div>
          ))}
        </div>
        <p className="field-note">A price change applies to new subscriptions. Anyone already subscribed keeps the plan they bought until it renews.</p>
      </section>

      <section className="admin-card">
        <div className="admin-card-head"><span className="admin-icon"><MessageSquare aria-hidden="true" /></span><div><h2>Support link</h2><p>Where &ldquo;Write to us&rdquo; points people for anything it cannot handle.</p></div></div>
        <div className="form-field">
          <Label htmlFor="admin-support">Support URL</Label>
          <Input id="admin-support" value={settings?.supportUrl ?? ""} onChange={(event) => setSettings((current) => current && ({ ...current, supportUrl: event.target.value }))} placeholder="https://…" />
        </div>
      </section>

      <div className="admin-actions">
        <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save settings"}</Button>
      </div>

      <section className="admin-card">
        <div className="admin-card-head"><span className="admin-icon"><MessageSquare aria-hidden="true" /></span><div><h2>Write to us</h2><p>{messages.length} message{messages.length === 1 ? "" : "s"}, newest first</p></div></div>
        <div className="admin-messages">
          {messages.map((entry) => (
            <article className="admin-message" key={entry.id}>
              <header>
                <b>{entry.subject}</b>
                <span>{labelCategory(entry.category)} · {formatWhen(entry.createdAt)}</span>
              </header>
              <p>{entry.message}</p>
              <footer>
                {entry.attachmentCount > 0 && <span><Paperclip aria-hidden="true" /> {entry.attachmentCount} attached</span>}
                {entry.appContext && <span>{entry.appContext}</span>}
              </footer>
            </article>
          ))}
          {!messages.length && <p className="field-note">Nothing has been sent yet.</p>}
        </div>
      </section>

      <Toaster position="top-center" />
    </main>
  );
}

function labelCategory(value: string) {
  return { issue: "Something is broken", improvement: "An improvement", question: "A question", other: "Something else" }[value] ?? value;
}

function formatWhen(value: string) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** The input works in local time; the setting is stored as an instant. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
