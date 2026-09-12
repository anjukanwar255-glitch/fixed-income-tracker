"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LifeBuoy, MessageSquare, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/firebase-client";

const MAX_ATTACHMENTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const allowed = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

type Sent = { id: string; category: string; subject: string; status: string; attachmentCount: number; createdAt: string };

export function FeedbackScreen({ appContext, supportUrl }: { appContext: string; supportUrl: string | null }) {
  const [category, setCategory] = useState("issue");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void apiFetch("/api/feedback", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setSent(((await response.json()) as { messages: Sent[] }).messages);
    }).catch(() => undefined);
  }, []);

  const attach = (chosen: File[]) => {
    const usable = chosen.filter((file) => allowed.has(file.type) && file.size > 0 && file.size <= MAX_BYTES);
    if (usable.length < chosen.length) toast.error("Attach a PDF, JPG, JPEG or PNG up to 10 MB");
    if (!usable.length) return;
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}`));
      const additions = usable.filter((file) => !seen.has(`${file.name}:${file.size}`));
      return [...current, ...additions].slice(0, MAX_ATTACHMENTS);
    });
  };

  const send = async () => {
    if (subject.trim().length < 3 || message.trim().length < 10) {
      toast.error("Add a subject and describe it in a little detail");
      return;
    }
    setSending(true);
    try {
      const body = new FormData();
      body.append("category", category);
      body.append("subject", subject.trim());
      body.append("message", message.trim());
      body.append("appContext", appContext);
      for (const file of files) body.append("attachment", file);

      const response = await apiFetch("/api/feedback", { method: "POST", body });
      const result = await response.json() as { error?: string; feedbackId?: string };
      if (!response.ok || !result.feedbackId) throw new Error(result.error ?? "The message could not be sent");

      setSent((current) => [{
        id: result.feedbackId!,
        category,
        subject: subject.trim(),
        status: "received",
        attachmentCount: files.length,
        createdAt: new Date().toISOString(),
      }, ...current]);
      setSubject(""); setMessage(""); setFiles([]);
      toast.success("Thank you — your message reached us");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The message could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="screen secondary-screen">
      <header className="screen-header"><div><p className="screen-kicker">We read every one</p><h1>Write to us</h1></div></header>

      <section className="settings-card stacked-card">
        <div className="field-grid">
          <div className="form-field">
            <Label>What is this about?</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="issue">Something is broken</SelectItem>
                <SelectItem value="improvement">An improvement</SelectItem>
                <SelectItem value="question">A question</SelectItem>
                <SelectItem value="other">Something else</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="form-field">
            <Label htmlFor="feedback-subject">Subject</Label>
            <Input id="feedback-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} placeholder="In a few words" />
          </div>
        </div>
        <div className="form-field">
          <Label htmlFor="feedback-message">Tell us what happened</Label>
          <Textarea id="feedback-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={6} placeholder="What you were doing, what you expected, and what happened instead." />
        </div>

        {files.length > 0 && (
          <div className="scanned-file-list">
            {files.map((file) => (
              <div className="scanned-file" data-selected key={`${file.name}:${file.size}`}>
                <Paperclip aria-hidden="true" />
                <b>{file.name}</b>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((entry) => entry !== file))}>
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={picker}
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(event) => { attach(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }}
        />
        <div className="settings-actions">
          <Button variant="outline" onClick={() => picker.current?.click()} disabled={files.length >= MAX_ATTACHMENTS}>
            <Paperclip /> {files.length ? `Add another (${files.length}/${MAX_ATTACHMENTS})` : "Attach proof"}
          </Button>
          <Button onClick={() => void send()} disabled={sending}>{sending ? "Sending…" : <><Send /> Send</>}</Button>
        </div>
        <p className="field-note">A screenshot of what went wrong tells us more than a description of it. PDF, JPG, JPEG or PNG, up to {MAX_ATTACHMENTS} files.</p>
      </section>

      {supportUrl && (
        <section className="settings-card">
          <div className="section-heading"><div><h2>Need more than a message?</h2><p>For anything that needs a conversation rather than a note</p></div><LifeBuoy /></div>
          <div className="settings-actions">
            <Button variant="outline" onClick={() => window.open(supportUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink /> Open support
            </Button>
          </div>
        </section>
      )}

      {sent.length > 0 && (
        <>
          <div className="section-heading"><div><h2>Your messages</h2><p>What you have sent us so far</p></div></div>
          <div className="simple-list">
            {sent.map((entry) => (
              <div className="simple-row" key={entry.id}>
                <span className="row-icon"><MessageSquare /></span>
                <span className="row-copy"><b>{entry.subject}</b><small>{formatDate(entry.createdAt)}{entry.attachmentCount ? ` · ${entry.attachmentCount} attached` : ""}</small></span>
                <Badge className="status-received"><CheckCircle2 /> Received</Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
