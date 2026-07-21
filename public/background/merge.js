// Window merging: pull every other same-profile window into the target
// window, keeping whole groups intact and pinned tabs pinned.

// Concurrent merges (two popups, or a quick action racing merge-on-organize)
// would each move tabs from a stale window snapshot; queue them instead.
let mergeQueue = Promise.resolve();

export function mergeWindows(targetWindowId) {
  const run = mergeQueue.then(() => doMergeWindows(targetWindowId));
  mergeQueue = run.catch(() => undefined);
  return run;
}

async function doMergeWindows(targetWindowId) {
  const current = targetWindowId ? await chrome.windows.get(targetWindowId) : await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  const others = windows.filter((window) => window.id !== current.id && window.incognito === current.incognito);
  if (!others.length) return { error: "Only one window open." };

  let moved = 0;
  for (const window of others) {
    const groupIds = [...new Set(window.tabs.map((tab) => tab.groupId).filter((id) => id !== -1))];
    for (const groupId of groupIds) {
      await chrome.tabGroups.move(groupId, { windowId: current.id, index: -1 });
    }
    const loose = window.tabs.filter((tab) => tab.groupId === -1);
    for (const tab of loose) {
      await chrome.tabs.move(tab.id, { windowId: current.id, index: -1 });
      // Moving a pinned tab between windows drops the pin; restore it.
      if (tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      moved++;
    }
    moved += window.tabs.length - loose.length;
  }
  await chrome.windows.update(current.id, { focused: true });
  return { done: true, windows: others.length, tabs: moved };
}

export async function windowCount() {
  const current = await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return { count: windows.filter((window) => window.incognito === current.incognito).length };
}
