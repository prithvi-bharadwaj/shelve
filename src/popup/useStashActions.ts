import { useState, type Dispatch, type SetStateAction } from "react";
import type { ClosedDuplicateTab } from "@/types";

type Status = { text: string; error?: boolean; closedTabs?: ClosedDuplicateTab[] } | null;

// Stash lifecycle handlers plus their busy/confirm state, moved verbatim from
// Popup. The double-click confirm only gates the first-ever AI disclosure.
export function useStashActions({
  windowId,
  acknowledged,
  acknowledgeNotice,
  setStatus,
  refreshPanels,
}: {
  windowId: number | undefined;
  acknowledged: boolean | null;
  acknowledgeNotice: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<Status>>;
  refreshPanels: () => Promise<void>;
}) {
  const [stashBusy, setStashBusy] = useState<number | string | null>(null);
  const [confirmingStash, setConfirmingStash] = useState<number | null>(null);

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

  return { stashBusy, stashGroup, resumeStash, deleteStash };
}
