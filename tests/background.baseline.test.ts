import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";

let harness: BackgroundHarness | null = null;

function load() {
  harness = loadBackground();
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("background worker baseline", () => {
  it("registers exactly one runtime message listener", () => {
    const { mock } = load();
    expect(mock.events.runtimeOnMessage.listeners).toHaveLength(1);
  });

  it("returns false synchronously for an unknown message type", () => {
    const { messageListener } = load();
    const result = messageListener({ type: "definitely-not-a-handler" }, {}, () => {});
    expect(result).toBe(false);
  });

  it("safeImportUrl accepts HTTPS URLs", () => {
    const { exports } = load();
    expect(exports.safeImportUrl("https://example.com/page")).toBe(true);
  });

  it("safeImportUrl rejects javascript: and data: URLs", () => {
    const { exports } = load();
    expect(exports.safeImportUrl("javascript:alert(1)")).toBe(false);
    expect(exports.safeImportUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("sanitizePlan drops unknown tab ids and assigns a tab to at most one group", () => {
    const { exports } = load();
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
    const { invokeMessage } = load();
    const response = await invokeMessage({ type: "hasUndo" });
    expect(response).toEqual({ hasUndo: false });
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });
});
