import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness, type UndoSnapshot } from "./helpers/backgroundHarness";
import type { ChromeMock, MockTab } from "./helpers/chromeMock";

const UNDO_KEY = "undoSnapshot:v2:1";

const WINDOWS: Record<number, { id: number; incognito: boolean; type: string; focused: boolean }> = {
  1: { id: 1, incognito: false, type: "normal", focused: true },
  2: { id: 2, incognito: false, type: "normal", focused: false },
  11: { id: 11, incognito: true, type: "normal", focused: false },
};

function installFixtures(mock: ChromeMock) {
  mock.chrome.windows.get.mockImplementation(async (windowId: number) => {
    const found = WINDOWS[windowId];
    if (!found) throw new Error(`No window with id: ${windowId}.`);
    return { ...found };
  });
  const tabs = new Map<number, MockTab>();
  let nextId = 1000;
  mock.chrome.tabs.create.mockImplementation(async (props) => {
    const tab: MockTab = {
      id: nextId++,
      windowId: props.windowId ?? 1,
      url: props.url ?? "chrome://newtab/",
      active: props.active ?? false,
      pinned: false,
      groupId: -1,
      index: tabs.size,
    };
    tabs.set(tab.id, tab);
    return tab;
  });
  mock.chrome.tabs.get.mockImplementation(async (tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  });
  mock.chrome.tabs.remove.mockImplementation(async (tabIds) => {
    for (const id of Array.isArray(tabIds) ? tabIds : [tabIds]) tabs.delete(id);
  });
  return tabs;
}

function snapFixture(overrides: Partial<UndoSnapshot> = {}): UndoSnapshot {
  return {
    version: 2,
    windowId: 1,
    incognito: false,
    tabs: [
      { id: 101, url: "https://a.test/", index: 0, pinned: false, groupId: 5 },
      { id: 103, url: "https://c.test/", index: 1, pinned: false, groupId: -1 },
    ],
    groups: [{ id: 5, title: "Work", color: "blue", collapsed: true }],
    closedTabs: [{ originalId: 103, url: "https://c.test/", reopenedId: null }],
    ...overrides,
  };
}

let harness: BackgroundHarness | null = null;
let tabs: Map<number, MockTab>;

