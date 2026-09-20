import { afterEach, expect, test, vi } from "vitest";
import type { CommandResponse } from "@/types";

// runCommand with decisionProvider "typesafe": Jev's typed answers drive the
// same guarded dispatch the LLM result does. fetch is the mocked Jev API; the
// LLM provider is a spy so each test can assert whether it was needed.

type Answers = Record<string, unknown>;

const confident = (choice: string, runnerUp = "not_found", confidence = 0.95) => ({
  choice,
  probabilities: { [choice]: 0.9, [runnerUp]: 0.1 },
  confidence,
});

async function makeHarness(answers: Answers | "fail", settings: Record<string, unknown> = {}, local: Record<string, unknown> = {}) {
  const grouped: Array<{ tabIds: number[]; groupId: number | null }> = [];
  const ungrouped: number[][] = [];
  const updated: Array<{ id: number; changes: Record<string, unknown> }> = [];
  const tabs = [
    { id: 1, windowId: 10, index: 0, title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", groupId: -1, pinned: false, incognito: false },
    { id: 2, windowId: 10, index: 1, title: "Scaling laws", url: "https://arxiv.org/abs/2001.08361", groupId: -1, pinned: false, incognito: false },
    { id: 3, windowId: 10, index: 2, title: "World news", url: "https://news.example/", groupId: 77, pinned: false, incognito: false },
  ];
  const groups = [{ id: 77, windowId: 10, title: "News", color: "red" }];

  vi.resetModules();
  vi.stubGlobal("chrome", {
    runtime: { getPlatformInfo: async () => ({}) },
    tabs: {
      query: async (query: { windowType?: string; windowId?: number }) =>
        (query.windowType === "normal" ? tabs : tabs.filter((tab) => tab.windowId === query.windowId)).map((tab) => ({ ...tab })),
      get: async (id: number) => ({ ...tabs.find((tab) => tab.id === id)! }),
      update: async () => ({}),
      group: async ({ tabIds, groupId }: { tabIds: number[]; groupId?: number }) => {
        grouped.push({ tabIds: [...tabIds], groupId: groupId ?? null });
        return groupId ?? 101;
      },
      ungroup: async (tabIds: number[]) => { ungrouped.push([...tabIds]); },
    },
    tabGroups: {
      query: async () => groups.map((group) => ({ ...group })),
      update: async (id: number, changes: Record<string, unknown>) => updated.push({ id, changes }),
    },
    windows: {
      get: async (id: number) => ({ id, incognito: false }),
      getCurrent: async () => ({ id: 10, incognito: false }),
      update: async () => ({}),
    },
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, provider: "gemini", decisionProvider: "typesafe", ...settings }),
        set: async () => {},
      },
      local: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, geminiKey: "test-key", typesafeKey: "ts-key", dataNoticeAck: true, ...local }),
        set: async () => {},
        remove: async () => {},
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
  });
  const fetchMock = vi.fn(async () => {
    if (answers === "fail") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  const [commandModule, providersModule] = await Promise.all([
    import("../public/background/command.js"),
    import("../public/background/providers.js"),
  ]);
  const classify = vi.fn(async (_settings: unknown, _system: string, _user: string, schema: { properties: Record<string, unknown> }) => ({
    json: schema.properties.action
      ? { action: "open_tab", tabId: 3, reply: "", tabIds: [], groupIds: [], allGroups: false, groupName: "", color: "grey", needsContent: [] }
      : { name: "ML Papers" },
    usage: { input: 0, output: 0 },
  }));
  providersModule.PROVIDERS.gemini.classify = classify;

  return {
    grouped, ungrouped, updated, fetchMock, classify,
    runCommand: (query: string, forcedAction?: string) =>
      commandModule.runCommand(query, 10, false, forcedAction) as Promise<CommandResponse>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a named create_group runs from Jev answers alone, with the name copied from the command", async () => {
  const harness = await makeHarness({
    action: confident("create_group"),
    match_1: { noul: 0.9 }, match_2: { noul: 0.8 }, match_3: { noul: 0.1 },
    color: { choice: "blue" },
    name_span: { choice: "c0" },
  });
  const result = await harness.runCommand('group my arxiv tabs called "Papers"');
  expect(result).toMatchObject({ done: true, action: "create_group", groupName: "Papers", tabCount: 2 });
  expect(harness.grouped).toEqual([{ tabIds: [1, 2], groupId: null }]);
  expect(harness.updated[0]).toEqual({ id: 101, changes: { title: "Papers", color: "blue" } });
  expect(harness.classify).not.toHaveBeenCalled();
});

test("an unnamed create_group asks the LLM for a name only", async () => {
  const harness = await makeHarness({
    action: confident("create_group"),
    match_1: { noul: 0.9 }, match_2: { noul: 0.8 },
    color: { choice: "unspecified" },
  });
  const result = await harness.runCommand("group my arxiv tabs");
  expect(result).toMatchObject({ action: "create_group", groupName: "ML Papers" });
  expect(harness.updated[0].changes).toEqual({ title: "ML Papers", color: "grey" });
  expect(harness.classify).toHaveBeenCalledTimes(1);
});

test("low action confidence returns the top two actions to clarify and mutates nothing", async () => {
  const harness = await makeHarness({ action: confident("create_group", "add_to_group", 0.3), match_1: { noul: 0.9 } });
  expect(await harness.runCommand("arxiv stuff into news")).toEqual({ done: true, action: "clarify", options: ["create_group", "add_to_group"] });
  expect(harness.grouped).toEqual([]);

  const nothing = await makeHarness({ action: confident("not_found", "open_tab", 0.3) });
  expect(await nothing.runCommand("open netflix")).toEqual({ done: true, action: "clarify", options: ["open_tab"] });
});

test("destructive actions need higher confidence, a forced action skips the gate, and the regex guard still holds", async () => {
  const answers = { action: confident("ungroup", "update_group", 0.7), target_group: { choice: "77" }, merge_77: { noul: 0.9 }, all_groups: { noul: 0.1 } };
  const harness = await makeHarness(answers);
  expect(await harness.runCommand("ungroup news")).toMatchObject({ action: "clarify", options: ["ungroup", "update_group"] });
  expect(await harness.runCommand("ungroup news", "ungroup")).toMatchObject({ done: true, action: "ungroup", groupCount: 1 });
  expect(harness.ungrouped).toEqual([[3]]);
  expect(await harness.runCommand("tidy news", "ungroup")).toEqual({ error: "Explicitly ask to ungroup tabs before any groups are changed." });
  expect(await harness.runCommand("get rid of the news group but keep the tabs", "ungroup")).toMatchObject({ action: "ungroup" });
});

test("a murky tab selection hands the whole command to the LLM", async () => {
  const harness = await makeHarness({
    action: confident("create_group"),
    match_1: { noul: 0.6 }, match_2: { noul: 0.55 }, match_3: { noul: 0.5 },
  });
  expect(await harness.runCommand("group everything except the news")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(harness.grouped).toEqual([]);

  const merging = await makeHarness({ action: confident("merge_groups"), merge_77: { noul: 0.9 }, merge_78: { noul: 0.9 } });
  expect(await merging.runCommand("merge the similar news groups")).toMatchObject({ action: "open_tab" });
  expect(merging.classify).toHaveBeenCalledTimes(1);
});

test("Jev hands off when it needs page content it cannot get, or a rename has no name", async () => {
  const content = await makeHarness({ action: confident("open_tab"), target_tab: { choice: "1", probabilities: { 1: 0.9 } }, needs_content: { noul: 0.9 } });
  expect(await content.runCommand("open the one about scaling laws")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(content.classify).toHaveBeenCalledTimes(1);

  const rename = await makeHarness({ action: confident("update_group"), target_group: { choice: "77" }, color: { choice: "unspecified" } });
  expect(await rename.runCommand("call the news group headlines please")).toMatchObject({ action: "open_tab" });
  expect(rename.classify).toHaveBeenCalledTimes(1);
});

test("a forced action survives the LLM fallback: a different LLM pick is refused", async () => {
  const harness = await makeHarness({ action: confident("answer") });
  const result = await harness.runCommand("which paper is about scaling?", "answer");
  expect(result).toEqual({ done: true, action: "not_found", reply: "Couldn't carry that out as the action you picked." });
  const [, system] = harness.classify.mock.calls[0] as unknown as [unknown, string];
  expect(system).toContain("already confirmed the action is answer");
});

test("compound commands are refused", async () => {
  const harness = await makeHarness({ action: confident("create_group"), is_compound: { noul: 0.9 }, match_1: { noul: 0.9 } });
  expect(await harness.runCommand("group arxiv tabs and close duplicates")).toEqual({ error: "One command at a time." });
  expect(harness.grouped).toEqual([]);
});

test("answers and Jev failures fall back to the LLM path", async () => {
  const answering = await makeHarness({ action: confident("answer") });
  expect(await answering.runCommand("which paper is about scaling?")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(answering.classify).toHaveBeenCalledTimes(1);

  const failing = await makeHarness("fail");
  expect(await failing.runCommand("open the news")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(failing.fetchMock).toHaveBeenCalledTimes(1);
});

test("without a TypeSafe key the hosted proxy is used, and its 503 falls back to the LLM", async () => {
  const hosted = await makeHarness({ action: confident("open_tab"), target_tab: { choice: "3", probabilities: { 3: 0.9, none: 0.1 } } }, {}, { typesafeKey: "", installToken: "123e4567-e89b-12d3-a456-426614174000" });
  expect(await hosted.runCommand("open the news")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(String((hosted.fetchMock.mock.calls[0] as unknown as [string])[0])).toContain("shelve-api.vercel.app/api/decide");
  expect(hosted.classify).not.toHaveBeenCalled();

  const capped = await makeHarness("fail", {}, { typesafeKey: "" });
  expect(await capped.runCommand("open the news")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(capped.classify).toHaveBeenCalledTimes(1);
});

test("decisionProvider llm never calls TypeSafe", async () => {
  const harness = await makeHarness({ action: confident("create_group") }, { decisionProvider: "llm" });
  expect(await harness.runCommand("open the news")).toMatchObject({ action: "open_tab", tabId: 3 });
  expect(harness.fetchMock).not.toHaveBeenCalled();
});
