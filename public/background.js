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
