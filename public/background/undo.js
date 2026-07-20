// Undo snapshots: capture, storage (session/local/in-memory for incognito),
// and the retryable undo restore.

import { LEGACY_UNDO_KEY, UNDO_KEY_PREFIX } from "./constants.js";

// Accepts only Plan-003 v2 records. Snapshots written before the closedTabs
// journal existed carried parallel closedUrls/closedTabIds arrays; zip those
// into journal entries. Unversioned records are rejected, never migrated.
function normalizeUndoSnapshot(snapshot) {
  if (
    !snapshot ||
    snapshot.version !== 2 ||
    !Number.isInteger(snapshot.windowId) ||
    typeof snapshot.incognito !== "boolean"
  ) {
    return null;
  }
  const normalized = { ...snapshot };
  let closedTabs;
  if (Array.isArray(snapshot.closedTabs)) {
    closedTabs = snapshot.closedTabs;
  } else {
    const ids = Array.isArray(snapshot.closedTabIds) ? snapshot.closedTabIds : [];
    const urls = Array.isArray(snapshot.closedUrls) ? snapshot.closedUrls : [];
    closedTabs = urls.map((url, index) => ({ originalId: ids[index], url, reopenedId: null }));
  }
  normalized.closedTabs = closedTabs
    .filter((entry) => entry && typeof entry.url === "string" && entry.url)
    .map((entry) => ({
      originalId: Number.isInteger(entry.originalId) ? entry.originalId : null,
      url: entry.url,
      reopenedId: Number.isInteger(entry.reopenedId) ? entry.reopenedId : null
    }));
  delete normalized.closedUrls;
  delete normalized.closedTabIds;
  return normalized;
}

// Incognito undo lives only in worker memory: chrome.storage.session and
// chrome.storage.local are shared with regular browsing, so persisting these
// snapshots would leak private URLs. It intentionally dies with the worker.
const incognitoUndoByWindow = new Map();

export function dropIncognitoUndo(windowId) {
  incognitoUndoByWindow.delete(windowId);
}

export function undoStorageKey(windowId) {
  return Number.isInteger(windowId) ? `${UNDO_KEY_PREFIX}${windowId}` : null;
}

// The legacy global key never recorded which browsing context wrote it, so it
// is deleted, never migrated. Losing one old undo record is the safe choice.
export async function purgeLegacyUndo() {
  await chrome.storage.local.remove(LEGACY_UNDO_KEY).catch(() => undefined);
  if (chrome.storage.session) {
    await chrome.storage.session.remove(LEGACY_UNDO_KEY).catch(() => undefined);
  }
}

export async function captureSnapshot(windowId) {
  // If the window cannot be read, this throws and the destructive action that
  // wanted a snapshot fails before touching any tabs.
  const [targetWindow, tabs, groups] = await Promise.all([
    chrome.windows.get(windowId),
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  return {
    version: 2,
    windowId,
    incognito: Boolean(targetWindow.incognito),
    tabs: tabs.map((tab) => ({
      id: tab.id,
      url: tab.url || "",
      index: tab.index,
      pinned: Boolean(tab.pinned),
      groupId: tab.groupId
    })),
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title || "",
      color: group.color,
      collapsed: Boolean(group.collapsed)
    })),
    closedTabs: []
  };
}

export async function storeUndoSnapshot(snapshot) {
  if (
    !snapshot ||
    snapshot.version !== 2 ||
    !Number.isInteger(snapshot.windowId) ||
    typeof snapshot.incognito !== "boolean"
  ) {
    throw new Error("Invalid undo snapshot.");
  }
  if (snapshot.incognito) {
    incognitoUndoByWindow.set(snapshot.windowId, snapshot);
    return;
  }
  const key = undoStorageKey(snapshot.windowId);
  try {
    if (!chrome.storage.session) throw new Error();
    await chrome.storage.session.set({ [key]: snapshot });
    await chrome.storage.local.remove(key);
  } catch {
    await chrome.storage.local.set({ [key]: snapshot });
  }
}

export async function getUndoSnapshot(windowId) {
  if (!Number.isInteger(windowId)) return null;
  const targetWindow = await chrome.windows.get(windowId).catch(() => null);
  if (!targetWindow) return null;
  if (targetWindow.incognito) {
    return normalizeUndoSnapshot(incognitoUndoByWindow.get(windowId) || null);
  }
  const key = undoStorageKey(windowId);
  let stored = null;
  try {
    if (chrome.storage.session) {
      stored = (await chrome.storage.session.get(key))[key] || null;
    }
  } catch {
    // Fall through to local storage.
  }
  if (!stored) {
    stored = (await chrome.storage.local.get(key))[key] || null;
  }
  if (!stored) return null;
  if (stored.version !== 2 || stored.windowId !== windowId || stored.incognito !== false) {
    await removeStoredUndo(key);
    return null;
  }
  return normalizeUndoSnapshot(stored);
}

async function removeStoredUndo(key) {
  if (!key) return;
  const tasks = [chrome.storage.local.remove(key).catch(() => undefined)];
  if (chrome.storage.session) tasks.push(chrome.storage.session.remove(key).catch(() => undefined));
  await Promise.all(tasks);
}

