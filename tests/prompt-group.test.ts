import { afterEach, expect, test, vi } from "vitest";
import type { CommandResponse } from "@/types";

// Exercises the command-bar mutations against a fixture tab strip. The worker
// modules are imported fresh per harness so provider overrides and chrome
// globals never leak between tests.

interface MockTab {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  groupId: number;
  pinned: boolean;
  incognito: boolean;
  active?: boolean;
}

interface HarnessCalls {
  grouped: Array<{ tabIds: number[]; groupId: number | null }>;
  ungrouped: number[][];
  removed: number[][];
  updated: Array<{ id: number; changes: Record<string, unknown> }>;
  session: unknown[];
}

async function makeHarness(providerResult: Record<string, unknown>) {
  const calls: HarnessCalls = { grouped: [], ungrouped: [], removed: [], updated: [], session: [] };
  const tabs: MockTab[] = [
    { id: 1, windowId: 10, index: 0, title: "O-1 membership directory", url: "https://example.com/directory", groupId: -1, pinned: false, incognito: false },
    { id: 2, windowId: 10, index: 1, title: "Professional association", url: "https://example.com/association", groupId: -1, pinned: false, incognito: false },
    { id: 3, windowId: 10, index: 2, title: "Pinned membership", url: "https://example.com/pinned", groupId: -1, pinned: true, incognito: false },
    { id: 4, windowId: 10, index: 3, title: "Grouped membership", url: "https://example.com/grouped", groupId: 77, pinned: false, incognito: false },
    { id: 5, windowId: 10, index: 4, title: "Unrelated tab", url: "https://example.com/other", groupId: -1, pinned: false, incognito: false },
    { id: 6, windowId: 20, index: 0, title: "Other-window membership", url: "https://example.com/other-window", groupId: -1, pinned: false, incognito: false },
    { id: 7, windowId: 10, index: 5, title: "AI video tools", url: "https://example.com/ai-video", groupId: 77, pinned: false, incognito: false },
    { id: 8, windowId: 10, index: 6, title: "Fellowship application", url: "https://example.com/fellowship", groupId: 88, pinned: false, incognito: false },
    { id: 9, windowId: 10, index: 7, title: "Professional membership", url: "https://example.com/membership", groupId: 89, pinned: false, incognito: false },
  ];
  const groups = [
    { id: 77, windowId: 10, title: "AI Development", color: "red" },
    { id: 88, windowId: 10, title: "Fellowships", color: "blue" },
    { id: 89, windowId: 10, title: "Memberships", color: "green" },
  ];

  const chrome = {
    runtime: {
      getPlatformInfo: async () => ({}),
    },
    tabs: {
      // Chrome returns fresh snapshots per query, so copy — later mutations must not leak into old results.
      query: async (query: { windowType?: string; windowId?: number }) => (query.windowType === "normal"
        ? tabs
        : tabs.filter((tab) => tab.windowId === query.windowId)
      ).map((tab) => ({ ...tab })),
      group: async ({ tabIds, groupId }: { tabIds: number[] | number; groupId?: number }) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        const destination = groupId ?? 101;
        calls.grouped.push({ tabIds: ids, groupId: groupId ?? null });
        for (const id of ids) tabs.find((tab) => tab.id === id)!.groupId = destination;
        return destination;
      },
      ungroup: async (tabIds: number[] | number) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        calls.ungrouped.push(ids);
        for (const id of ids) tabs.find((tab) => tab.id === id)!.groupId = -1;
      },
      remove: async (tabIds: number[] | number) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        calls.removed.push(ids);
        for (const id of ids) {
          const index = tabs.findIndex((tab) => tab.id === id);
          if (index !== -1) tabs.splice(index, 1);
        }
      },
    },
    tabGroups: {
      query: async (query: { windowId?: number }) =>
        groups.filter((group) => !query.windowId || group.windowId === query.windowId).map((group) => ({ ...group })),
      update: async (id: number, changes: Record<string, unknown>) => calls.updated.push({ id, changes }),
    },
    windows: {
      get: async (id: number) => ({ id, incognito: false }),
      getCurrent: async () => ({ id: 10, incognito: false }),
    },
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, provider: "gemini" }),
        set: async () => {},
      },
      local: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, geminiKey: "test-key", dataNoticeAck: true }),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async (value: unknown) => calls.session.push(value),
        remove: async () => {},
      },
    },
  };

  vi.resetModules();
  vi.stubGlobal("chrome", chrome);
  vi.stubGlobal("fetch", async () => { throw new Error("Unexpected network request"); });
  vi.stubGlobal("setTimeout", () => 1);
  vi.stubGlobal("clearTimeout", () => {});
  vi.stubGlobal("setInterval", () => 1);
  vi.stubGlobal("clearInterval", () => {});

  const [commandModule, providersModule] = await Promise.all([
    import("../public/background/command.js"),
    import("../public/background/providers.js"),
  ]);
  providersModule.PROVIDERS.gemini.classify = async () => ({ json: providerResult, usage: { input: 0, output: 0 } });

  return {
    calls,
    tabs,
    groups,
    providers: providersModule.PROVIDERS,
    runCommand: (query: string) => commandModule.runCommand(query, 10, false) as Promise<CommandResponse>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a prompted group can regroup loose and already-grouped tabs from the current window", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2, 3, 4, 6, 999],
    groupIds: [],
    allGroups: false,
    groupName: "O-1 Visa",
    color: "blue",
    needsContent: [],
  });

  const result = await runCommand("group my O-1 visa memberships");

  expect({ ...result }).toEqual({
    done: true,
    action: "create_group",
    groupId: 101,
    groupName: "O-1 Visa",
    tabCount: 3,
  });
  expect(calls.grouped).toEqual([{ tabIds: [1, 2, 4], groupId: null }]);
  expect(calls.updated).toEqual([
    { id: 101, changes: { title: "O-1 Visa", color: "blue" } },
    { id: 101, changes: { collapsed: true } },
  ]);
  expect(tabs.find((tab) => tab.id === 3)!.groupId, "pinned tab remains untouched").toBe(-1);
  expect(tabs.find((tab) => tab.id === 4)!.groupId, "matching grouped tab moves to the new group").toBe(101);
  expect(tabs.find((tab) => tab.id === 5)!.groupId, "unrelated loose tab remains untouched").toBe(-1);
  expect(tabs.find((tab) => tab.id === 6)!.groupId, "other window remains untouched").toBe(-1);
  expect(calls.session, "the mutation stores one undo snapshot").toHaveLength(1);
});

