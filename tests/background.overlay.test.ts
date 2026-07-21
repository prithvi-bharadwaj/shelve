import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";

let harness: BackgroundHarness;

afterEach(() => {
  harness?.cleanup();
});

async function clickAction(tab: { id?: number } = { id: 7 }) {
  await Promise.all(harness.mock.events.actionOnClicked.emit(tab));
}

describe("action click overlay routing", () => {
  it("injects overlay.js when the tab has no overlay script yet", async () => {
    harness = await loadBackground();
    await clickAction();
    expect(harness.mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "toggleOverlay" });
    expect(harness.mock.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["overlay.js"],
    });
    expect(harness.mock.chrome.windows.create).not.toHaveBeenCalled();
  });

  it("only toggles when the overlay script is already present", async () => {
    harness = await loadBackground();
    harness.mock.chrome.tabs.sendMessage.mockResolvedValueOnce(undefined);
    await clickAction();
    expect(harness.mock.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(harness.mock.chrome.windows.create).not.toHaveBeenCalled();
  });

  it("falls back to the anchored action popup on pages it cannot script", async () => {
    harness = await loadBackground();
    harness.mock.chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error("Cannot access a chrome:// URL")
    );
    await clickAction();
    expect(harness.mock.chrome.action.setPopup).toHaveBeenCalledWith({ tabId: 7, popup: "popup.html" });
    expect(harness.mock.chrome.action.openPopup).toHaveBeenCalled();
    expect(harness.mock.chrome.windows.create).not.toHaveBeenCalled();
  });

  it("clears the per-tab fallback popup when the tab navigates away", async () => {
    harness = await loadBackground();
    harness.mock.chrome.scripting.executeScript.mockRejectedValueOnce(new Error("restricted"));
    await clickAction();
    expect(harness.mock.chrome.action.setPopup).toHaveBeenCalledWith({ tabId: 7, popup: "popup.html" });
    await Promise.all(
      harness.mock.events.tabsOnUpdated.emit(7, { url: "https://example.com/" }, { id: 7 })
    );
    expect(harness.mock.chrome.action.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: "" });
  });

  it("never opens a separate window", async () => {
    harness = await loadBackground();
    harness.mock.chrome.scripting.executeScript.mockRejectedValue(new Error("nope"));
    harness.mock.chrome.action.openPopup.mockRejectedValue(new Error("openPopup requires Chrome 127"));
    await clickAction();
    expect(harness.mock.chrome.windows.create).not.toHaveBeenCalled();
  });
});

describe("overlay embed handshake", () => {
  function handshake(sender: Record<string, unknown>) {
    return new Promise((resolve) => {
      const handled = harness.messageListener({ type: "overlayHandshake" }, sender, resolve);
      if (!handled) resolve({ unhandled: true });
    });
  }

  it("allows one handshake per action click, then burns the token", async () => {
    harness = await loadBackground();
    await clickAction();
    await expect(handshake({ tab: { id: 7 } })).resolves.toEqual({ allowed: true });
    await expect(handshake({ tab: { id: 7 } })).resolves.toEqual({ allowed: false });
  });

  it("rejects tabs that never saw an action click and senders without a tab", async () => {
    harness = await loadBackground();
    await clickAction();
    await expect(handshake({ tab: { id: 99 } })).resolves.toEqual({ allowed: false });
    await expect(handshake({})).resolves.toEqual({ allowed: false });
  });
});

describe("overlay manifest surface", () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"));

  it("uses activeTab + scripting instead of a default popup", () => {
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.action.default_popup).toBeUndefined();
  });

  it("exposes the popup document and its assets to web pages", () => {
    const resources = manifest.web_accessible_resources?.flatMap(
      (entry: { resources: string[] }) => entry.resources
    );
    expect(resources).toEqual(expect.arrayContaining(["popup.html", "assets/*"]));
  });
});
