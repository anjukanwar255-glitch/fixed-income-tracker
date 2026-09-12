"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Landmark, MessageSquare, Paperclip, ReceiptIndianRupee, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { formatMoney } from "@/core/finance/calculations";
import { subscriptionPlans, type PlanCode } from "@/lib/plans";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import { apiFetch } from "@/lib/firebase-client";

type Settings = {
  maintenance: { enabled: boolean; message: string; until: string | null };
  planRates: { code: PlanCode; amountPaise: number }[];
  supportUrl: string | null;
  trialDays: number;
  monthlyScanLimit: number;
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

type Section = "maintenance" | "pricing" | "messages";

const sections: { value: Section; label: string; icon: typeof Wrench }[] = [
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "pricing", label: "Pricing", icon: ReceiptIndianRupee },
  { value: "messages", label: "Messages", icon: MessageSquare },
];

/**
 * The administrator's console, inside the app rather than beside it.
 *
 * It shares the sign-in that protects everything else, so there is no second
 * credential to leak or rotate, and no endpoint that has to be reachable from
 * another origin. It also means the maintenance switch cannot be stranded: a
 * console on a separate site would be unreachable exactly when that site is
 * the thing that is down, leaving the notice stuck on.
 *
 * It wears the same shell as the app — the same sidebar, header and cards —
 * because it is the same product seen from the other side, and a plainer
 * second design would be a second set of conventions to keep in step.
 */
