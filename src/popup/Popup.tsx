import { useEffect, useState, type ReactNode } from "react";
import { Combine, CopyX, LoaderCircle, Settings2, Sparkles, Undo2 } from "lucide-react";
import { UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import type { MergeResponse, OrganizeResponse, ProposedGroup, Provider } from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean } | null;

export function Popup() {
  const [running, setRunning] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewMinSize, setReviewMinSize] = useState(1);
  const [windowId, setWindowId] = useState<number>();
  const [windowCount, setWindowCount] = useState(1);
  const [hasUndo, setHasUndo] = useState(false);
  const [minGroupSize, setMinGroupSize] = useState(2);
  const [acknowledged, setAcknowledged] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    (async () => {
      const [window, windows, undoState, sync, local] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.runtime.sendMessage({ type: "windowCount" }),
        chrome.runtime.sendMessage({ type: "hasUndo" }),
        chrome.storage.sync.get({ minGroupSize: 2 }),
        chrome.storage.local.get({ dataNoticeAck: false }),
      ]);
      setWindowId(window.id);
      if (windows?.count) setWindowCount(windows.count);
      setHasUndo(Boolean(undoState?.hasUndo));
      setMinGroupSize(clamp(sync.minGroupSize, 1, 6));
      setAcknowledged(Boolean(local.dataNoticeAck));
    })();
  }, []);

  const refreshUndo = async () => {
    const result = await chrome.runtime.sendMessage({ type: "hasUndo" });
    setHasUndo(Boolean(result?.hasUndo));
  };

  const organize = async () => {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get({ provider: "openai" }),
      chrome.storage.local.get({ openaiKey: "", anthropicKey: "", geminiKey: "", apiKey: "" }),
    ]);
    const provider = sync.provider as Provider;
    const keys = {
      openai: local.openaiKey,
      anthropic: local.anthropicKey || local.apiKey,
      gemini: local.geminiKey,
    };
    const key = provider === "ollama" ? "" : keys[provider];
    if (provider !== "ollama" && !key) {
      const name = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" }[provider];
      setStatus({ text: `No ${name} API key set — add one in Settings.`, error: true });
      return;
    }

    if (!acknowledged && !confirming) {
      setConfirming(true);
      setStatus({ text: "Sends tab titles & URLs (and, if allowed, page snippets) to your configured AI provider." });
      return;
    }
    if (confirming) {
      setConfirming(false);
      setAcknowledged(true);
      await chrome.storage.local.set({ dataNoticeAck: true });
    }

    setRunning("organize");
    setStatus(null);
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

    const res: OrganizeResponse = await chrome.runtime.sendMessage({
      type: "organize",
      hasContentPermission,
      windowId,
    });
    setRunning(null);
    await refreshUndo();
    if (!res || res.error) {
      setStatus({ text: res?.error ?? "Something went wrong.", error: true });
      return;
    }
    if (res.review && res.groups) {
      setGroups(res.groups);
      setSelected(new Set(res.groups.map((_, index) => index)));
      setReviewMinSize(res.minSize || 1);
      setStatus(null);
      return;
    }
    setStatus({ text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} · ${res.tabCount} tabs sorted` });
  };

  const applySelected = async () => {
    const chosen = groups.filter((_, index) => selected.has(index));
    if (!chosen.length) return;
    setRunning("apply");
    const res: OrganizeResponse = await chrome.runtime.sendMessage({
      type: "applyPlan",
      groups: chosen,
      minSize: reviewMinSize,
      windowId,
    });
    setRunning(null);
    setGroups([]);
    await refreshUndo();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} created` }
    );
  };

  const ungroup = async () => {
    setRunning("ungroup");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "ungroupAll", windowId });
    setRunning(null);
    await refreshUndo();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `${res.tabCount} tab${res.tabCount === 1 ? "" : "s"} ungrouped` }
    );
  };

  const cleanDuplicates = async () => {
    setRunning("duplicates");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "cleanDuplicates", windowId });
    setRunning(null);
    await refreshUndo();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: res.closedCount ? `Closed ${res.closedCount} duplicate tab${res.closedCount === 1 ? "" : "s"}` : "No duplicate tabs found" }
    );
  };

  const merge = async () => {
    setRunning("merge");
    setStatus(null);
    const res: MergeResponse = await chrome.runtime.sendMessage({ type: "mergeWindows", windowId });
    setRunning(null);
    if (res?.error) {
      setStatus({ text: res.error, error: true });
      return;
    }
    setWindowCount(1);
    setStatus({ text: `Merged ${res.windows} window${res.windows === 1 ? "" : "s"} · ${res.tabs} tabs` });
  };

  const undo = async () => {
    setRunning("undo");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "undo" });
    setRunning(null);
    await refreshUndo();
    setStatus(res?.error ? { text: res.error, error: true } : { text: "Previous tab layout restored" });
  };

  const reviewing = groups.length > 0;
  const disabled = Boolean(running) || reviewing;
  const icon = (action: Action, idle: ReactNode) =>
    running === action ? <LoaderCircle className="size-4 animate-spin" /> : idle;

  return (
    <div className="w-72 p-3">
      <div className="flex items-center justify-between gap-1">
        <Button
          onClick={organize}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="size-9"
          title={confirming ? "Continue organizing" : "Organize"}
          aria-label={confirming ? "Continue organizing" : "Organize"}
        >
          {icon("organize", <Sparkles className="size-4" />)}
        </Button>
        <Button
          onClick={ungroup}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="size-9"
          title="Ungroup all"
          aria-label="Ungroup all"
        >
          {icon("ungroup", <UngroupIcon className="size-[18px]" />)}
        </Button>
        <Button
          onClick={cleanDuplicates}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="size-9"
          title="Clean duplicates"
          aria-label="Clean duplicates"
        >
          {icon("duplicates", <CopyX className="size-4" />)}
        </Button>
        {windowCount > 1 && (
          <Button
            onClick={merge}
            disabled={disabled}
            variant="ghost"
            size="icon"
            className="size-9"
            title="Merge windows"
            aria-label="Merge windows"
          >
            {icon("merge", <Combine className="size-4" />)}
          </Button>
        )}
        {hasUndo && (
          <Button
            onClick={undo}
            disabled={disabled}
            variant="ghost"
            size="icon"
            className="size-9"
            title="Undo"
            aria-label="Undo"
          >
            {icon("undo", <Undo2 className="size-4" />)}
          </Button>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-3 px-1">
        <span className="shrink-0 text-xs text-muted-foreground">Min group</span>
        <Slider
          min={1}
          max={6}
          step={1}
          value={[minGroupSize]}
          onValueChange={([value]) => setMinGroupSize(value)}
          onValueCommit={([value]) => chrome.storage.sync.set({ minGroupSize: value })}
          aria-label="Minimum tabs per group"
        />
        <span className="w-3 text-right text-xs tabular-nums">{minGroupSize}</span>
      </div>

      {(reviewing || running === "apply") && (
        <div className="mt-3">
          <div className="flex flex-col gap-1">
            {groups.map((group, index) => (
              <label
                key={`${group.existingGroupId ?? "new"}-${index}`}
                className="review-item flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-accent"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(index)}
                  disabled={running === "apply"}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    checked ? next.add(index) : next.delete(index);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">
                    {group.name}
                    <span className="ml-1.5 font-normal text-muted-foreground">{group.tabIds.length}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{group.tabTitles.join(" · ")}</span>
                </span>
              </label>
            ))}
          </div>
          <Button
            onClick={applySelected}
            disabled={!selected.size || running === "apply"}
            className="mt-2 w-full"
            size="sm"
          >
            {running === "apply" ? "Applying…" : "Apply"}
          </Button>
        </div>
      )}

      <div className="mt-3 flex min-h-5 items-start justify-between gap-2">
        <p
          className={`text-xs ${status?.error ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {status?.text ?? ""}
        </p>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="shrink-0 rounded-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          title="Settings"
          aria-label="Settings"
        >
          <Settings2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