async function load(prepare?: (mock: ChromeMock) => void) {
  harness = await loadBackground((mock) => {
    tabs = installFixtures(mock);
    prepare?.(mock);
  });
  // The surviving grouped tab from the fixture snapshot.
  tabs.set(101, { id: 101, windowId: 1, url: "https://a.test/", active: false, pinned: false, groupId: 5, index: 0 });
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("duplicate identity keeps fragments", () => {
  it("treats identical full URLs as duplicates and fragment routes as distinct", async () => {
    const { exports } = await load();
    const normalize = exports.normalizedDuplicateUrl;
    expect(normalize("https://app.test/page")).toBe(normalize("https://app.test/page"));
    expect(normalize("https://app.test/#/document/1")).not.toBe(normalize("https://app.test/#/document/2"));
    expect(normalize("https://app.test/page#section-a")).not.toBe(normalize("https://app.test/page#section-b"));
    expect(normalize("not a url")).toBeNull();
    expect(normalize("")).toBeNull();
  });

  it("still protects pinned and active copies and journals closed tabs", async () => {
    const { invokeMessage, mock } = await load();
    const url = "https://same.test/page";
    mock.chrome.tabs.query.mockResolvedValue([
      { id: 41, windowId: 1, url, active: false, pinned: true, groupId: -1, index: 0 },
      { id: 42, windowId: 1, url, active: true, pinned: false, groupId: -1, index: 1 },
      { id: 43, windowId: 1, url, title: "Old copy", active: false, pinned: false, groupId: -1, index: 2 },
      { id: 44, windowId: 1, url, title: "Older copy", active: false, pinned: false, groupId: -1, index: 3 },
    ]);
    const response = (await invokeMessage({ type: "cleanDuplicates", windowId: 1 })) as {
      closedCount?: number;
      closedTabs?: Array<{ title: string; url: string; keptTabId?: number }>;
    };
    expect(response.closedCount).toBe(2);
    // The active tab (42) wins over the pinned one (41) as the surviving target.
    expect(response.closedTabs).toEqual([
      { title: "Old copy", url, keptTabId: 42 },
      { title: "Older copy", url, keptTabId: 42 },
    ]);
    expect(mock.chrome.tabs.remove).toHaveBeenCalledWith([43, 44]);
    const stored = mock.sessionData[UNDO_KEY] as UndoSnapshot;
    expect(stored.closedTabs).toEqual([
      { originalId: 43, url, reopenedId: null },
      { originalId: 44, url, reopenedId: null },
    ]);
  });
});

describe("snapshot compatibility", () => {
  it("normalizes v2 parallel closed arrays into closedTabs", async () => {
    const { exports } = await load((mock) =>
      mock.seedSession({
        [UNDO_KEY]: {
          ...snapFixture(),
          closedTabs: undefined,
          closedUrls: ["https://c.test/"],
          closedTabIds: [103],
        },
      })
    );
    const snapshot = await exports.getUndoSnapshot(1);
    expect(snapshot?.closedTabs).toEqual([{ originalId: 103, url: "https://c.test/", reopenedId: null }]);
    expect(snapshot).not.toHaveProperty("closedUrls");
    expect(snapshot).not.toHaveProperty("closedTabIds");
  });

  it("rejects and removes an unversioned snapshot", async () => {
    const { exports, mock } = await load((prepared) =>
      prepared.seedSession({ [UNDO_KEY]: { windowId: 1, incognito: false, tabs: [] } })
    );
    expect(await exports.getUndoSnapshot(1)).toBeNull();
    expect(mock.sessionData[UNDO_KEY]).toBeUndefined();
  });

  it("keeps incognito undo memory-only through reopen checkpoints", async () => {
    const { exports, invokeMessage, mock } = await load();
    tabs.set(201, { id: 201, windowId: 11, url: "https://p.test/", active: false, pinned: false, groupId: -1, index: 0 });
    await exports.storeUndoSnapshot(
      snapFixture({
        windowId: 11,
        incognito: true,
        tabs: [
          { id: 201, url: "https://p.test/", index: 0, pinned: false, groupId: -1 },
          { id: 203, url: "https://q.test/", index: 1, pinned: false, groupId: -1 },
        ],
        groups: [],
        closedTabs: [{ originalId: 203, url: "https://q.test/", reopenedId: null }],
      })
    );
    const response = (await invokeMessage({ type: "undo", windowId: 11 })) as { done?: boolean };
    expect(response.done).toBe(true);
    expect(mock.chrome.storage.session.set).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.localData)).not.toContain("q.test");
  });
});

