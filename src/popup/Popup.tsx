import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Combine,
  CopyX,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import { RegroupLogo, UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import type {
  MergeResponse,
  OrganizeJob,
  OrganizeResponse,
  OrganizeStage,
  ProposedGroup,
  Provider,
} from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean } | null;

const STAGES: Record<OrganizeStage, { label: string; progress: number }> = {
  collecting: { label: "Reading titles", progress: 18 },
  classifying: { label: "Finding themes", progress: 48 },
  reading: { label: "Reading ambiguous pages", progress: 68 },
  applying: { label: "Creating tab groups", progress: 88 },
};

export function Popup() {
  const [running, setRunning] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [organizeJob, setOrganizeJob] = useState<OrganizeJob | null>(null);
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewMinSize, setReviewMinSize] = useState(1);
  const [windowId, setWindowId] = useState<number>();
  const [windowCount, setWindowCount] = useState(1);
  const [hasUndo, setHasUndo] = useState(false);
  const [minGroupSize, setMinGroupSize] = useState(2);
  const [acknowledged, setAcknowledged] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const ownsOrganizeRequest = useRef(false);
  const handledJobId = useRef<string | null>(null);

  const refreshUndo = useCallback(async () => {
    const result = await chrome.runtime.sendMessage({ type: "hasUndo" });
    setHasUndo(Boolean(result?.hasUndo));
  }, []);

  const consumeJob = useCallback(async (jobId?: string) => {
    if (!windowId || !jobId) return;
    await chrome.runtime.sendMessage({ type: "consumeOrganizeResult", windowId, jobId });
    setOrganizeJob(null);
  }, [windowId]);

  const handleOrganizeResult = useCallback(async (res: OrganizeResponse | undefined, jobId?: string) => {
    if (jobId && handledJobId.current === jobId) return;
    if (jobId) handledJobId.current = jobId;
    setRunning(null);
    await refreshUndo();
    if (!res || res.error) {
      setStatus({ text: res?.error ?? "Something went wrong.", error: true });
      await consumeJob(jobId);
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
    await consumeJob(jobId);
  }, [consumeJob, refreshUndo]);

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

  useEffect(() => {
    if (!windowId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "organizeStatus", windowId });
        if (stopped) return;
        const job = response?.job as OrganizeJob | null;
        if (job?.status === "running") {
          setOrganizeJob(job);
          setRunning("organize");
          setStatus(null);
        } else if (job && !ownsOrganizeRequest.current && handledJobId.current !== job.id) {
          setOrganizeJob(job);
          await handleOrganizeResult(job.result || { error: job.error }, job.id);
        }
      } catch {
        // The popup can disappear between polls; the background job keeps running.
      }
      if (!stopped) timer = window.setTimeout(poll, 450);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [handleOrganizeResult, windowId]);

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
    handledJobId.current = null;
    ownsOrganizeRequest.current = true;
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
      const res: OrganizeResponse = await chrome.runtime.sendMessage({
        type: "organize",
        hasContentPermission,
        windowId,
      });
      ownsOrganizeRequest.current = false;
      if (res?.running && res.job) {
        setOrganizeJob(res.job);
        return;
      }
      await handleOrganizeResult(res, res?.jobId);
    } catch {
      ownsOrganizeRequest.current = false;
      setRunning(null);
      setStatus({ text: "Organizing was interrupted. Try again.", error: true });
    }
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
    await consumeJob(organizeJob?.id ?? handledJobId.current ?? undefined);
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
    setStatus(res?.error ? { text: res.error, error: true } : { text: `${res.tabCount} tab${res.tabCount === 1 ? "" : "s"} ungrouped` });
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
  const organizing = running === "organize" || organizeJob?.status === "running";
  const disabled = Boolean(running) || reviewing;
  const icon = (action: Action, idle: ReactNode) =>
    running === action ? <LoaderCircle className="size-4 animate-spin" /> : idle;

  return (
    <main className="popup-shell w-[340px] p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground">
            <RegroupLogo className="size-5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Regroup</span>
        </div>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-border hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
          title="Settings"
          aria-label="Settings"
        >
          <Settings2 className="size-4" />
        </button>
      </header>

      {organizing ? (
        <OrganizingRail job={organizeJob} />
      ) : reviewing || running === "apply" ? (
        <ReviewGroups
          groups={groups}
          selected={selected}
          applying={running === "apply"}
          onSelectedChange={setSelected}
          onApply={applySelected}
        />
      ) : (
        <>
          <Button onClick={organize} disabled={disabled} className="mt-5 h-10 w-full" aria-label="Organize tabs">
            <Sparkles className="size-4" />
            {confirming ? "Continue organizing" : "Organize tabs"}
          </Button>

          <div className="mt-4 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">Minimum group</span>
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
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <QuickAction label="Ungroup" onClick={ungroup} disabled={disabled} icon={icon("ungroup", <UngroupIcon className="size-[18px]" />)} />
            <QuickAction label="Duplicates" onClick={cleanDuplicates} disabled={disabled} icon={icon("duplicates", <CopyX className="size-4" />)} />
            {windowCount > 1 ? (
              <QuickAction label="Merge" onClick={merge} disabled={disabled} icon={icon("merge", <Combine className="size-4" />)} />
            ) : hasUndo ? (
              <QuickAction label="Undo" onClick={undo} disabled={disabled} icon={icon("undo", <Undo2 className="size-4" />)} />
            ) : (
              <QuickAction label="Undo" disabled icon={<Undo2 className="size-4" />} />
            )}
          </div>
          {windowCount > 1 && hasUndo && (
            <button onClick={undo} disabled={disabled} className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50">
              Undo previous action
            </button>
          )}
        </>
      )}

      {!organizing && (
        <p
          className={`mt-4 min-h-4 text-xs ${status?.error ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {status?.text ?? ""}
        </p>
      )}
    </main>
  );
}

function OrganizingRail({ job }: { job: OrganizeJob | null }) {
  // A session-restored job from an older version may carry an unknown stage.
  const stage = STAGES[job?.stage || "collecting"] ?? STAGES.collecting;
  const tabCount = job?.tabCount || 0;
  return (
    <section className="mt-6" aria-live="polite" aria-label={`${stage.label}. Organizing tabs.`}>
      <h1 className="text-xl font-semibold tracking-tight">
        {tabCount ? `Organizing ${tabCount} tabs` : "Organizing tabs"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{stage.label}</p>

      <div className="tab-rail mt-6" aria-hidden="true">
        <div className="tab-rail-line" />
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="tab-rail-item" style={{ animationDelay: `${index * -0.58}s` }}>
            <span className="tab-rail-notch" />
          </span>
        ))}
        <span className="tab-rail-arrow">→</span>
        <span className="tab-rail-groups">
          <span />
          <span />
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{stage.label}</span>
        <span className="tabular-nums text-foreground">{stage.progress}%</span>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted">
        <div
          className="organize-progress h-full origin-left bg-primary transition-transform duration-500 [transition-timing-function:var(--ease-out-strong)]"
          style={{ transform: `scaleX(${stage.progress / 100})` }}
        />
      </div>

      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" />
        <span>Safe to close — progress continues</span>
      </div>
    </section>
  );
}

function ReviewGroups({
  groups,
  selected,
  applying,
  onSelectedChange,
  onApply,
}: {
  groups: ProposedGroup[];
  selected: Set<number>;
  applying: boolean;
  onSelectedChange: (selected: Set<number>) => void;
  onApply: () => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-3">
        <h1 className="text-base font-semibold tracking-tight">Review groups</h1>
        <p className="mt-1 text-xs text-muted-foreground">Choose which suggestions to create.</p>
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {groups.map((group, index) => (
          <label
            key={`${group.existingGroupId ?? "new"}-${index}`}
            className="review-item flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-accent"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(index)}
              disabled={applying}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                checked ? next.add(index) : next.delete(index);
                onSelectedChange(next);
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
      <Button onClick={onApply} disabled={!selected.size || applying} className="mt-3 w-full" size="sm">
        {applying ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {applying ? "Applying…" : "Apply selected"}
      </Button>
    </section>
  );
}

function QuickAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent text-xs text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
