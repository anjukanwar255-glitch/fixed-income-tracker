"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Explains a blocked reCAPTCHA and how to clear it.
 *
 * A page cannot navigate to `chrome://extensions` or `about:addons` — browsers
 * refuse those from web content — so this guides rather than redirects, and
 * tailors the wording to the browser in use.
 */

type BrowserKind = "brave" | "edge" | "firefox" | "chrome" | "safari" | "other";

type Guidance = {
  label: string;
  steps: string[];
  /** Keyboard shortcut that opens a private window in this browser. */
  privateWindow: string;
};

function detectMac() {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

async function detectBrowser(): Promise<BrowserKind> {
  const brave = (navigator as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  if (brave?.isBrave && (await brave.isBrave().catch(() => false))) return "brave";

  const agent = navigator.userAgent;
  if (/Edg\//.test(agent)) return "edge";
  if (/Firefox\//.test(agent)) return "firefox";
  if (/Chrome\//.test(agent)) return "chrome";
  if (/Safari\//.test(agent)) return "safari";
  return "other";
}

function guidanceFor(browser: BrowserKind, mac: boolean): Guidance {
  const modifier = mac ? "⌘" : "Ctrl";

  switch (browser) {
    case "brave":
      return {
        label: "Brave",
        steps: [
          "Click the Brave Shields icon (the lion) at the right of the address bar.",
          "Turn Shields down for this site.",
          "Reload the page and request the code again.",
        ],
        privateWindow: `${modifier} + Shift + N`,
      };
    case "firefox":
      return {
        label: "Firefox",
        steps: [
          "Click the shield icon at the left of the address bar.",
          "Turn off Enhanced Tracking Protection for this site.",
          "Disable any ad blocker extension for this site as well, then reload.",
        ],
        privateWindow: `${modifier} + Shift + P`,
      };
    case "safari":
      return {
        label: "Safari",
        steps: [
          "Open Safari → Settings → Extensions.",
          "Turn off any content or ad blocker.",
          "Reload the page and request the code again.",
        ],
        privateWindow: `${modifier} + Shift + N`,
      };
    default:
      return {
        label: browser === "edge" ? "Edge" : "your browser",
        steps: [
          "Click the extensions icon (the puzzle piece) in the toolbar.",
          "Turn off ad blockers and privacy extensions for this site — uBlock Origin, AdGuard, Ghostery and Privacy Badger all block reCAPTCHA.",
          "Reload the page and request the code again.",
        ],
        privateWindow: `${modifier} + Shift + N`,
      };
  }
}

export function RecaptchaBlockedDialog({ open, onOpenChange, onRetry }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  const [guidance, setGuidance] = useState<Guidance | null>(null);

  useEffect(() => {
    let active = true;
    void detectBrowser().then((browser) => {
      if (active) setGuidance(guidanceFor(browser, detectMac()));
    });
    return () => { active = false; };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirm-dialog">
        <DialogHeader>
          <DialogTitle className="blocked-title"><ShieldAlert aria-hidden="true" /> Security check blocked</DialogTitle>
          <DialogDescription>
            Sending a one-time code needs Google&apos;s reCAPTCHA check, and something in {guidance?.label ?? "your browser"} is
            blocking it. Your account and records are unaffected.
          </DialogDescription>
        </DialogHeader>

        <ol className="blocked-steps">
          {(guidance?.steps ?? []).map((step) => <li key={step}>{step}</li>)}
        </ol>

        <p className="field-note">
          Prefer not to change settings? Open a private window with <kbd>{guidance?.privateWindow ?? "Ctrl + Shift + N"}</kbd>,
          go to this page again and sign in there — extensions are usually off by default in private windows.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onRetry}>I&apos;ve turned it off — try again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
