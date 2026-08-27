import { useEffect, useState } from "react";
import { KeyRound, Zap } from "lucide-react";

// Out-of-quota screen (proxy 402/429). Product rule: "add your own API key" is
// the first and most prominent path and must never be hidden or demoted below
// the paid option — Shelve stays free with your own key. The paid path only
// renders when the background reports payments as enabled (PAYMENTS_ENABLED in
// background constants); entitlement itself is verified server-side by the
// Stripe webhook, never by this UI.
export function UpgradeScreen({ dailyLimit, onDismiss }: { dailyLimit?: boolean; onDismiss: () => void }) {
  const [checkout, setCheckout] = useState<{ paymentsEnabled: boolean; checkoutUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    chrome.runtime
      .sendMessage({ type: "getUpgradeInfo" })
      .then((res: { paymentsEnabled?: boolean; checkoutUrl?: string } | undefined) => {
        if (cancelled) return;
        setCheckout({ paymentsEnabled: res?.paymentsEnabled === true, checkoutUrl: res?.checkoutUrl || "" });
      })
      .catch(() => {
        if (!cancelled) setCheckout({ paymentsEnabled: false, checkoutUrl: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-4 flex flex-col gap-3" aria-labelledby="upgrade-heading">
      <div>
        <h2 id="upgrade-heading" className="text-sm font-semibold tracking-tight">
          You're out of free actions{dailyLimit ? " for today" : ""}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {dailyLimit
            ? "They reset tomorrow — or keep going right now:"
            : "Keep going with one of these:"}
        </p>
      </div>

      <button
        onClick={() => chrome.runtime.openOptionsPage()}
        className="flex w-full flex-col items-start gap-1 rounded-lg border border-primary/50 bg-muted/40 p-3 text-left outline-none transition-[border-color,background-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-primary hover:bg-muted active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <KeyRound className="size-4 text-primary" />
          Add your own API key — free
        </span>
        <span className="text-xs text-muted-foreground">
          Unlimited actions with your OpenAI, Anthropic, Gemini, or Ollama key. Shelve itself stays free.
        </span>
      </button>

      {checkout?.paymentsEnabled && checkout.checkoutUrl && (
        <a
          href={checkout.checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="flex w-full flex-col items-start gap-1 rounded-lg border border-border p-3 text-left outline-none transition-[border-color,background-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-primary/50 hover:bg-muted/50 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Zap className="size-4" />
            Shelve Hosted — $5/mo
          </span>
          <span className="text-xs text-muted-foreground">No key to manage; more actions on the hosted model.</span>
        </a>
      )}

      <button
        onClick={onDismiss}
        className="self-center rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Not now
      </button>
    </section>
  );
}
