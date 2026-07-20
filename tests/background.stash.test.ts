import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";
import type { ChromeMock, MockTab } from "./helpers/chromeMock";

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

function stashFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "stash-1",
    name: "Trip",
    color: "blue",
    createdAt: 1,
    tabs: [
      { id: 1, url: "https://a.test/", title: "A" },
      { id: 2, url: "https://b.test/", title: "B" },
    ],
    brief: "",
    briefStatus: "ready",
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
  return harness;
}

function storedStashes(mock: ChromeMock) {
  return (mock.localData.stashes ?? []) as Array<Record<string, any>>;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("incognito stash boundary", () => {
  it("returns no stash metadata to an incognito popup", async () => {
    const { invokeMessage } = await load((mock) => mock.seedLocal({ stashes: [stashFixture()] }));
    const response = await invokeMessage({ type: "listStashes", windowId: 11 });
    expect(response).toEqual({ stashes: [], unavailableInIncognito: true });
  });

  it("rejects incognito resume before claiming or opening anything", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 11 })) as { error?: string };
    expect(response.error).toMatch(/incognito/i);
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
    expect(storedStashes(mock)[0].resume).toBeUndefined();
  });
});

describe("resume claims", () => {
  it("lets only one of two concurrent resumes create tabs", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    const [first, second] = (await Promise.all([
      invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 }),
      invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 }),
    ])) as Array<{ done?: boolean; error?: string }>;
    const done = [first, second].filter((r) => r.done);
    const failed = [first, second].filter((r) => r.error);
    expect(done).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(mock.chrome.tabs.create).toHaveBeenCalledTimes(2);
  });

  it("blocks a duplicate resume from a persisted recent claim after reload", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedLocal({
        stashes: [stashFixture({ resume: { token: "old", startedAt: Date.now(), targetWindowId: 1, opened: [] } })],
      })
    );
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/already being resumed/);
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("reuses validated tabs from a stale claim instead of duplicating them", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedLocal({
        stashes: [
          stashFixture({
            resume: {
              token: "old",
              startedAt: 1,
              targetWindowId: 1,
              opened: [{ sourceIndex: 0, tabId: 5000, url: "https://a.test/" }],
            },
          }),
        ],
      })
    );
    tabs.set(5000, { id: 5000, windowId: 1, url: "https://a.test/", active: false, pinned: false, groupId: -1 });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as {
      done?: boolean;
      tabCount?: number;
    };
    expect(response.done).toBe(true);
    expect(response.tabCount).toBe(2);
    expect(mock.chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(mock.chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: "https://b.test/" }));
    const grouped = mock.chrome.tabs.group.mock.calls[0][0].tabIds as number[];
    expect(grouped).toContain(5000);
  });

  it("refuses a stale claim whose tabs live in another open window", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedLocal({
        stashes: [
          stashFixture({
            resume: {
              token: "old",
              startedAt: 1,
              targetWindowId: 2,
              opened: [{ sourceIndex: 0, tabId: 5000, url: "https://a.test/" }],
            },
          }),
        ],
      })
    );
    tabs.set(5000, { id: 5000, windowId: 2, url: "https://a.test/", active: false, pinned: false, groupId: -1 });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/another window/);
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
    expect(storedStashes(mock)).toHaveLength(1);
  });
});

