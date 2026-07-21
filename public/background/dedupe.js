// Duplicate-tab cleanup for a window.

import { captureSnapshot, storeUndoSnapshot } from "./undo.js";

export async function cleanDuplicates(windowId, { snapshot = true } = {}) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const byUrl = new Map();
  for (const tab of tabs) {
    const url = normalizedDuplicateUrl(tab.url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(tab);
  }

  const toClose = [];
  for (const duplicates of byUrl.values()) {
    if (duplicates.length < 2) continue;
    const protectedTabs = duplicates.filter((tab) => tab.pinned || tab.active);
    const keep = new Set(protectedTabs.map((tab) => tab.id));
    if (!keep.size) {
      const newest = [...duplicates].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      keep.add(newest.id);
    }
    const keeper =
      duplicates.find((tab) => tab.active && keep.has(tab.id)) ||
      duplicates.find((tab) => keep.has(tab.id));
    for (const tab of duplicates) {
      if (!keep.has(tab.id)) toClose.push({ tab, keptTabId: keeper.id });
    }
  }
  if (!toClose.length) return { done: true, closedCount: 0, closedTabs: [] };

  if (snapshot) {
    const captured = await captureSnapshot(targetWindowId);
    captured.closedTabs = toClose
      .filter(({ tab }) => tab.url)
      .map(({ tab }) => ({ originalId: tab.id, url: tab.url, reopenedId: null }));
    await storeUndoSnapshot(captured);
  }
  await chrome.tabs.remove(toClose.map(({ tab }) => tab.id));
  return {
    done: true,
    closedCount: toClose.length,
    closedTabs: toClose.map(({ tab, keptTabId }) => ({
      title: tab.title || "",
      url: tab.url || "",
      keptTabId
    }))
  };
}

// Fragments are part of duplicate identity: hash-routed apps encode the
// document/route after "#", so stripping it can close distinct pages.
export function normalizedDuplicateUrl(value) {
  if (!value) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}
