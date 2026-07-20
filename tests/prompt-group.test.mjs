import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(new URL("../public/background.js", import.meta.url), "utf8");

function eventStub() {
  return { addListener() {} };
}

function makeHarness(providerResult) {
  const calls = { grouped: [], updated: [], session: [] };
  const tabs = [
    { id: 1, windowId: 10, index: 0, title: "O-1 membership directory", url: "https://example.com/directory", groupId: -1, pinned: false, incognito: false },
    { id: 2, windowId: 10, index: 1, title: "Professional association", url: "https://example.com/association", groupId: -1, pinned: false, incognito: false },
    { id: 3, windowId: 10, index: 2, title: "Pinned membership", url: "https://example.com/pinned", groupId: -1, pinned: true, incognito: false },
    { id: 4, windowId: 10, index: 3, title: "Grouped membership", url: "https://example.com/grouped", groupId: 77, pinned: false, incognito: false },
    { id: 5, windowId: 10, index: 4, title: "Unrelated tab", url: "https://example.com/other", groupId: -1, pinned: false, incognito: false },
    { id: 6, windowId: 20, index: 0, title: "Other-window membership", url: "https://example.com/other-window", groupId: -1, pinned: false, incognito: false },
  ];
  const groups = [{ id: 77, windowId: 10, title: "Existing", color: "red" }];

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
      group: async ({ tabIds }) => {
        calls.grouped.push([...tabIds]);
        for (const id of tabIds) tabs.find((tab) => tab.id === id).groupId = 101;
        return 101;
      },
    },
    tabGroups: {
      query: async (query) => groups.filter((group) => !query.windowId || group.windowId === query.windowId),
      update: async (id, changes) => calls.updated.push({ id, changes }),
    },
    windows: {
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

test("a prompted group includes only loose tabs from the current window", async () => {
  const { context, calls, tabs } = makeHarness({
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [1, 2, 3, 4, 6, 999],
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
    tabCount: 2,
  });
  assert.deepEqual(calls.grouped, [[1, 2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updated)), [
    { id: 101, changes: { title: "O-1 Visa", color: "blue" } },
  ]);
  assert.equal(tabs.find((tab) => tab.id === 3).groupId, -1, "pinned tab remains untouched");
  assert.equal(tabs.find((tab) => tab.id === 4).groupId, 77, "existing group remains untouched");
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
  assert.deepEqual(calls.grouped, [[1]]);
  assert.equal(tabs.find((tab) => tab.id === 2).groupId, -1, "navigated tab remains untouched");
});

test("a prompt with no eligible matches leaves every tab untouched", async () => {
  const { context, calls, tabs } = makeHarness({
    action: "create_group",
    tabId: null,
    reply: "",
    tabIds: [3, 4, 6],
    groupName: "O-1 Visa",
    color: "blue",
    needsContent: [],
  });
  const before = tabs.map(({ id, groupId }) => ({ id, groupId }));

  const result = await vm.runInContext('runCommand("group my O-1 visa memberships", 10, false)', context);

  assert.equal(result.action, "not_found");
  assert.match(result.reply, /existing groups were left unchanged/i);
  assert.deepEqual(calls.grouped, []);
  assert.deepEqual(calls.session, []);
  assert.deepEqual(tabs.map(({ id, groupId }) => ({ id, groupId })), before);
});
