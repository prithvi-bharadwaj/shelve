import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");

function eventStub() {
  return { addListener() {} };
}

function makeHarness(providerResult) {
  const calls = { grouped: [], ungrouped: [], removed: [], updated: [], session: [] };
  const tabs = [
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
      onMessage: eventStub(),
      onInstalled: eventStub(),
      onStartup: eventStub(),
      getPlatformInfo: async () => ({}),
      getURL: (path) => path,
    },
    notifications: {
      onClicked: eventStub(),
      onButtonClicked: eventStub(),
      clear: async () => true,
      create: async () => "notification",
    },
    tabs: {
      onCreated: eventStub(),
      onRemoved: eventStub(),
      onUpdated: eventStub(),
      // Chrome returns fresh snapshots per query, so copy — later mutations must not leak into old results.
      query: async (query) => (query.windowType === "normal"
        ? tabs
        : tabs.filter((tab) => tab.windowId === query.windowId)
      ).map((tab) => ({ ...tab })),
      group: async ({ tabIds, groupId }) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        const destination = groupId ?? 101;
        calls.grouped.push({ tabIds: ids, groupId: groupId ?? null });
        for (const id of ids) tabs.find((tab) => tab.id === id).groupId = destination;
        return destination;
      },
      ungroup: async (tabIds) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        calls.ungrouped.push(ids);
        for (const id of ids) tabs.find((tab) => tab.id === id).groupId = -1;
      },
      remove: async (tabIds) => {
        const ids = Array.isArray(tabIds) ? [...tabIds] : [tabIds];
        calls.removed.push(ids);
        for (const id of ids) {
          const index = tabs.findIndex((tab) => tab.id === id);
          if (index !== -1) tabs.splice(index, 1);
        }
      },
    },
    tabGroups: {
      query: async (query) => groups.filter((group) => !query.windowId || group.windowId === query.windowId),
      update: async (id, changes) => calls.updated.push({ id, changes }),
    },
    windows: {
      onRemoved: eventStub(),
      get: async (id) => ({ id, incognito: false }),
      getCurrent: async () => ({ id: 10, incognito: false }),
    },
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, provider: "gemini" }),
        set: async () => {},
      },
      local: {
        get: async (defaults) => ({ ...defaults, geminiKey: "test-key", dataNoticeAck: true }),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async (value) => calls.session.push(value),
        remove: async () => {},
      },
      onChanged: eventStub(),
    },
    action: { setBadgeText: async () => {} },
  };

  const context = vm.createContext({
    chrome,
    console,
    URL,
    AbortController,
    fetch: async () => { throw new Error("Unexpected network request"); },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });
  vm.runInContext(backgroundSource, context);
  context.providerResult = providerResult;
  vm.runInContext("PROVIDERS.gemini.classify = async () => ({ json: providerResult, usage: { input: 0, output: 0 } })", context);
  return { context, calls, tabs };
}