export function AdminConsole() {
  const auth = useFirebaseAuth();
  const [section, setSection] = useState<Section>("maintenance");
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
          trialDays: settings.trialDays,
          monthlyScanLimit: settings.monthlyScanLimit,
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
    return (
      <main className="splash-screen">
        <div className="splash-logo"><Landmark aria-hidden="true" /></div>
        <h1>Admin</h1>
        <p>Checking access…</p>
        <span className="splash-loader"><i /></span>
      </main>
    );
  }

  if (auth.status !== "signed-in" || !permitted) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><span className="brand-mark"><Landmark aria-hidden="true" /></span><span>Portfolio</span></div>
          <div className="auth-heading">
            <h1>Administrator access only</h1>
            <p>Sign in with an account that holds the administrator role. Nothing here is available otherwise.</p>
          </div>
          <Button size="lg" className="w-full" onClick={() => { window.location.href = "/"; }}>Go to the app</Button>
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

  const live = settings?.maintenance.enabled ?? false;

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="sidebar-brand"><span className="brand-mark"><Landmark /></span><span><b>Portfolio</b><small>Admin console</small></span></div>
        <nav aria-label="Admin sections">
          {sections.map(({ value, label, icon: Icon }) => (
            <button data-active={section === value} key={value} onClick={() => setSection(value)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={() => { window.location.href = "/"; }}><ArrowLeft /><span>Back to the app</span></button>
        <div className="sidebar-trust">
          <span><ShieldCheck /></span>
          <p><b>Changes are recorded</b><small>Who changed a published price, and when, stays on the activity trail.</small></p>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark mini"><Landmark /></span><b>Admin</b></div>
          <div className="topbar-actions">
            {live && <Badge className="status-mismatch"><Wrench /> Maintenance is on</Badge>}
            <span className="cloud-status">{settings?.updatedAt ? `Changed ${formatWhen(settings.updatedAt)}` : "No changes yet"}</span>
          </div>
        </header>

        <main className="app-content">
          {section === "maintenance" && (
            <div className="screen secondary-screen">
              <header className="screen-header"><div><p className="screen-kicker">Public site</p><h1>Maintenance notice</h1></div></header>

              <section className="settings-card stacked-card">
                <div className="section-heading"><div><h2>Show the notice</h2><p>It replaces the page body. The app stays open, signed in and navigable.</p></div><Wrench /></div>
                <div className="admin-toggle-row">
                  <div><b>{live ? "Showing now" : "Not showing"}</b><small>Everyone sees the change within a minute, without reloading.</small></div>
                  <Switch checked={live} onCheckedChange={(checked) => setMaintenance({ enabled: checked })} />
                </div>
                <div className="form-field">
                  <Label htmlFor="admin-message">What it says</Label>
                  <Textarea id="admin-message" rows={3} maxLength={500} value={settings?.maintenance.message ?? ""} onChange={(event) => setMaintenance({ message: event.target.value })} placeholder="Some parts are briefly unavailable while an update is applied. Your records are untouched." />
                  <p className="field-note">Left blank, a neutral message is shown rather than an empty card.</p>
                </div>
                <div className="form-field">
                  <Label htmlFor="admin-until">Expected back by <span className="field-optional">optional</span></Label>
                  <Input id="admin-until" type="datetime-local" value={toLocalInput(settings?.maintenance.until ?? null)} onChange={(event) => setMaintenance({ until: fromLocalInput(event.target.value) })} />
                  <p className="field-note">Left blank, the notice gives no end time rather than a guessed one.</p>
                </div>
              </section>

              <div className="settings-actions"><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></div>
            </div>
          )}

          {section === "pricing" && (
            <div className="screen secondary-screen">
              <header className="screen-header"><div><p className="screen-kicker">Billing</p><h1>Subscription prices</h1></div></header>

              <div className="tds-metric-grid">
                {subscriptionPlans.map((plan) => (
                  <div key={plan.code}>
                    <span>{plan.label}</span>
                    <strong>{formatMoney(BigInt(rateFor(plan.code)))}</strong>
                    <small>{plan.monthsCovered === 1 ? "each month" : `every ${plan.monthsCovered} months`}</small>
                  </div>
                ))}
              </div>

              <section className="settings-card stacked-card">
                <div className="section-heading"><div><h2>What each plan costs</h2><p>Only the amount is set here — a plan&apos;s code, its billing period and the Razorpay plan it maps to stay in the code</p></div><ReceiptIndianRupee /></div>
                <div className="field-grid">
                  {subscriptionPlans.map((plan) => (
                    <div className="form-field" key={plan.code}>
                      <Label htmlFor={`rate-${plan.code}`}>{plan.label} (₹)</Label>
                      <Input id={`rate-${plan.code}`} inputMode="decimal" value={String(rateFor(plan.code) / 100)} onChange={(event) => setRate(plan.code, event.target.value)} />
                    </div>
                  ))}
                </div>
                <p className="field-note">A new price applies to new subscriptions. Anyone already subscribed keeps what they bought until it renews.</p>
              </section>

              <section className="settings-card stacked-card">
                <div className="section-heading"><div><h2>Free trial</h2><p>How long a new account gets before it has to subscribe</p></div><ReceiptIndianRupee /></div>
                <div className="form-field">
                  <Label htmlFor="admin-trial">Trial length (days)</Label>
                  <Input id="admin-trial" inputMode="numeric" value={String(settings?.trialDays ?? 7)} onChange={(event) => setSettings((current) => current && ({ ...current, trialDays: Number(event.target.value) || 0 }))} />
                  <p className="field-note">Applies to accounts created from now on. A trial already running keeps the length it was given — someone told seven days was told seven days.</p>
                </div>
                <div className="form-field">
                  <Label htmlFor="admin-scans">Scans per account per month</Label>
                  <Input id="admin-scans" inputMode="numeric" value={String(settings?.monthlyScanLimit ?? 30)} onChange={(event) => setSettings((current) => current && ({ ...current, monthlyScanLimit: Number(event.target.value) || 0 }))} />
                  <p className="field-note">Reading a document costs real money, and the hourly limit only holds back a burst. Zero switches scanning off; everything can still be entered by hand.</p>
                </div>
              </section>

              <section className="settings-card stacked-card">
                <div className="section-heading"><div><h2>Support link</h2><p>Where &ldquo;Write to us&rdquo; sends people for anything it cannot handle</p></div><MessageSquare /></div>
                <div className="form-field">
                  <Label htmlFor="admin-support">Support URL</Label>
                  <Input id="admin-support" value={settings?.supportUrl ?? ""} onChange={(event) => setSettings((current) => current && ({ ...current, supportUrl: event.target.value }))} placeholder="https://…" />
                </div>
              </section>

              <div className="settings-actions"><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></div>
            </div>
          )}

          {section === "messages" && (
            <div className="screen secondary-screen">
              <header className="screen-header"><div><p className="screen-kicker">Write to us</p><h1>Messages</h1></div></header>
              <div className="secondary-summary">
                <span><MessageSquare /> Received</span>
                <strong>{messages.length}</strong>
                <small>{messages.filter((entry) => entry.category === "issue").length} reporting something broken</small>
              </div>
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
                {!messages.length && <InlineEmpty />}
              </div>
            </div>
          )}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Admin sections">
        {sections.map(({ value, label, icon: Icon }) => (
          <button data-active={section === value} key={value} onClick={() => setSection(value)}><Icon /><small>{label}</small></button>
        ))}
        <button onClick={() => { window.location.href = "/"; }}><ArrowLeft /><small>App</small></button>
      </nav>

      <Toaster position="top-center" />
    </div>
  );
}

function InlineEmpty() {
  return (
    <div className="inline-empty">
      <MessageSquare />
      <span><b>Nothing has been sent yet</b><small>Messages from &ldquo;Write to us&rdquo; arrive here, newest first.</small></span>
    </div>
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
