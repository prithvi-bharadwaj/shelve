import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";
import type { MockTab, MockWindow } from "./helpers/chromeMock";

let harness: BackgroundHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

function tab(overrides: Partial<MockTab> & { id: number; windowId: number }): MockTab {
  return { url: "https://example.com/", active: false, pinned: false, groupId: -1, ...overrides };
}

function win(overrides: Partial<MockWindow> & { id: number }): MockWindow {
  return { incognito: false, type: "normal", focused: false, tabs: [], ...overrides };
}

describe("mergeWindows", () => {
  it("moves whole groups and loose tabs from other same-profile windows, re-pinning pinned tabs", async () => {
    harness = await loadBackground();
    const { chrome } = harness.mock;
    chrome.windows.getAll.mockResolvedValue([
      win({ id: 1, focused: true }),
      win({
        id: 2,
        tabs: [
          tab({ id: 10, windowId: 2, groupId: 700 }),
          tab({ id: 11, windowId: 2, groupId: 700 }),
          tab({ id: 12, windowId: 2, pinned: true }),
        ],
      }),
      win({ id: 3, incognito: true, tabs: [tab({ id: 20, windowId: 3 })] }),
    ]);

    const res = await harness.invokeMessage({ type: "mergeWindows", windowId: 1 });

    expect(res).toEqual({ done: true, windows: 1, tabs: 3 });
    expect(chrome.tabGroups.move).toHaveBeenCalledOnce();
    expect(chrome.tabGroups.move).toHaveBeenCalledWith(700, { windowId: 1, index: -1 });
    // Only the loose tab moves individually; grouped tabs travel with the group.
    expect(chrome.tabs.move).toHaveBeenCalledOnce();
    expect(chrome.tabs.move).toHaveBeenCalledWith(12, { windowId: 1, index: -1 });
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { pinned: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it("reports an error when no other same-profile window exists", async () => {
    harness = await loadBackground();
    const { chrome } = harness.mock;
    chrome.windows.getAll.mockResolvedValue([
      win({ id: 1, focused: true }),
      win({ id: 3, incognito: true }),
    ]);

    const res = await harness.invokeMessage({ type: "mergeWindows", windowId: 1 });

    expect(res).toEqual({ error: "Only one window open." });
    expect(chrome.tabs.move).not.toHaveBeenCalled();
    expect(chrome.tabGroups.move).not.toHaveBeenCalled();
  });

  it("counts only same-profile windows", async () => {
    harness = await loadBackground();
    const { chrome } = harness.mock;
    chrome.windows.getAll.mockResolvedValue([
      win({ id: 1, focused: true }),
      win({ id: 2 }),
      win({ id: 3, incognito: true }),
    ]);

    const res = await harness.invokeMessage({ type: "windowCount" });

    expect(res).toEqual({ count: 2 });
  });
});