describe("all-or-nothing resume", () => {
  it("deletes the stash exactly once after full success", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as {
      done?: boolean;
      tabCount?: number;
    };
    expect(response.done).toBe(true);
    expect(response.tabCount).toBe(2);
    expect(mock.chrome.tabs.group).toHaveBeenCalledTimes(1);
    // Title/color update plus the best-effort collapse call.
    expect(mock.chrome.tabGroups.update).toHaveBeenCalledTimes(2);
    expect(mock.chrome.tabGroups.update).toHaveBeenLastCalledWith(500, { collapsed: true });
    expect(storedStashes(mock)).toHaveLength(0);
  });

  it("rolls back created tabs and keeps the stash when one tab fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    const original = mock.chrome.tabs.create.getMockImplementation()!;
    let calls = 0;
    mock.chrome.tabs.create.mockImplementation(async (props) => {
      calls += 1;
      if (calls === 2) throw new Error("refused");
      return original(props);
    });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/stash was kept/);
    expect(tabs.size).toBe(0);
    const remaining = storedStashes(mock);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tabs).toHaveLength(2);
    expect(remaining[0].resume).toBeUndefined();
  });

  it("rolls back and keeps the stash when grouping fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    mock.chrome.tabs.group.mockImplementation(async () => {
      throw new Error("group failed");
    });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/stash was kept/);
    expect(tabs.size).toBe(0);
    expect(storedStashes(mock)).toHaveLength(1);
  });

  it("rolls back and keeps the stash when group metadata update fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    mock.chrome.tabGroups.update.mockImplementation(async () => {
      throw new Error("update failed");
    });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/stash was kept/);
    expect(tabs.size).toBe(0);
    expect(storedStashes(mock)).toHaveLength(1);
  });

  it("reports non-success and keeps recovery data when storage deletion fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ stashes: [stashFixture()] }));
    const originalSet = mock.chrome.storage.local.set.getMockImplementation()!;
    mock.chrome.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      if (Array.isArray(items.stashes) && items.stashes.length === 0) throw new Error("quota");
      return originalSet(items);
    });
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as {
      done?: boolean;
      error?: string;
    };
    expect(response.done).toBeUndefined();
    expect(response.error).toMatch(/remains saved/);
    const remaining = storedStashes(mock);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].resume.opened).toHaveLength(2);
  });

  it("rejects unsafe URLs without opening anything", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedLocal({
        stashes: [stashFixture({ tabs: [{ id: 1, url: "javascript:alert(1)", title: "evil" }] })],
      })
    );
    const response = (await invokeMessage({ type: "resumeStash", stashId: "stash-1", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/unsafe URL/);
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
    expect(storedStashes(mock)).toHaveLength(1);
  });
});

describe("stash creation window safety", () => {
  function installGroupFixture(mock: ChromeMock, options: { movedToWindow?: number; extraChromeTab?: boolean } = {}) {
    const finalWindow = options.movedToWindow ?? 1;
    const groupTabs = (windowId: number): MockTab[] => {
      const members: MockTab[] = [
        { id: 21, windowId, url: "https://a.test/", active: false, pinned: false, groupId: 7, index: 0, title: "A" },
      ];
      if (options.extraChromeTab) {
        members.push({ id: 22, windowId, url: "chrome://settings/", active: false, pinned: false, groupId: 7, index: 1, title: "Settings" });
      }
      return members;
    };
    mock.chrome.tabGroups.get
      .mockImplementationOnce(async () => ({ id: 7, windowId: 1, title: "Trip", color: "blue" }))
      .mockImplementation(async () => ({ id: 7, windowId: finalWindow, title: "Trip", color: "blue" }));
    mock.chrome.tabs.query.mockImplementation(async (query) => groupTabs(query?.windowId ?? 1));
  }

  it("creates the safety tab in the re-fetched window after the group moved", async () => {
    const { invokeMessage, mock } = await load((prepared) => installGroupFixture(prepared, { movedToWindow: 2 }));
    const response = (await invokeMessage({ type: "stashGroup", windowId: 1, groupId: 7 })) as { done?: boolean };
    expect(response.done).toBe(true);
    expect(mock.chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(mock.chrome.tabs.create.mock.calls[0][0].windowId).toBe(2);
    expect(mock.chrome.tabs.remove).toHaveBeenCalledWith([21]);
    expect(storedStashes(mock)[0].name).toBe("Trip");
  });

  it("creates no stash and closes nothing when the safety tab fails", async () => {
    const { invokeMessage, mock } = await load((prepared) => {
      installGroupFixture(prepared, { movedToWindow: 2 });
      prepared.chrome.tabs.create.mockImplementation(async () => {
        throw new Error("cannot create");
      });
    });
    const response = (await invokeMessage({ type: "stashGroup", windowId: 1, groupId: 7 })) as { error?: string };
    expect(response.error).toMatch(/nothing was stashed/);
    expect(storedStashes(mock)).toHaveLength(0);
    expect(mock.chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it("neither stores nor closes non-HTTP(S) group members", async () => {
    const { invokeMessage, mock } = await load((prepared) => installGroupFixture(prepared, { extraChromeTab: true }));
    const response = (await invokeMessage({ type: "stashGroup", windowId: 1, groupId: 7 })) as { done?: boolean };
    expect(response.done).toBe(true);
    const stored = storedStashes(mock)[0];
    expect(stored.tabs).toEqual([{ id: 21, url: "https://a.test/", title: "A" }]);
    expect(mock.chrome.tabs.remove).toHaveBeenCalledWith([21]);
  });
});
