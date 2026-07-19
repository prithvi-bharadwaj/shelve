import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BellRing,
  ChevronDown,
  Combine,
  CopyX,
  LoaderCircle,
  Settings,
  Sparkles,
  Undo2,
} from "lucide-react";
import { UngroupIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { CommandBar } from "@/popup/CommandBar";
import { OrganizingRail } from "@/popup/OrganizingRail";
import { ReviewGroups } from "@/popup/ReviewGroups";
import { StashPanel } from "@/popup/StashPanel";
import type {
  GroupInfo,
  MergeResponse,
  OrganizeJob,
  OrganizeResponse,
  ProposedGroup,
  Provider,
  Stash,
} from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean } | null;

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
  const [dedupeOnOrganize, setDedupeOnOrganize] = useState(false);
  const [mergeOnOrganize, setMergeOnOrganize] = useState(false);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorThreshold, setMonitorThreshold] = useState(15);
  const [tabCount, setTabCount] = useState(0);
  const [basicSettingsOpen, setBasicSettingsOpen] = useState(false);
  const [monitorPromptDismissed, setMonitorPromptDismissed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [groupList, setGroupList] = useState<GroupInfo[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [stashBusy, setStashBusy] = useState<number | string | null>(null);
  const [confirmingStash, setConfirmingStash] = useState<number | null>(null);
  const ownsOrganizeRequest = useRef(false);
  const handledJobId = useRef<string | null>(null);

  const refreshUndo = useCallback(async () => {
    const result = await chrome.runtime.sendMessage({ type: "hasUndo" });
    setHasUndo(Boolean(result?.hasUndo));
  }, []);

  const refreshPanels = useCallback(async () => {
    if (!windowId) return;
    const [groupsRes, stashRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "listGroups", windowId }),
      chrome.runtime.sendMessage({ type: "listStashes" }),
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

  const refreshCounts = useCallback(async () => {
    const [windows, monitor] = await Promise.all([
      chrome.runtime.sendMessage({ type: "windowCount" }),
      windowId ? chrome.runtime.sendMessage({ type: "monitorState", windowId }) : null,
    ]);
    if (windows?.count) setWindowCount(windows.count);
    if (monitor) setTabCount(Number(monitor.count) || 0);
  }, [windowId]);

  const consumeJob = useCallback(async (jobId?: string) => {
    if (!windowId || !jobId) return;
    await chrome.runtime.sendMessage({ type: "consumeOrganizeResult", windowId, jobId });
    setOrganizeJob(null);
  }, [windowId]);

  const handleOrganizeResult = useCallback(async (res: OrganizeResponse | undefined, jobId?: string) => {
    if (jobId && handledJobId.current === jobId) return;
    if (jobId) handledJobId.current = jobId;
    setRunning(null);
    await Promise.all([refreshUndo(), refreshCounts()]);
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
  }, [consumeJob, refreshCounts, refreshUndo, refreshPanels]);

  useEffect(() => {
    (async () => {
      const [window, windows, undoState, sync, local] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.runtime.sendMessage({ type: "windowCount" }),
        chrome.runtime.sendMessage({ type: "hasUndo" }),
        chrome.storage.sync.get({
          minGroupSize: 2,
          dedupeOnOrganize: false,
          mergeOnOrganize: false,
          auto: "off",
          autoThreshold: 15,
        }),
        chrome.storage.local.get({ dataNoticeAck: false }),
      ]);
      setWindowId(window.id);
      if (windows?.count) setWindowCount(windows.count);
      setHasUndo(Boolean(undoState?.hasUndo));
      setMinGroupSize(clamp(sync.minGroupSize, 1, 6));
      setDedupeOnOrganize(Boolean(sync.dedupeOnOrganize));
      setMergeOnOrganize(Boolean(sync.mergeOnOrganize));
      setMonitorEnabled(sync.auto !== "off");
      setMonitorThreshold(clamp(sync.autoThreshold, 1, 999));
      setAcknowledged(Boolean(local.dataNoticeAck));
      const monitor = await chrome.runtime.sendMessage({ type: "monitorState", windowId: window.id });
      setTabCount(Number(monitor?.count) || 0);
      setMonitorThreshold(clamp(monitor?.threshold ?? sync.autoThreshold, 1, 999));
      await chrome.notifications.clear(`focused-tab-monitor:${window.id}`).catch(() => undefined);
      if (sync.auto === "auto") await chrome.storage.sync.set({ auto: "badge" });
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
    setMonitorPromptDismissed(true);
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
    await Promise.all([refreshUndo(), refreshCounts(), refreshPanels()]);
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
    await Promise.all([refreshUndo(), refreshCounts(), refreshPanels()]);
    setStatus(res?.error ? { text: res.error, error: true } : { text: `${res.tabCount} tab${res.tabCount === 1 ? "" : "s"} ungrouped` });
  };

  const cleanDuplicates = async () => {
    setRunning("duplicates");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "cleanDuplicates", windowId });
    setRunning(null);
    await Promise.all([refreshUndo(), refreshCounts(), refreshPanels()]);
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
    await Promise.all([refreshCounts(), refreshPanels()]);
    setStatus({ text: `Merged ${res.windows} window${res.windows === 1 ? "" : "s"} · ${res.tabs} tabs` });
  };

  const undo = async () => {
    setRunning("undo");
    setStatus(null);
    const res = await chrome.runtime.sendMessage({ type: "undo" });
    setRunning(null);
    await Promise.all([refreshUndo(), refreshCounts(), refreshPanels()]);
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
    const res = await chrome.runtime.sendMessage({ type: "stashGroup", windowId, groupId });
    setStashBusy(null);
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
    const res = await chrome.runtime.sendMessage({ type: "resumeStash", stashId, windowId });
    setStashBusy(null);
    await refreshPanels();
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `Restored ${res.tabCount} tab${res.tabCount === 1 ? "" : "s"}` }
    );
  };

  const deleteStash = async (stashId: string) => {
    await chrome.runtime.sendMessage({ type: "deleteStash", stashId });
    await refreshPanels();
    setStatus({ text: "Stash deleted" });
  };

  const reviewing = groups.length > 0;
  const organizing = running === "organize" || organizeJob?.status === "running";
  const disabled = Boolean(running) || reviewing || stashBusy !== null;
  const showMonitorPrompt = monitorEnabled && tabCount >= monitorThreshold && !monitorPromptDismissed;
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
          <CommandBar windowId={windowId} disabled={disabled} acknowledged={acknowledged} onAcknowledge={acknowledgeNotice} />

          {showMonitorPrompt && (
            <section className="mt-5 rounded-lg border border-primary/35 bg-primary/10 p-3" aria-live="polite">
              <div className="flex items-start gap-2.5">
                <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">
                    Hey, you have {tabCount} tabs open. Do you want to organize it?
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button onClick={organize} disabled={disabled} size="sm">Organize now</Button>
                    <Button onClick={() => setMonitorPromptDismissed(true)} variant="ghost" size="sm">Not now</Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <button
            onClick={organize}
            disabled={disabled}
            className="mt-3 flex h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-transparent text-sm font-medium text-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:border-primary/50 hover:bg-muted active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            aria-label="Organize tabs"
          >
            <Sparkles className="size-5 text-primary" />
            <span>{confirming ? "Continue organizing" : "Organize tabs"}</span>
          </button>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <QuickAction label="Ungroup" onClick={ungroup} disabled={disabled} icon={icon("ungroup", <UngroupIcon className="size-[18px]" />)} />
            <QuickAction label="Close duplicates" onClick={cleanDuplicates} disabled={disabled} icon={icon("duplicates", <CopyX className="size-4" />)} />
            <QuickAction label="Merge windows" onClick={merge} disabled={disabled || windowCount <= 1} icon={icon("merge", <Combine className="size-4" />)} />
            <QuickAction label="Undo" onClick={undo} disabled={disabled || !hasUndo} icon={icon("undo", <Undo2 className="size-4" />)} />
          </div>

          <section className="mt-3 overflow-hidden rounded-lg border border-border bg-muted/20">
            <button
              type="button"
              onClick={() => setBasicSettingsOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-medium outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={basicSettingsOpen}
              aria-controls="basic-settings"
            >
              <span>Basic settings</span>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 [transition-timing-function:var(--ease-out-strong)] ${basicSettingsOpen ? "rotate-180" : ""}`} />
            </button>
            {basicSettingsOpen && (
              <div id="basic-settings" className="border-t border-border px-3 py-3">
                <div className="flex items-center gap-3 pb-3">
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

                <div className="flex flex-col border-t border-border">
                  <BasicCheckbox
                    id="dedupe-on-organize"
                    label="Close duplicate tabs"
                    description="Keeps the active or newest copy."
                    checked={dedupeOnOrganize}
                    onCheckedChange={(checked) => {
                      setDedupeOnOrganize(checked);
                      chrome.storage.sync.set({ dedupeOnOrganize: checked });
                    }}
                  />
                  <BasicCheckbox
                    id="merge-on-organize"
                    label="Merge windows while organizing"
                    description="Brings all windows together first."
                    checked={mergeOnOrganize}
                    onCheckedChange={(checked) => {
                      setMergeOnOrganize(checked);
                      chrome.storage.sync.set({ mergeOnOrganize: checked });
                    }}
                  />
                  <BasicCheckbox
                    id="tab-monitor"
                    label="Autonomous tab monitor"
                    description={`Notifies you at ${monitorThreshold} tabs and always asks first.`}
                    icon={<BellRing className="size-4" />}
                    checked={monitorEnabled}
                    onCheckedChange={(checked) => {
                      setMonitorEnabled(checked);
                      setMonitorPromptDismissed(false);
                      chrome.storage.sync.set({ auto: checked ? "badge" : "off" });
                    }}
                  />
                </div>
              </div>
            )}
          </section>

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

function BasicCheckbox({
  id,
  label,
  description,
  icon,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  icon?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-14 cursor-pointer items-start gap-2.5 border-b border-border py-3 last:border-b-0">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {icon ? <span className="text-primary">{icon}</span> : null}
          {label}
        </span>
        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