test("a tab that navigates while the model is thinking is left out of the group", async () => {
  const harness = await makeHarness({
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2],
    groupIds: [],
    allGroups: false,
    groupName: "O-1 Visa",
    color: "blue",
    needsContent: [],
  });
  const providerResult = {
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2],
    groupIds: [],
    allGroups: false,
    groupName: "O-1 Visa",
    color: "blue",
    needsContent: [],
  };
  harness.providers.gemini.classify = async () => {
    harness.tabs.find((tab) => tab.id === 2)!.url = "https://example.com/navigated-away";
    return { json: providerResult, usage: { input: 0, output: 0 } };
  };

  const result = await harness.runCommand("group my O-1 visa memberships");

  expect(result.action).toBe("create_group");
  expect(result.tabCount).toBe(1);
  expect(harness.calls.grouped).toEqual([{ tabIds: [1], groupId: null }]);
  expect(harness.tabs.find((tab) => tab.id === 2)!.groupId, "navigated tab remains untouched").toBe(-1);
});

test("a prompt with no eligible matches leaves every tab untouched", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [3, 6, 999],
    groupIds: [],
    allGroups: false,
    groupName: "O-1 Visa",
    color: "blue",
    needsContent: [],
  });
  const before = tabs.map(({ id, groupId }) => ({ id, groupId }));

  const result = await runCommand("group my O-1 visa memberships");

  expect(result.action).toBe("not_found");
  expect(result.reply).toMatch(/matching tabs/i);
  expect(calls.grouped).toEqual([]);
  expect(calls.session).toEqual([]);
  expect(tabs.map(({ id, groupId }) => ({ id, groupId }))).toEqual(before);
});

