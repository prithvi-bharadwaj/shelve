import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";

let harness: BackgroundHarness | null = null;

async function load() {
  harness = await loadBackground();
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("background worker baseline", () => {
  it("registers exactly one runtime message listener", async () => {
    const { mock } = await load();
    expect(mock.events.runtimeOnMessage.listeners).toHaveLength(1);
  });

  it("returns false synchronously for an unknown message type", async () => {
    const { messageListener } = await load();
    const result = messageListener({ type: "definitely-not-a-handler" }, {}, () => {});
    expect(result).toBe(false);
  });

  it("safeImportUrl accepts HTTPS URLs", async () => {
    const { exports } = await load();
    expect(exports.safeImportUrl("https://example.com/page")).toBe(true);
  });

  it("safeImportUrl rejects javascript: and data: URLs", async () => {
    const { exports } = await load();
    expect(exports.safeImportUrl("javascript:alert(1)")).toBe(false);
    expect(exports.safeImportUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("sanitizePlan drops unknown tab ids and assigns a tab to at most one group", async () => {
    const { exports } = await load();
    const plan = {
      groups: [
        { name: "Research", color: "blue", tabIds: [1, 2, 999], existingGroupId: null, importance: 2 },
        { name: "Shopping", color: "red", tabIds: [2, 3], existingGroupId: null, importance: 4 },
      ],
      needsContent: [],
    };
    const groups = exports.sanitizePlan(plan, new Set([1, 2, 3, 4]), new Map(), 2);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Research");
    expect(groups[0].tabIds).toEqual([1, 2]);
    const allIds = groups.flatMap((group) => group.tabIds);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("answers a read-only message through sendResponse with a serializable object", async () => {
    const { invokeMessage } = await load();
    const response = await invokeMessage({ type: "hasUndo" });
    expect(response).toEqual({ hasUndo: false });
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });

  it("collapses a newly organized group after all of its tabs are filed", async () => {
    const { invokeMessage, mock } = await load();
    const tab = {
      id: 21,
      windowId: 1,
      url: "https://docs.test/one",
      title: "One",
      active: false,
      pinned: false,
      groupId: -1,
      index: 0,
    };
    mock.chrome.tabs.query.mockImplementation(async () => [tab]);
    mock.chrome.tabs.group.mockImplementation(async () => {
      tab.groupId = 500;
      return 500;
    });

    const response = await invokeMessage({
      type: "applyPlan",
      windowId: 1,
      minSize: 1,
      groups: [{ name: "Docs", color: "blue", tabIds: [21], existingGroupId: null }],
    });

    expect(response).toEqual(expect.objectContaining({ done: true, groupCount: 1, tabCount: 1 }));
    expect(mock.chrome.tabGroups.update).toHaveBeenNthCalledWith(1, 500, { title: "Docs", color: "blue" });
    expect(mock.chrome.tabGroups.update).toHaveBeenNthCalledWith(2, 500, { collapsed: true });
  });
});
