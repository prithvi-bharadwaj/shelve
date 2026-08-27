import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ClosedDuplicateTab, OrganizeJob, OrganizeResponse, ProposedGroup } from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean; closedTabs?: ClosedDuplicateTab[] } | null;

// Owns the organize-job lifecycle: result handling, consumption, and the
// race-sensitive status polling (zombie-job restoration, ownership guards).
// Moved verbatim from Popup — the guard semantics are load-bearing.
export function useOrganizeJob({
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
}: {
  windowId: number | undefined;
  running: Action | null;
  setRunning: Dispatch<SetStateAction<Action | null>>;
  setStatus: Dispatch<SetStateAction<Status>>;
  setGroups: Dispatch<SetStateAction<ProposedGroup[]>>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  setReviewMinSize: Dispatch<SetStateAction<number>>;
  setOrganizeClosedTabs: Dispatch<SetStateAction<ClosedDuplicateTab[]>>;
  refreshUndo: () => Promise<void>;
  refreshPanels: () => Promise<void>;
  onQuotaExhausted?: (message: string) => void;
}) {
  const [organizeJob, setOrganizeJob] = useState<OrganizeJob | null>(null);
  const ownsOrganizeRequest = useRef(false);
  const handledJobId = useRef<string | null>(null);

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
      // Out-of-quota (proxy 402/429) upgrades the bare error into the upgrade screen.
      if (res?.quota) onQuotaExhausted?.(res.error ?? "");
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
  }, [consumeJob, refreshUndo, refreshPanels, onQuotaExhausted, setGroups, setOrganizeClosedTabs, setReviewMinSize, setRunning, setSelected, setStatus]);

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
  }, [handleOrganizeResult, windowId, organizeActive, setRunning, setStatus]);

  return { organizeJob, setOrganizeJob, consumeJob, handleOrganizeResult, ownsOrganizeRequest, handledJobId, organizeActive };
}