test("a command can ungroup one named group without touching the others", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "ungroup",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [77],
    allGroups: false,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("ungroup AI Development");

  expect(result.action).toBe("ungroup");
  expect(result.groupCount).toBe(1);
  expect(result.tabCount).toBe(2);
  expect(calls.ungrouped).toEqual([[4, 7]]);
  expect(tabs.find((tab) => tab.id === 8)!.groupId).toBe(88);
  expect(calls.session).toHaveLength(1);
});

test("an explicit all-groups command ungroups every group in the current window", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "ungroup",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [],
    allGroups: true,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("ungroup all");

  expect(result.groupCount).toBe(3);
  expect(result.tabCount).toBe(4);
  expect(calls.ungrouped).toEqual([[4, 7, 8, 9]]);
});

test("a command can remove duplicate tabs and report the closed copy", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "remove_duplicates",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [],
    allGroups: false,
    groupName: "",
    color: "grey",
    needsContent: [],
  });
  tabs.push(
    { id: 10, windowId: 10, index: 8, title: "Active copy", url: "https://duplicate.test/", groupId: -1, pinned: false, active: true, incognito: false },
    { id: 11, windowId: 10, index: 9, title: "Old copy", url: "https://duplicate.test/", groupId: -1, pinned: false, active: false, incognito: false }
  );

  const result = await runCommand("remove duplicates");

  expect(result.action).toBe("remove_duplicates");
  expect(result.closedCount).toBe(1);
  expect(result.closedTabs).toEqual([
    { title: "Old copy", url: "https://duplicate.test/", keptTabId: 10 },
  ]);
  expect(calls.removed).toEqual([[11]]);
});

test("a command can merge multiple related groups into the first selected group", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "merge_groups",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [88, 89],
    allGroups: false,
    groupName: "Career",
    color: "purple",
    needsContent: [],
  });

  const result = await runCommand("merge my fellowships and memberships groups");

  expect(result.action).toBe("merge_groups");
  expect(result.groupId).toBe(88);
  expect(result.groupCount).toBe(2);
  expect(result.tabCount).toBe(2);
  expect(calls.grouped).toEqual([{ tabIds: [9], groupId: 88 }]);
  expect(calls.updated).toEqual([
    { id: 88, changes: { title: "Career", color: "purple" } },
    { id: 88, changes: { collapsed: true } },
  ]);
  expect(tabs.find((tab) => tab.id === 8)!.groupId).toBe(88);
  expect(tabs.find((tab) => tab.id === 9)!.groupId).toBe(88);
  expect(calls.session).toHaveLength(1);
});

test("a command can move loose and regrouped tabs into an existing group", async () => {
  const { calls, tabs, runCommand } = await makeHarness({
    action: "add_to_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2, 4, 3, 999],
    groupIds: [88],
    allGroups: false,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("move my membership tabs into Fellowships");

  expect(result.action).toBe("add_to_group");
  expect(result.groupId).toBe(88);
  expect(result.groupName).toBe("Fellowships");
  expect(result.tabCount).toBe(3);
  expect(calls.grouped).toEqual([{ tabIds: [1, 2, 4], groupId: 88 }]);
  expect(tabs.find((tab) => tab.id === 4)!.groupId).toBe(88);
  expect(tabs.find((tab) => tab.id === 3)!.groupId, "pinned tab remains untouched").toBe(-1);
  expect(calls.session, "the mutation stores one undo snapshot").toHaveLength(1);
});

test("moving tabs is rejected without an explicit move/add request", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "add_to_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2],
    groupIds: [88],
    allGroups: false,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("memberships belong with fellowships maybe?");

  expect(result.error).toMatch(/Explicitly ask to move or add/i);
  expect(calls.grouped).toEqual([]);
  expect(calls.session).toEqual([]);
});

test("a command can rename and recolor an existing group", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "update_group",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [77],
    allGroups: false,
    groupName: "ML Research",
    color: "purple",
    needsContent: [],
  });

  const result = await runCommand("rename AI Development to ML Research and make it purple");

  expect(result.action).toBe("update_group");
  expect(result.groupId).toBe(77);
  expect(result.groupName).toBe("ML Research");
  expect(result.previousName).toBe("AI Development");
  expect(calls.updated).toEqual([
    { id: 77, changes: { title: "ML Research", color: "purple" } },
  ]);
  expect(calls.session, "the mutation stores one undo snapshot").toHaveLength(1);
});