test("a prompted group can regroup loose and already-grouped tabs from the current window", async () => {
  const { context, calls, tabs } = makeHarness({
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

  const result = await vm.runInContext('runCommand("group my O-1 visa memberships", 10, false)', context);

  assert.deepEqual({ ...result }, {
    done: true,
    action: "create_group",
    groupId: 101,
    groupName: "O-1 Visa",
    tabCount: 3,
  });
  assert.deepEqual(calls.grouped, [{ tabIds: [1, 2, 4], groupId: null }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updated)), [
    { id: 101, changes: { title: "O-1 Visa", color: "blue" } },
    { id: 101, changes: { collapsed: true } },
  ]);
  assert.equal(tabs.find((tab) => tab.id === 3).groupId, -1, "pinned tab remains untouched");
  assert.equal(tabs.find((tab) => tab.id === 4).groupId, 101, "matching grouped tab moves to the new group");
  assert.equal(tabs.find((tab) => tab.id === 5).groupId, -1, "unrelated loose tab remains untouched");
  assert.equal(tabs.find((tab) => tab.id === 6).groupId, -1, "other window remains untouched");
  assert.equal(calls.session.length, 1, "the mutation stores one undo snapshot");
});

test("a tab that navigates while the model is thinking is left out of the group", async () => {
  const { context, calls, tabs } = makeHarness({
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
  context.onClassify = () => {
    tabs.find((tab) => tab.id === 2).url = "https://example.com/navigated-away";
  };
  vm.runInContext(
    "PROVIDERS.gemini.classify = async () => { onClassify(); return { json: providerResult, usage: { input: 0, output: 0 } }; }",
    context
  );

  const result = await vm.runInContext('runCommand("group my O-1 visa memberships", 10, false)', context);

  assert.equal(result.action, "create_group");
  assert.equal(result.tabCount, 1);
  assert.deepEqual(calls.grouped, [{ tabIds: [1], groupId: null }]);
  assert.equal(tabs.find((tab) => tab.id === 2).groupId, -1, "navigated tab remains untouched");
});

test("a prompt with no eligible matches leaves every tab untouched", async () => {
  const { context, calls, tabs } = makeHarness({
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

  const result = await vm.runInContext('runCommand("group my O-1 visa memberships", 10, false)', context);

  assert.equal(result.action, "not_found");
  assert.match(result.reply, /matching tabs/i);
  assert.deepEqual(calls.grouped, []);
  assert.deepEqual(calls.session, []);
  assert.deepEqual(tabs.map(({ id, groupId }) => ({ id, groupId })), before);
});

test("a command can ungroup one named group without touching the others", async () => {
  const { context, calls, tabs } = makeHarness({
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

  const result = await vm.runInContext('runCommand("ungroup AI Development", 10, false)', context);

  assert.equal(result.action, "ungroup");
  assert.equal(result.groupCount, 1);
  assert.equal(result.tabCount, 2);
  assert.deepEqual(calls.ungrouped, [[4, 7]]);
  assert.equal(tabs.find((tab) => tab.id === 8).groupId, 88);
  assert.equal(calls.session.length, 1);
});

test("an explicit all-groups command ungroups every group in the current window", async () => {
  const { context, calls } = makeHarness({
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

  const result = await vm.runInContext('runCommand("ungroup all", 10, false)', context);

  assert.equal(result.groupCount, 3);
  assert.equal(result.tabCount, 4);
  assert.deepEqual(calls.ungrouped, [[4, 7, 8, 9]]);
});

test("a command can remove duplicate tabs and report the closed copy", async () => {
  const { context, calls, tabs } = makeHarness({
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

  const result = await vm.runInContext('runCommand("remove duplicates", 10, false)', context);

  assert.equal(result.action, "remove_duplicates");
  assert.equal(result.closedCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.closedTabs)), [
    { title: "Old copy", url: "https://duplicate.test/" },
  ]);
  assert.deepEqual(calls.removed, [[11]]);
});

test("a command can merge multiple related groups into the first selected group", async () => {
  const { context, calls, tabs } = makeHarness({
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

  const result = await vm.runInContext('runCommand("merge my fellowships and memberships groups", 10, false)', context);

  assert.equal(result.action, "merge_groups");
  assert.equal(result.groupId, 88);
  assert.equal(result.groupCount, 2);
  assert.equal(result.tabCount, 2);
  assert.deepEqual(calls.grouped, [{ tabIds: [9], groupId: 88 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updated)), [
    { id: 88, changes: { title: "Career", color: "purple" } },
    { id: 88, changes: { collapsed: true } },
  ]);
  assert.equal(tabs.find((tab) => tab.id === 8).groupId, 88);
  assert.equal(tabs.find((tab) => tab.id === 9).groupId, 88);
  assert.equal(calls.session.length, 1);
});

test("a model-selected broad mutation is rejected unless the user explicitly requested it", async () => {
  const { context, calls } = makeHarness({
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

  const result = await vm.runInContext('runCommand("open my group notes", 10, false)', context);

  assert.match(result.error, /Explicitly ask to ungroup/i);
  assert.deepEqual(calls.ungrouped, []);
  assert.deepEqual(calls.session, []);
});
