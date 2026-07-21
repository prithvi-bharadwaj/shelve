// Service worker entry: wires messages and browser events to the feature
// modules in ./background/. Requires "type": "module" in the manifest.

import { migrateLegacyCredential } from "./background/settings.js";
import { listModels } from "./background/providers.js";
import { organize, applyPlan, ungroupAll } from "./background/organize.js";
import { getOrganizeStatus, consumeOrganizeResult } from "./background/jobs.js";
import { cleanDuplicates } from "./background/dedupe.js";
import { undo, hasUndo, purgeLegacyUndo, dropIncognitoUndo } from "./background/undo.js";
import { exportGroups, importGroups } from "./background/importexport.js";
import { listGroups, stashGroup, listStashes, resumeStash, deleteStash } from "./background/stash.js";
import { runCommand, focusTab } from "./background/command.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    organize: () => organize(msg.hasContentPermission, msg.windowId),
    organizeStatus: () => getOrganizeStatus(msg.windowId),
    consumeOrganizeResult: () => consumeOrganizeResult(msg.windowId, msg.jobId),
    applyPlan: () => applyPlan(msg.groups, msg.minSize || 1, { windowId: msg.windowId, snapshot: true }),
    ungroupAll: () => ungroupAll(msg.windowId),
    cleanDuplicates: () => cleanDuplicates(msg.windowId, { snapshot: true }),
    undo: () => undo(msg.windowId),
    hasUndo: () => hasUndo(msg.windowId),
    listModels: () => listModels(msg.provider),
    migrateLegacyCredential: () => migrateLegacyCredential().then(() => ({ done: true })),
    exportGroups: () => exportGroups(msg.windowId),
    importGroups: () => importGroups(msg.payload, msg.windowId),
    listGroups: () => listGroups(msg.windowId),
    stashGroup: () => stashGroup(msg.windowId, msg.groupId),
    listStashes: () => listStashes(msg.windowId),
    resumeStash: () => resumeStash(msg.stashId, msg.windowId),
    deleteStash: () => deleteStash(msg.stashId),
    command: () => runCommand(msg.query, msg.windowId, msg.hasContentPermission),
    focusTab: () => focusTab(msg.tabId)
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || "Something went wrong." }));
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  dropIncognitoUndo(windowId);
});
// Clean up settings persisted by the removed merge and tab-monitor features.
chrome.runtime.onInstalled.addListener(() => {
  Promise.all([
    chrome.storage.sync.remove(["mergeOnOrganize", "auto", "autoThreshold"]),
    chrome.storage.local.remove("monitorAlertedWindows"),
    migrateLegacyCredential()
  ]).catch(() => undefined);
});
purgeLegacyUndo().catch(() => undefined);

// The action has no default_popup: clicking it toggles the in-page overlay
// panel (rounded, glass) via activeTab. Pages we cannot script (chrome://,
// Web Store, other extensions) fall back to the browser's anchored popup.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggleOverlay" });
      return;
    } catch {
      // No overlay script in the tab yet — inject it (mounts on load).
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["overlay.js"] });
        return;
      } catch {
        // Restricted page; fall through to the anchored-popup fallback.
      }
    }
    // Pages we cannot script get the classic action popup, anchored to the
    // toolbar — never a separate window. setPopup persists per-tab, so later
    // clicks on this tab open the popup natively without hitting onClicked.
    try {
      await chrome.action.setPopup({ tabId: tab.id, popup: "popup.html" });
      await chrome.action.openPopup();
    } catch {
      // openPopup needs Chrome 127+; if unavailable the per-tab popup is
      // still set, so the next click opens it natively.
    }
  }
});

// The per-tab fallback popup must not outlive the restricted page that needed
// it: clear it when the tab navigates so scriptable pages get the overlay back.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.action.setPopup({ tabId, popup: "" }).catch(() => undefined);
  }
});
