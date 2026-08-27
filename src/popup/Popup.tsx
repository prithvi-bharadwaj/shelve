import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { Combine, CopyX, LoaderCircle, MailPlus, Settings, Sparkles, Undo2 } from "lucide-react";
import { UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ClosedDuplicatesToast } from "@/popup/ClosedDuplicatesToast";
import { CommandBar } from "@/popup/CommandBar";
import { OrganizingRail } from "@/popup/OrganizingRail";
import { PinPrompt } from "@/popup/PinPrompt";
import { QuickAction } from "@/popup/QuickAction";
import { ReviewGroups } from "@/popup/ReviewGroups";
import { StashPanel } from "@/popup/StashPanel";
import { StatsCard } from "@/popup/StatsCard";
import { UpgradeScreen } from "@/popup/UpgradeScreen";
import { useOrganizeJob } from "@/popup/useOrganizeJob";
import { useQuickActions } from "@/popup/useQuickActions";
import { useStashActions } from "@/popup/useStashActions";
import type {
  ClosedDuplicateTab,
  GroupInfo,
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
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewMinSize, setReviewMinSize] = useState(1);
  const [windowId, setWindowId] = useState<number>();
  const [windowCount, setWindowCount] = useState(1);
  const [hasUndo, setHasUndo] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  // null = storage not yet read; the UI must stay inert until this resolves.
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [commandRunning, setCommandRunning] = useState(false);
  const [groupList, setGroupList] = useState<GroupInfo[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [organizeClosedTabs, setOrganizeClosedTabs] = useState<ClosedDuplicateTab[]>([]);
  // null = handshake pending (embedded only); top-level windows are trusted.
  const [embedAllowed, setEmbedAllowed] = useState<boolean | null>(isEmbedded ? null : true);
  // Set when the free tier runs out (proxy 402/429); replaces the action panel
  // with the upgrade screen until dismissed or a new organize starts.
  const [upgrade, setUpgrade] = useState<{ dailyLimit: boolean } | null>(null);
  // Easter egg: clicking the logo flips it over.
  const [logoFlipped, setLogoFlipped] = useState(false);

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

  const onQuotaExhausted = useCallback((message: string) => {
    setUpgrade({ dailyLimit: /reset tomorrow/i.test(message) });
    // The organize path may have just reported closed duplicates; keep that
    // toast so dismissing the upgrade screen still shows what was closed.
    setStatus((current) => (current?.closedTabs?.length ? { text: "", closedTabs: current.closedTabs } : null));
  }, []);

  const {
    organizeJob,
    setOrganizeJob,
    consumeJob,
    handleOrganizeResult,
    ownsOrganizeRequest,
    handledJobId,
    organizeActive,
  } = useOrganizeJob({
    windowId,
    running,
    setRunning,
    setStatus,
    setGroups,
    setSelected,
    setReviewMinSize,
    setOrganizeClosedTabs,
    refreshUndo,
    refreshPanels,
    onQuotaExhausted,
  });

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

  const organize = async () => {
    // First run: no blocking confirm step — disclose in the status line, mark
    // the notice acknowledged, and go straight to the permission prompt.
    const firstRun = !acknowledged;
    if (firstRun) {
      setAcknowledged(true);
      await chrome.storage.local.set({ dataNoticeAck: true });
    }

    setRunning("organize");
    setStatus(
      firstRun
        ? { text: "Sends tab titles & URLs (and, if allowed, page snippets) to your configured AI provider." }
        : null
    );
    setUpgrade(null);
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

  const acknowledgeNotice = useCallback(async () => {
    setAcknowledged(true);
    await chrome.storage.local.set({ dataNoticeAck: true });
  }, []);

  const { ungroup, cleanDuplicates, merge, undo } = useQuickActions({
    windowId,
    setRunning,
    setStatus,
    refreshUndo,
    refreshPanels,
    refreshWindowCount,
  });

  const { stashBusy, stashGroup, resumeStash, deleteStash } = useStashActions({
    windowId,
    acknowledged,
    acknowledgeNotice,
    setStatus,
    refreshPanels,
  });

  const reviewing = groups.length > 0;
  const organizing = organizeActive;
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
          Open Shelve from the toolbar icon to use it here.
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
          <button
            type="button"
            onClick={() => setLogoFlipped((f) => !f)}
            className="relative size-9 shrink-0 cursor-pointer outline-none"
            tabIndex={-1}
            aria-hidden="true"
          >
            <img src="icons/logo.svg" alt="" className="absolute inset-0 size-9 opacity-60 blur-md saturate-150" />
            <img
              src="icons/logo.svg"
              alt=""
              className="relative size-9 transition-transform duration-500"
              style={{ transform: logoFlipped ? "rotateY(180deg)" : "none" }}
            />
          </button>
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold tracking-tight">Shelve</span>
            <span className="text-[9px] font-normal tracking-wide text-muted-foreground/50">
              beta {chrome.runtime.getManifest?.().version ?? ""}b
            </span>
          </span>
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

      {upgrade && !organizing ? (
        <UpgradeScreen dailyLimit={upgrade.dailyLimit} onDismiss={() => setUpgrade(null)} />
      ) : organizing ? (
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
            onQuotaExhausted={onQuotaExhausted}
          />

          <BorderBeam
            size="md"
            colorVariant="ocean"
            theme="dark"
            strength={0.4}
            active={acknowledged === false || (running === "organize" && !organizing)}
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
              <span>Organize tabs</span>
            </button>
          </BorderBeam>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <QuickAction label="Ungroup" onClick={ungroup} disabled={disabled} icon={icon("ungroup", <UngroupIcon className="size-[18px]" />)} />
            <QuickAction label="Duplicates" title="Close duplicates" onClick={cleanDuplicates} disabled={disabled} icon={icon("duplicates", <CopyX className="size-4" />)} />
            <QuickAction label="Merge" title="Merge windows" onClick={merge} disabled={disabled || windowCount <= 1} icon={icon("merge", <Combine className="size-4" />)} />
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

      {!organizing && !upgrade && (
        <>
          <div className="mt-4 min-h-4 text-xs" aria-live="polite">
            <p className={status?.error ? "text-destructive" : "text-muted-foreground"}>
              {status?.text ?? ""}
            </p>
            {status?.closedTabs && status.closedTabs.length > 0 && (
              <ClosedDuplicatesToast closedTabs={status.closedTabs} onExpire={() => setStatus(null)} />
            )}
          </div>

          <StatsCard refreshToken={status} />

          <a
            href="mailto:prithvi@skive.in?subject=Shelve%20feature%20request&body=Hi%20Prithvi%2C%0A%0AI%27d%20like%20to%20request%3A%0A%0A"
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