describe("retryable undo", () => {
  it("clears the snapshot only after complete success", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedSession({ [UNDO_KEY]: snapFixture() }));
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as {
      done?: boolean;
      tabCount?: number;
      reopenedCount?: number;
      skippedCount?: number;
    };
    expect(response).toEqual({ done: true, tabCount: 2, reopenedCount: 1, skippedCount: 0 });
    expect(mock.chrome.tabGroups.update).toHaveBeenCalledWith(
      expect.any(Number),
      { title: "Work", color: "blue", collapsed: true }
    );
    expect(mock.sessionData[UNDO_KEY]).toBeUndefined();
  });

  it("keeps the snapshot and reports partial when a URL fails to reopen, then retry reuses the checkpoint", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedSession({
        [UNDO_KEY]: snapFixture({
          tabs: [
            { id: 101, url: "https://a.test/", index: 0, pinned: false, groupId: 5 },
            { id: 103, url: "https://c.test/", index: 1, pinned: false, groupId: -1 },
            { id: 104, url: "https://d.test/", index: 2, pinned: false, groupId: -1 },
          ],
          closedTabs: [
            { originalId: 103, url: "https://c.test/", reopenedId: null },
            { originalId: 104, url: "https://d.test/", reopenedId: null },
          ],
        }),
      })
    );
    const original = mock.chrome.tabs.create.getMockImplementation()!;
    let failDTest = true;
    mock.chrome.tabs.create.mockImplementation(async (props) => {
      if (failDTest && props.url === "https://d.test/") throw new Error("refused");
      return original(props);
    });

    const first = (await invokeMessage({ type: "undo", windowId: 1 })) as { partial?: boolean; error?: string };
    expect(first.partial).toBe(true);
    expect(first.error).toMatch(/Retry Undo/);
    const stored = mock.sessionData[UNDO_KEY] as UndoSnapshot;
    expect(stored).toBeDefined();
    expect(stored.closedTabs?.[0].reopenedId).toEqual(expect.any(Number));
    expect(stored.closedTabs?.[1].reopenedId).toBeNull();

    failDTest = false;
    const createCallsBeforeRetry = mock.chrome.tabs.create.mock.calls.length;
    const second = (await invokeMessage({ type: "undo", windowId: 1 })) as { done?: boolean; reopenedCount?: number };
    expect(second.done).toBe(true);
    expect(second.reopenedCount).toBe(2);
    expect(mock.chrome.tabs.create.mock.calls.length - createCallsBeforeRetry).toBe(1);
    expect(mock.sessionData[UNDO_KEY]).toBeUndefined();
  });

  it("retains the snapshot when group recreation fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedSession({ [UNDO_KEY]: snapFixture() }));
    mock.chrome.tabs.group.mockImplementation(async () => {
      throw new Error("group failed");
    });
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as { partial?: boolean };
    expect(response.partial).toBe(true);
    expect(mock.sessionData[UNDO_KEY]).toBeDefined();
  });

  it("retains the snapshot when a move fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedSession({ [UNDO_KEY]: snapFixture() }));
    mock.chrome.tabs.move.mockImplementation(async () => {
      throw new Error("move failed");
    });
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as { partial?: boolean };
    expect(response.partial).toBe(true);
    expect(mock.sessionData[UNDO_KEY]).toBeDefined();
  });

  it("counts a user-closed tab without a journal entry as skipped, not retryable", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedSession({
        [UNDO_KEY]: snapFixture({
          tabs: [
            { id: 101, url: "https://a.test/", index: 0, pinned: false, groupId: 5 },
            { id: 103, url: "https://c.test/", index: 1, pinned: false, groupId: -1 },
            { id: 105, url: "https://gone.test/", index: 2, pinned: false, groupId: -1 },
          ],
        }),
      })
    );
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as {
      done?: boolean;
      skippedCount?: number;
    };
    expect(response.done).toBe(true);
    expect(response.skippedCount).toBe(1);
    expect(mock.sessionData[UNDO_KEY]).toBeUndefined();
  });

  it("closes the just-created tab and keeps recovery state when a checkpoint cannot persist", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedSession({ [UNDO_KEY]: snapFixture() }));
    mock.chrome.storage.session.set.mockImplementation(async () => {
      throw new Error("session quota");
    });
    mock.chrome.storage.local.set.mockImplementation(async () => {
      throw new Error("local quota");
    });
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as { partial?: boolean };
    expect(response.partial).toBe(true);
    expect([...tabs.values()].some((tab) => tab.url === "https://c.test/")).toBe(false);
    const stored = mock.sessionData[UNDO_KEY] as UndoSnapshot;
    expect(stored.closedTabs?.[0].reopenedId).toBeNull();
  });

  it("does not reuse a journaled tab that navigated away", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedSession({
        [UNDO_KEY]: snapFixture({
          closedTabs: [{ originalId: 103, url: "https://c.test/", reopenedId: 900 }],
        }),
      })
    );
    tabs.set(900, { id: 900, windowId: 1, url: "https://elsewhere.test/", active: false, pinned: false, groupId: -1, index: 3 });
    const response = (await invokeMessage({ type: "undo", windowId: 1 })) as { done?: boolean };
    expect(response.done).toBe(true);
    expect(mock.chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://c.test/" })
    );
    expect(tabs.has(900)).toBe(true);
  });

  it("does not let another window consume a partial snapshot", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedSession({ [UNDO_KEY]: snapFixture() }));
    const response = (await invokeMessage({ type: "undo", windowId: 2 })) as { error?: string };
    expect(response.error).toBe("Nothing to undo.");
    expect(mock.sessionData[UNDO_KEY]).toBeDefined();
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });
});
