// Export the window's groups as JSON and import them back as fresh tabs.

import { GROUP_COLORS } from "./constants.js";
import { firstGroupIndex, safeImportUrl } from "./util.js";

export async function exportGroups(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: targetWindowId }),
    chrome.tabGroups.query({ windowId: targetWindowId })
  ]);
  const groupOrder = [...groups].sort((a, b) => firstGroupIndex(tabs, a.id) - firstGroupIndex(tabs, b.id));
  return {
    version: 1,
    groups: groupOrder.map((group) => ({
      name: group.title || "Tabs",
      color: group.color,
      urls: tabs.filter((tab) => tab.groupId === group.id && tab.url).sort((a, b) => a.index - b.index).map((tab) => tab.url)
    }))
  };
}

export async function importGroups(payload, windowId) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!data || data.version !== 1 || !Array.isArray(data.groups)) {
    return { error: "Invalid Focused JSON." };
  }
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  let groupCount = 0;
  let tabCount = 0;
  for (const group of data.groups) {
    if (!group || !Array.isArray(group.urls)) continue;
    const tabIds = [];
    for (const value of group.urls) {
      if (!safeImportUrl(value)) continue;
      try {
        const tab = await chrome.tabs.create({ windowId: targetWindowId, url: value, active: false });
        tabIds.push(tab.id);
      } catch {
        // Skip URLs the browser refuses to open.
      }
    }
    if (!tabIds.length) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: String(group.name || "Tabs").slice(0, 80),
      color: GROUP_COLORS.includes(group.color) ? group.color : "grey"
    });
    await chrome.tabGroups.update(groupId, { collapsed: true }).catch(() => undefined);
    groupCount++;
    tabCount += tabIds.length;
  }
  return { done: true, groupCount, tabCount };
}