export async function clearUndoSnapshot(windowId) {
  incognitoUndoByWindow.delete(windowId);
  await removeStoredUndo(undoStorageKey(windowId));
}

export async function hasUndo(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  return { hasUndo: Boolean(await getUndoSnapshot(targetWindowId)) };
}

// Undo is retryable: reopened tab IDs are checkpointed into the snapshot
// before further work so a retry reuses them instead of duplicating tabs, and
// the snapshot is cleared only after every recoverable operation succeeds.
export async function undo(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const snapshot = await getUndoSnapshot(targetWindowId);
  if (!snapshot) return { error: "Nothing to undo." };

  let failedCount = 0;
  let skippedCount = 0;
  const idMap = new Map();
  const partialResult = () => ({
    error: "Undo partially restored. Retry Undo to finish.",
    partial: true,
    tabCount: 0,
    reopenedCount: snapshot.closedTabs.filter((entry) => Number.isInteger(entry.reopenedId)).length,
    failedCount,
    skippedCount
  });

  for (const entry of snapshot.closedTabs) {
    if (Number.isInteger(entry.reopenedId)) {
      const existing = await chrome.tabs.get(entry.reopenedId).catch(() => null);
      if (existing && existing.windowId === snapshot.windowId && existing.url === entry.url) {
        if (entry.originalId !== null) idMap.set(entry.originalId, entry.reopenedId);
        continue;
      }
      entry.reopenedId = null;
    }
    const tab = await chrome.tabs
      .create({ windowId: snapshot.windowId, url: entry.url, active: false })
      .catch(() => null);
    if (!tab) {
      failedCount++;
      continue;
    }
    entry.reopenedId = tab.id;
    const checkpointed = await storeUndoSnapshot(snapshot).then(() => true, () => false);
    if (!checkpointed) {
      // Never leave an unjournaled tab behind: without the checkpoint a retry
      // would open a duplicate of it.
      entry.reopenedId = null;
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      failedCount++;
      return partialResult();
    }
    if (entry.originalId !== null) idMap.set(entry.originalId, tab.id);
  }

  const journaledIds = new Set(
    snapshot.closedTabs.map((entry) => entry.originalId).filter((id) => id !== null)
  );
  const restored = [];
  for (const original of snapshot.tabs || []) {
    const liveId = idMap.get(original.id) || original.id;
    const tab = await chrome.tabs.get(liveId).catch(() => null);
    if (!tab || tab.windowId !== snapshot.windowId) {
      // Closed by the user after the action, with no journaled URL to recreate
      // it from. Skipped, not retryable.
      if (!journaledIds.has(original.id)) skippedCount++;
      continue;
    }
    restored.push({ original, id: liveId, tab });
  }

  // Restoration re-runs idempotently on retry: ungroup returns everything to a
  // known state before pins, order, and groups are reapplied.
  const groupedIds = restored.filter((item) => item.tab.groupId !== -1).map((item) => item.id);
  if (groupedIds.length) {
    const ungrouped = await chrome.tabs.ungroup(groupedIds).then(() => true, () => false);
    if (!ungrouped) failedCount++;
  }

  for (const item of restored) {
    if (item.tab.pinned !== item.original.pinned) {
      const pinned = await chrome.tabs
        .update(item.id, { pinned: item.original.pinned })
        .then(() => true, () => false);
      if (!pinned) failedCount++;
    }
  }
  for (const item of [...restored].sort((a, b) => a.original.index - b.original.index)) {
    const moved = await chrome.tabs.move(item.id, { index: item.original.index }).then(() => true, () => false);
    if (!moved) failedCount++;
  }

  const groupMeta = new Map((snapshot.groups || []).map((group) => [group.id, group]));
  const membersByGroup = new Map();
  for (const item of restored) {
    if (item.original.groupId === -1 || item.original.pinned) continue;
    if (!membersByGroup.has(item.original.groupId)) membersByGroup.set(item.original.groupId, []);
    membersByGroup.get(item.original.groupId).push(item);
  }
  for (const [oldGroupId, members] of membersByGroup) {
    try {
      const newGroupId = await chrome.tabs.group({ tabIds: members.map((item) => item.id) });
      const meta = groupMeta.get(oldGroupId);
      if (meta) {
        await chrome.tabGroups.update(newGroupId, {
          title: meta.title,
          color: meta.color,
          collapsed: Boolean(meta.collapsed)
        });
      }
      const index = Math.min(...members.map((item) => item.original.index));
      await chrome.tabGroups.move(newGroupId, { index });
    } catch {
      failedCount++;
    }
  }

  const reopenedCount = snapshot.closedTabs.filter((entry) => Number.isInteger(entry.reopenedId)).length;
  if (failedCount > 0) {
    await storeUndoSnapshot(snapshot).catch(() => undefined);
    return { ...partialResult(), tabCount: restored.length, reopenedCount };
  }
  await clearUndoSnapshot(targetWindowId);
  return { done: true, tabCount: restored.length, reopenedCount, skippedCount };
}
