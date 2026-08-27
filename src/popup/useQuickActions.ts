import type { Dispatch, SetStateAction } from "react";
import type { ClosedDuplicateTab, MergeResponse } from "@/types";

type Action = "organize" | "ungroup" | "duplicates" | "merge" | "undo" | "apply";
type Status = { text: string; error?: boolean; closedTabs?: ClosedDuplicateTab[] } | null;

// The four quick-action handlers (ungroup, duplicates, merge, undo), moved
// verbatim from Popup.
export function useQuickActions({
  windowId,
  setRunning,
  setStatus,
  refreshUndo,
  refreshPanels,
  refreshWindowCount,
}: {
  windowId: number | undefined;
  setRunning: Dispatch<SetStateAction<Action | null>>;
  setStatus: Dispatch<SetStateAction<Status>>;
  refreshUndo: () => Promise<void>;
  refreshPanels: () => Promise<void>;
  refreshWindowCount: () => Promise<void>;
}) {
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

  return { ungroup, cleanDuplicates, merge, undo };
}
