import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show after a short delay so the user sees the page first
      setTimeout(() => setShowPrompt(true), 2000);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Also show for iOS Safari (no beforeinstallprompt event)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    if (isIOS && !window.matchMedia("(display-mode: standalone)").matches) {
      setTimeout(() => setShowPrompt(true), 3000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      // iOS fallback: show instructions
      setShowPrompt(false);
      setDismissed(true);
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
    setDismissed(true);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setDismissed(true);
  };

  if (!showPrompt || dismissed) return null;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up bg-indigo-600 p-4 text-white shadow-lg">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-lg font-bold">
            S
          </div>
          <div>
            <p className="text-sm font-semibold">Install SensiScan</p>
            <p className="text-xs text-indigo-200">
              {isIOS
                ? 'Tap Share then "Add to Home Screen"'
                : "Add to home screen for quick scanning"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDismiss}
            className="rounded-lg px-3 py-1.5 text-xs text-indigo-200 hover:text-white"
          >
            Later
          </button>
          <button
            onClick={handleInstall}
            className="rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            {isIOS ? "How to" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
