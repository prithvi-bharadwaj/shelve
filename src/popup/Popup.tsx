import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { Combine, CopyX, LoaderCircle, MailPlus, Settings, Sparkles, Undo2 } from "lucide-react";
import { UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CommandBar } from "@/popup/CommandBar";
import { OrganizingRail } from "@/popup/OrganizingRail";
import { PinPrompt } from "@/popup/PinPrompt";
import { ReviewGroups } from "@/popup/ReviewGroups";
import { StashPanel } from "@/popup/StashPanel";
import type {
  ClosedDuplicateTab,
  GroupInfo,
  MergeResponse,
  OrganizeJob,
  OrganizeResponse,
  ProposedGroup,
  Stash,
} from "@/types";

// True when running inside the in-page iframe overlay (see public/overlay.js);
// the panel then has rounded corners the window beam must follow.
const isOverlay =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("overlay");

// popup.html is web-accessible, so any site can iframe it — not just our
// overlay script. Embedded instances must prove the toolbar icon was clicked
// (single-use token minted by the background) before the UI unlocks.
const isEmbedded = typeof window !== "undefined" && window.self !== window.top;

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean; closedTabs?: ClosedDuplicateTab[] } | null;

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
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  // null = storage not yet read; the UI must stay inert until this resolves.
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [commandRunning, setCommandRunning] = useState(false);
  const [groupList, setGroupList] = useState<GroupInfo[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [stashBusy, setStashBusy] = useState<number | string | null>(null);
  const [confirmingStash, setConfirmingStash] = useState<number | null>(null);
  const [organizeClosedTabs, setOrganizeClosedTabs] = useState<ClosedDuplicateTab[]>([]);
  // null = handshake pending (embedded only); top-level windows are trusted.
  const [embedAllowed, setEmbedAllowed] = useState<boolean | null>(isEmbedded ? null : true);
  const ownsOrganizeRequest = useRef(false);
  const handledJobId = useRef<string | null>(null);

  useEffect(() => {
    if (!isEmbedded) return;
    let cancelled = false;
    chrome.runtime
      .sendMessage({ type: "overlayHandshake" })
      .then((res: { allowed?: boolean } | undefined) => {
        if (!cancelled) setEmbedAllowed(res?.allowed === true);
      })
      .catch(() => {
        if (!cancelled) setEmbedAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUndo = useCallback(async (targetWindowId: number | undefined = windowId) => {
    if (!targetWindowId) return;
    const result = await chrome.runtime.sendMessage({ type: "hasUndo", windowId: targetWindowId });
    setHasUndo(Boolean(result?.hasUndo));
  }, [windowId]);

  const refreshWindowCount = useCallback(async () => {
    const windows = await chrome.runtime.sendMessage({ type: "windowCount" });
    if (windows?.count) setWindowCount(windows.count);
  }, []);

  // The in-page overlay outlives window changes; a mount-time count would
  // leave "Merge windows" wrongly disabled (or enabled) as windows come and go.
  useEffect(() => {
    const onWindowsChanged = () => {
      refreshWindowCount().catch(() => undefined);
    };
    chrome.windows.onCreated?.addListener(onWindowsChanged);
    chrome.windows.onRemoved.addListener(onWindowsChanged);
    return () => {
      chrome.windows.onCreated?.removeListener(onWindowsChanged);
      chrome.windows.onRemoved.removeListener(onWindowsChanged);
    };
  }, [refreshWindowCount]);

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
    const closedTabs = Array.isArray(res?.closedTabs) ? res.closedTabs : [];
    if (!res || res.error) {
      setOrganizeClosedTabs([]);
      setStatus({ text: res?.error ?? "Something went wrong.", error: true, closedTabs });
      await consumeJob(jobId);
      return;
    }
    if (res.review && res.groups) {
      setOrganizeClosedTabs(closedTabs);
      setGroups(res.groups);
      setSelected(new Set(res.groups.map((_, index) => index)));
      setReviewMinSize(res.minSize || 1);
      setStatus(null);
      return;
    }
    setOrganizeClosedTabs([]);
    setStatus({
      text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} · ${res.tabCount} tabs sorted`,
      closedTabs,
    });
    await consumeJob(jobId);
    await refreshPanels();
  }, [consumeJob, refreshUndo, refreshPanels]);

  useEffect(() => {
    (async () => {
      const window = await chrome.windows.getCurrent();
      const [undoState, windows, local] = await Promise.all([
        chrome.runtime.sendMessage({ type: "hasUndo", windowId: window.id }),
        chrome.runtime.sendMessage({ type: "windowCount" }),
        chrome.storage.local.get({ dataNoticeAck: false, pinPromptDismissed: false }),
      ]);
      try {
        const userSettings = await chrome.action.getUserSettings();
        setShowPinPrompt(!userSettings.isOnToolbar && !local.pinPromptDismissed);
      } catch {
        // Not every Chromium fork exposes getUserSettings; skip the prompt there.
      }
      setWindowId(window.id);
      if (windows?.count) setWindowCount(windows.count);
      setHasUndo(Boolean(undoState?.hasUndo));
      setAcknowledged(Boolean(local.dataNoticeAck));
    })();
  }, []);

  // One restoration query on mount, then poll only while a job is actually
  // running — an idle popup must not send status requests forever. The
  // organizeActive dependency re-arms polling when a local organize starts.
  const organizeActive = running === "organize" || organizeJob?.status === "running";
  useEffect(() => {
    if (!windowId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      let keepPolling = false;
      try {
        const response = await chrome.runtime.sendMessage({ type: "organizeStatus", windowId });
        if (stopped) return;
        const job = response?.job as OrganizeJob | null;
        if (job?.status === "running") {
          setOrganizeJob(job);
          setRunning("organize");
          setStatus(null);
          keepPolling = true;
        } else if (job && !ownsOrganizeRequest.current && handledJobId.current !== job.id) {
          setOrganizeJob(job);
          await handleOrganizeResult(job.result || { error: job.error }, job.id);
        }
      } catch {
        // The popup can disappear between polls; the background job keeps running.
      }
      if (!stopped && keepPolling) timer = window.setTimeout(poll, 450);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [handleOrganizeResult, windowId, organizeActive]);

  const organize = async () => {
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
    setOrganizeClosedTabs([]);
    handledJobId.current = null;
    ownsOrganizeRequest.current = true;
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

  const discardReview = async () => {
    const jobId = organizeJob?.id ?? handledJobId.current ?? undefined;
    try {
      if (windowId && jobId) {
        const res = await chrome.runtime.sendMessage({ type: "consumeOrganizeResult", windowId, jobId });
        if (!res?.cleared) {
          setStatus({ text: "Couldn't discard the suggestions — try again.", error: true });
          return;
        }
      }
      setGroups([]);
      setSelected(new Set());
      setOrganizeJob(null);
      setStatus({
        text: organizeClosedTabs.length
          ? `Suggestions discarded · ${organizeClosedTabs.length} duplicate tab${organizeClosedTabs.length === 1 ? "" : "s"} closed`
          : "Suggestions discarded.",
        closedTabs: organizeClosedTabs,
      });
      setOrganizeClosedTabs([]);
    } catch {
      setStatus({ text: "Couldn't discard the suggestions — try again.", error: true });
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
        ? { text: res.error, error: true, closedTabs: organizeClosedTabs }
        : {
            text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} created`,
            closedTabs: organizeClosedTabs,
          }
    );
    setOrganizeClosedTabs([]);
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
        : {
            text: res.closedCount ? `Closed ${res.closedCount} duplicate tab${res.closedCount === 1 ? "" : "s"}` : "No duplicate tabs found",
            closedTabs: Array.isArray(res.closedTabs) ? res.closedTabs : [],
          }
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
    await Promise.all([refreshWindowCount(), refreshPanels()]);
    setStatus({ text: `Merged ${res.windows} window${res.windows === 1 ? "" : "s"} · ${res.tabs} tabs` });
  };

  const undo = async () => {
    setRunning("undo");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "undo", windowId });
    setRunning(null);
    await Promise.all([refreshUndo(), refreshPanels()]);
    if (res?.error) {
      setStatus({ text: res.error, error: true });
      return;
    }
    setStatus({
      text: res?.skippedCount
        ? `Restored the available layout — ${res.skippedCount} tab${res.skippedCount === 1 ? "" : "s"} closed since couldn't be brought back`
        : "Previous tab layout restored",
    });
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
    Boolean(running) ||
    reviewing ||
    stashBusy !== null ||
    commandRunning ||
    acknowledged === null ||
    windowId === undefined;
  const icon = (action: Action, idle: ReactNode) =>
    running === action ? <LoaderCircle className="size-4 animate-spin" /> : idle;

  if (embedAllowed === null) return null;
  if (embedAllowed === false) {
    return (
      <main className="popup-shell w-[340px] p-4">
        <p className="text-xs text-muted-foreground">
          Open Focused from the toolbar icon to use it here.
        </p>
      </main>
    );
  }

  return (
    <BorderBeam
      size="md"
      colorVariant="ocean"
      theme="dark"
      strength={0.45}
      borderRadius={isOverlay ? 16 : 0}
      active={organizing || commandRunning}
      className="popup-frame"
      data-testid="window-beam"
    >
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
          onDiscard={discardReview}
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

          <CommandBar
            windowId={windowId}
            disabled={disabled && !commandRunning}
            acknowledged={acknowledged === true}
            onAcknowledge={acknowledgeNotice}
            onRunningChange={setCommandRunning}
            onMutation={async () => {
              await Promise.all([refreshUndo(), refreshPanels()]);
            }}
          />

          <BorderBeam
            size="md"
            colorVariant="ocean"
            theme="dark"
            strength={0.4}
            active={confirming}
            className="mt-3 w-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            data-testid="organize-beam"
          >
            <button
              onClick={organize}
              disabled={disabled}
              className="flex h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-transparent text-sm font-medium text-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-primary/50 hover:bg-muted active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              aria-label="Organize tabs"
            >
              <Sparkles className="size-5 text-primary" />
              <span>{confirming ? "Continue organizing" : "Organize tabs"}</span>
            </button>
          </BorderBeam>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <QuickAction label="Ungroup" onClick={ungroup} disabled={disabled} icon={icon("ungroup", <UngroupIcon className="size-[18px]" />)} />
            <QuickAction label="Close duplicates" onClick={cleanDuplicates} disabled={disabled} icon={icon("duplicates", <CopyX className="size-4" />)} />
            <QuickAction label="Merge windows" onClick={merge} disabled={disabled || windowCount <= 1} icon={icon("merge", <Combine className="size-4" />)} />
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
        <>
          <div className="mt-4 min-h-4 text-xs" aria-live="polite">
            <p className={status?.error ? "text-destructive" : "text-muted-foreground"}>
              {status?.text ?? ""}
            </p>
            {status?.closedTabs && status.closedTabs.length > 0 && (
              <div className="closed-toast relative mt-2 overflow-hidden rounded-md border border-border bg-muted/20">
                <ul
                  aria-label="Closed duplicate tabs"
                  className="max-h-36 space-y-1.5 overflow-y-auto p-2 pb-2.5"
                >
                  {status.closedTabs.map((tab, index) => (
                    <li key={`${tab.url}-${index}`} className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-medium leading-snug text-foreground">
                          {tab.title || "Untitled tab"}
                        </p>
                        <p className="break-all leading-snug text-muted-foreground">{tab.url}</p>
                      </div>
                      {tab.keptTabId !== undefined && (
                        <button
                          type="button"
                          onClick={() =>
                            chrome.runtime.sendMessage({ type: "focusTab", tabId: tab.keptTabId })
                          }
                          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          View existing
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div
                  data-testid="closed-toast-timer"
                  className="closed-toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/60"
                  onAnimationEnd={() => setStatus(null)}
                />
              </div>
            )}
          </div>

          <a
            href="mailto:prithvi@skive.in?subject=Focused%20feature%20request&body=Hi%20Prithvi%2C%0A%0AI%27d%20like%20to%20request%3A%0A%0A"
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-transparent text-xs text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-border hover:bg-muted/50 hover:text-foreground active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MailPlus className="size-3.5" />
            Request a feature
          </a>
        </>
      )}
    </main>
    </BorderBeam>
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
      <span className="px-1 text-center leading-tight">{label}</span>
    </button>
  );
}
