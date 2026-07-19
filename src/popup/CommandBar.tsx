import { useState } from "react";
import { ArrowRight, CornerDownLeft, LoaderCircle } from "lucide-react";
import type { CommandResponse } from "@/types";

export function CommandBar({ windowId, disabled }: { windowId?: number; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandResponse | null>(null);

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed || running || disabled) return;
    setRunning(true);
    setResult(null);
    let hasContentPermission = await chrome.permissions.contains({
      permissions: ["scripting"],
      origins: ["<all_urls>"],
    });
    if (!hasContentPermission) {
      try {
        hasContentPermission = await chrome.permissions.request({
          permissions: ["scripting"],
          origins: ["<all_urls>"],
        });
      } catch {
        hasContentPermission = false;
      }
    }
    try {
      const res: CommandResponse = await chrome.runtime.sendMessage({
        type: "command",
        query: trimmed,
        windowId,
        hasContentPermission,
      });
      setResult(res ?? { error: "Something went wrong." });
    } catch {
      setResult({ error: "Command was interrupted. Try again." });
    }
    setRunning(false);
  };

  const goToTab = async (tabId: number) => {
    await chrome.runtime.sendMessage({ type: "focusTab", tabId });
  };

  return (
    <section className="mt-4" aria-label="Command bar">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          disabled={disabled || running}
          placeholder="Find or ask: “open the LinkedIn tab with Stanford”"
          aria-label="Command"
          className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground/60" />
        )}
      </div>

      {result && (
        <div
          className={`mt-2 flex items-start gap-2 text-xs ${result.error ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          <p className="min-w-0 flex-1 leading-snug">
            {result.error
              ? result.error
              : result.action === "open_tab"
                ? `Jumped to “${result.tabTitle}”`
                : result.reply}
          </p>
          {result.action === "answer" && typeof result.tabId === "number" && (
            <button
              onClick={() => goToTab(result.tabId as number)}
              className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted"
            >
              Go to tab <ArrowRight className="size-3" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
