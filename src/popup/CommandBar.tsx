import { useEffect, useRef, useState } from "react";
import { BorderBeam } from "border-beam";
import { ArrowRight, LoaderCircle, SendHorizontal } from "lucide-react";
import type { CommandResponse } from "@/types";

export function CommandBar({
  windowId,
  disabled,
  acknowledged,
  onAcknowledge,
  onRunningChange,
  onMutation,
}: {
  windowId?: number;
  disabled: boolean;
  acknowledged: boolean;
  onAcknowledge: () => Promise<void>;
  onRunningChange: (running: boolean) => void;
  onMutation?: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CommandResponse | null>(null);
  // Synchronous guard: React state alone lets a rapid double-submit race the
  // re-render and send the command twice.
  const runningRef = useRef(false);
  const notifyRunning = useRef(onRunningChange);
  notifyRunning.current = onRunningChange;

  useEffect(
    () => () => {
      if (runningRef.current) notifyRunning.current(false);
    },
    []
  );

  const submit = async () => {
    const trimmed = query.trim();
    if (!trimmed || runningRef.current || disabled) return;
    if (!acknowledged && !confirming) {
      setConfirming(true);
      setResult(null);
      return;
    }
    if (confirming) {
      setConfirming(false);
      await onAcknowledge();
    }
    runningRef.current = true;
    setRunning(true);
    onRunningChange(true);
    setResult(null);
    try {
      let hasContentPermission = await chrome.permissions.contains({
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
      const res: CommandResponse = await chrome.runtime.sendMessage({
        type: "command",
        query: trimmed,
        windowId,
        hasContentPermission,
      });
      setResult(res ?? { error: "Something went wrong." });
      if (["create_group", "add_to_group", "update_group", "ungroup", "remove_duplicates", "merge_groups"].includes(res?.action || "") && !res.error) {
        setQuery("");
        await onMutation?.().catch(() => undefined);
      }
    } catch {
      setResult({ error: "Command was interrupted. Try again." });
    } finally {
      runningRef.current = false;
      setRunning(false);
      onRunningChange(false);
    }
  };

  const goToTab = async (tabId: number) => {
    await chrome.runtime.sendMessage({ type: "focusTab", tabId });
  };

  return (
    <section className="mt-4" aria-label="Command bar">
      <BorderBeam
        size="line"
        colorVariant="ocean"
        theme="dark"
        strength={0.35}
        active={running}
        className="w-full focus-within:ring-2 focus-within:ring-ring/30"
        data-testid="command-beam"
      >
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 focus-within:border-ring">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            disabled={disabled || running}
            placeholder={'Try “group my O-1 visa memberships”'}
            aria-label="Command"
            className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          {running ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !query.trim()}
              title="Send"
              aria-label="Send"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&:not(:disabled)]:text-primary"
            >
              <SendHorizontal className="size-3.5" />
            </button>
          )}
        </div>
      </BorderBeam>

      {confirming && (
        <p className="mt-2 text-xs leading-snug text-muted-foreground" aria-live="polite">
          Sends tab titles & URLs (and, if allowed, page snippets) to your configured AI provider. Press Enter again to continue.
        </p>
      )}

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
                : result.action === "create_group"
                  ? `Created “${result.groupName}” with ${result.tabCount} tab${result.tabCount === 1 ? "" : "s"}`
                : result.action === "add_to_group"
                  ? `Moved ${result.tabCount} tab${result.tabCount === 1 ? "" : "s"} into “${result.groupName}”`
                : result.action === "update_group"
                  ? result.previousName && result.previousName !== result.groupName
                    ? `Renamed “${result.previousName}” to “${result.groupName}”`
                    : `Updated “${result.groupName}”`
                : result.action === "ungroup"
                  ? `Ungrouped ${result.tabCount} tab${result.tabCount === 1 ? "" : "s"} from ${result.groupCount} group${result.groupCount === 1 ? "" : "s"}`
                : result.action === "remove_duplicates"
                  ? result.closedCount
                    ? `Closed ${result.closedCount} duplicate tab${result.closedCount === 1 ? "" : "s"}`
                    : "No duplicate tabs found"
                : result.action === "merge_groups"
                  ? `Merged ${result.groupCount} groups into “${result.groupName}” · ${result.tabCount} tabs`
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

      {result?.action === "remove_duplicates" && result.closedTabs && result.closedTabs.length > 0 && (
        <ul
          aria-label="Closed duplicate tabs"
          className="mt-2 max-h-32 space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-xs"
        >
          {result.closedTabs.map((tab, index) => (
            <li key={`${tab.url}-${index}`} className="min-w-0">
              <p className="break-words font-medium leading-snug text-foreground">{tab.title || "Untitled tab"}</p>
              <p className="break-all leading-snug text-muted-foreground">{tab.url}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
