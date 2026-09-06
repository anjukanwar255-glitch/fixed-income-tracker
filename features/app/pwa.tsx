"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_READY_EVENT = "fixed-income-install-ready";
const APP_INSTALLED_EVENT = "fixed-income-app-installed";
let pendingInstallPrompt: InstallPromptEvent | null = null;

function isStandalone() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

/** Registers the service worker and retains the browser's one-shot install prompt. */
export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.error("App service worker registration failed:", error);
      });
    }

    const onInstallReady = (event: Event) => {
      event.preventDefault();
      pendingInstallPrompt = event as InstallPromptEvent;
      window.dispatchEvent(new Event(INSTALL_READY_EVENT));
    };
    const onInstalled = () => {
      pendingInstallPrompt = null;
      window.dispatchEvent(new Event(APP_INSTALLED_EVENT));
    };

    window.addEventListener("beforeinstallprompt", onInstallReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}

export function InstallAppButton() {
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    const sync = () => {
      setInstalled(isStandalone());
      setCanPrompt(Boolean(pendingInstallPrompt));
    };
    sync();
    window.addEventListener(INSTALL_READY_EVENT, sync);
    window.addEventListener(APP_INSTALLED_EVENT, sync);
    return () => {
      window.removeEventListener(INSTALL_READY_EVENT, sync);
      window.removeEventListener(APP_INSTALLED_EVENT, sync);
    };
  }, []);

  const install = async () => {
    if (pendingInstallPrompt) {
      const prompt = pendingInstallPrompt;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      pendingInstallPrompt = null;
      setCanPrompt(false);
      if (choice.outcome === "accepted") setInstalled(true);
      return;
    }

    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      toast.info("Safari me Share button dabayein, phir ‘Add to Home Screen’ choose karein.");
      return;
    }
    toast.info("Browser menu me ‘Install app’ ya ‘Add to Home screen’ choose karein.");
  };

  if (installed) {
    return <span className="app-installed-status"><Smartphone aria-hidden="true" /> Installed on this device</span>;
  }

  return (
    <Button variant={canPrompt ? "default" : "outline"} onClick={() => void install()}>
      <Download aria-hidden="true" /> Install app
    </Button>
  );
}