test("a recolor-only command keeps the current group name", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "update_group",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [89],
    allGroups: false,
    groupName: "",
    color: "yellow",
    needsContent: [],
  });

  const result = await runCommand("color the memberships group yellow");

  expect(result.action).toBe("update_group");
  expect(result.groupName).toBe("Memberships");
  expect(calls.updated).toEqual([
    { id: 89, changes: { title: "Memberships", color: "yellow" } },
  ]);
});

test("a group update is rejected without explicit rename/recolor wording", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "update_group",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [77],
    allGroups: false,
    groupName: "ML",
    color: "red",
    needsContent: [],
  });

  const result = await runCommand("that first group looks wrong");

  expect(result.error).toMatch(/Explicitly ask to rename or recolor/i);
  expect(calls.updated).toEqual([]);
  expect(calls.session).toEqual([]);
});

test("an ambiguous multi-group destination is rejected instead of picking one arbitrarily", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "add_to_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2],
    groupIds: [88, 89],
    allGroups: false,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("move my membership tabs into a fitting group");

  expect(result.error).toMatch(/single group/i);
  expect(calls.grouped).toEqual([]);
  expect(calls.session).toEqual([]);
});

test("a recolor-only update on an untitled group keeps the title empty", async () => {
  const { calls, groups, runCommand } = await makeHarness({
    action: "update_group",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [90],
    allGroups: false,
    groupName: "",
    color: "yellow",
    needsContent: [],
  });
  groups.push({ id: 90, windowId: 10, title: "", color: "grey" });

  const result = await runCommand("color the last group yellow");

  expect(result.action).toBe("update_group");
  expect(result.groupName).toBe("Untitled");
  expect(calls.updated).toEqual([
    { id: 90, changes: { title: "", color: "yellow" } },
  ]);
});

test("a rename-only update preserves a color changed while the model was thinking", async () => {
  const harness = await makeHarness({
    action: "update_group",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [77],
    allGroups: false,
    groupName: "ML Research",
    // The model echoes the color it was shown for group 77 ("red").
    color: "red",
    needsContent: [],
  });
  harness.providers.gemini.classify = async () => {
    // The user manually recolors the group mid-request.
    harness.groups.find((group) => group.id === 77)!.color = "cyan";
    return {
      json: {
        action: "update_group",
        tabId: null,
        reply: "",
        tabIds: [],
        groupIds: [77],
        allGroups: false,
        groupName: "ML Research",
        color: "red",
        needsContent: [],
      },
      usage: { input: 0, output: 0 },
    };
  };

  const result = await harness.runCommand("rename AI Development to ML Research");

  expect(result.action).toBe("update_group");
  expect(harness.calls.updated).toEqual([
    { id: 77, changes: { title: "ML Research", color: "cyan" } },
  ]);
});

test("a model-selected broad mutation is rejected unless the user explicitly requested it", async () => {
  const { calls, runCommand } = await makeHarness({
    action: "ungroup",
    tabId: null,
    reply: "",
    tabIds: [],
    groupIds: [],
    allGroups: true,
    groupName: "",
    color: "grey",
    needsContent: [],
  });

  const result = await runCommand("open my group notes");

  expect(result.error).toMatch(/Explicitly ask to ungroup/i);
  expect(calls.ungrouped).toEqual([]);
  expect(calls.session).toEqual([]);
});
