import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CopyX, LoaderCircle, Settings, Sparkles, Undo2 } from "lucide-react";
import { UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CommandBar } from "@/popup/CommandBar";
import { OrganizingRail } from "@/popup/OrganizingRail";
import { PinPrompt } from "@/popup/PinPrompt";
import { ReviewGroups } from "@/popup/ReviewGroups";
import { StashPanel } from "@/popup/StashPanel";
import type {
  GroupInfo,
  OrganizeJob,
  OrganizeResponse,
  ProposedGroup,
  Provider,
  Stash,
} from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "undo" | "apply";
type Status = { text: string; error?: boolean } | null;

export function Popup() {
  const [running, setRunning] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [organizeJob, setOrganizeJob] = useState<OrganizeJob | null>(null);
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewMinSize, setReviewMinSize] = useState(1);
  const [windowId, setWindowId] = useState<number>();
  const [hasUndo, setHasUndo] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  // null = storage not yet read; the UI must stay inert until this resolves.
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [groupList, setGroupList] = useState<GroupInfo[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [stashBusy, setStashBusy] = useState<number | string | null>(null);
  const [confirmingStash, setConfirmingStash] = useState<number | null>(null);
  const ownsOrganizeRequest = useRef(false);
  const handledJobId = useRef<string | null>(null);

  const refreshUndo = useCallback(async (targetWindowId: number | undefined = windowId) => {
    if (!targetWindowId) return;
    const result = await chrome.runtime.sendMessage({ type: "hasUndo", windowId: targetWindowId });
    setHasUndo(Boolean(result?.hasUndo));
  }, [windowId]);

  const refreshPanels = useCallback(async () => {
    if (!windowId) return;
    const [groupsRes, stashRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "listGroups", windowId }),
      chrome.runtime.sendMessage({ type: "listStashes", windowId }),
    ]);
    if (groupsRes?.groups) setGroupList(groupsRes.groups);
    if (stashRes?.stashes) setStashes(stashRes.stashes);
  }, [windowId]);

  useEffect(() => {
    refreshPanels();
    // Briefs finish after the stash call returns; storage is the source of truth.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.stashes) refreshPanels();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refreshPanels]);

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
    await refreshPanels();
  }, [consumeJob, refreshUndo, refreshPanels]);

  useEffect(() => {
    (async () => {
      const window = await chrome.windows.getCurrent();
      const [undoState, local] = await Promise.all([
        chrome.runtime.sendMessage({ type: "hasUndo", windowId: window.id }),
        chrome.storage.local.get({ dataNoticeAck: false, pinPromptDismissed: false }),
      ]);
      try {
        const userSettings = await chrome.action.getUserSettings();
        setShowPinPrompt(!userSettings.isOnToolbar && !local.pinPromptDismissed);
      } catch {
        // Not every Chromium fork exposes getUserSettings; skip the prompt there.
      }
      setWindowId(window.id);
      setHasUndo(Boolean(undoState?.hasUndo));
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
      chrome.storage.sync.get({ provider: "gemini" }),
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
    await Promise.all([refreshUndo(), refreshPanels()]);
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
    await Promise.all([refreshUndo(), refreshPanels()]);
    setStatus(res?.error ? { text: res.error, error: true } : { text: `${res.tabCount} tab${res.tabCount === 1 ? "" : "s"} ungrouped` });
  };

  const cleanDuplicates = async () => {
    setRunning("duplicates");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "cleanDuplicates", windowId });
    setRunning(null);
    await Promise.all([refreshUndo(), refreshPanels()]);
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: res.closedCount ? `Closed ${res.closedCount} duplicate tab${res.closedCount === 1 ? "" : "s"}` : "No duplicate tabs found" }
    );
  };

  const undo = async () => {
    setRunning("undo");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "undo", windowId });
    setRunning(null);
    await Promise.all([refreshUndo(), refreshPanels()]);
    setStatus(res?.error ? { text: res.error, error: true } : { text: "Previous tab layout restored" });
  };

  const acknowledgeNotice = useCallback(async () => {
    setAcknowledged(true);
    await chrome.storage.local.set({ dataNoticeAck: true });
  }, []);

  const stashGroup = async (groupId: number) => {
    if (!acknowledged) {
      if (confirmingStash !== groupId) {
        setConfirmingStash(groupId);
        setStatus({ text: "Stash briefs send tab titles & URLs (and, if allowed, page snippets) to your configured AI provider. Click again to continue." });
        return;
      }
      setConfirmingStash(null);
      await acknowledgeNotice();
    }
    setStashBusy(groupId);
    setStatus(null);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "stashGroup", windowId, groupId });
    } finally {
      setStashBusy(null);
    }
    await refreshPanels();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `Stashed “${res.stash?.name}” · ${res.stash?.tabCount} tabs` }
    );
  };

  const resumeStash = async (stashId: string) => {
    setStashBusy(stashId);
    setStatus(null);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "resumeStash", stashId, windowId });
    } finally {
      setStashBusy(null);
    }
    await refreshPanels();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `Restored ${res.tabCount} tab${res.tabCount === 1 ? "" : "s"}` }
    );
  };

  const deleteStash = async (stashId: string) => {
    const res = await chrome.runtime.sendMessage({ type: "deleteStash", stashId });
    await refreshPanels();
    setStatus(res?.error ? { text: res.error, error: true } : { text: "Stash deleted" });
  };

  const reviewing = groups.length > 0;
  const organizing = running === "organize" || organizeJob?.status === "running";
  const disabled =
    Boolean(running) || reviewing || stashBusy !== null || acknowledged === null || windowId === undefined;
  const icon = (action: Action, idle: ReactNode) =>
    running === action ? <LoaderCircle className="size-4 animate-spin" /> : idle;

  return (
    <main className="popup-shell w-[340px] p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground">
            <img src="icons/icon48.png" alt="" className="size-5 rounded-[5px]" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Focused</span>
        </div>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-border hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="size-4" />
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
          {showPinPrompt && (
            <PinPrompt
              onDismiss={() => {
                setShowPinPrompt(false);
                chrome.storage.local.set({ pinPromptDismissed: true });
              }}
            />
          )}

          <CommandBar windowId={windowId} disabled={disabled} acknowledged={acknowledged === true} onAcknowledge={acknowledgeNotice} />

          <button
            onClick={organize}
            disabled={disabled}
            className="mt-3 flex h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-transparent text-sm font-medium text-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-primary/50 hover:bg-muted active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            aria-label="Organize tabs"
          >
            <Sparkles className="size-5 text-primary" />
            <span>{confirming ? "Continue organizing" : "Organize tabs"}</span>
          </button>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <QuickAction label="Ungroup" onClick={ungroup} disabled={disabled} icon={icon("ungroup", <UngroupIcon className="size-[18px]" />)} />
            <QuickAction label="Close duplicates" onClick={cleanDuplicates} disabled={disabled} icon={icon("duplicates", <CopyX className="size-4" />)} />
            <QuickAction label="Undo" onClick={undo} disabled={disabled || !hasUndo} icon={icon("undo", <Undo2 className="size-4" />)} />
          </div>

          <StashPanel
            groups={groupList}
            stashes={stashes}
            busyId={stashBusy}
            disabled={disabled}
            onStash={stashGroup}
            onResume={resumeStash}
            onDelete={deleteStash}
          />
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
