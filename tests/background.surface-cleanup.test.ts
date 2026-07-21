import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";

let harness: BackgroundHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("tab-monitor surface removal", () => {
  it("no longer requests the notifications permission", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"));
    expect(manifest.permissions).not.toContain("notifications");
  });

  it("no longer dispatches monitorState messages", async () => {
    harness = await loadBackground();
    const handled = harness.messageListener({ type: "monitorState", windowId: 1 }, {}, () => {
      throw new Error("monitorState unexpectedly responded");
    });
    expect(handled, "monitorState should be unhandled").toBe(false);
  });

  it("removes persisted monitor settings on install while keeping merge settings", async () => {
    harness = await loadBackground((mock) => {
      mock.seedSync({ mergeOnOrganize: true, auto: "badge", autoThreshold: 20, minGroupSize: 3 });
      mock.seedLocal({ monitorAlertedWindows: { "1": true }, geminiKey: "keep-me" });
    });
    harness.mock.events.runtimeOnInstalled.emit({ reason: "update" });
    await harness.flush();
    expect(harness.mock.syncData.auto).toBeUndefined();
    expect(harness.mock.syncData.autoThreshold).toBeUndefined();
    expect(harness.mock.localData.monitorAlertedWindows).toBeUndefined();
    expect(harness.mock.syncData.mergeOnOrganize).toBe(true);
    expect(harness.mock.syncData.minGroupSize).toBe(3);
    expect(harness.mock.localData.geminiKey).toBe("keep-me");
  });

  it("registers no notification or tab-monitor listeners", async () => {
    harness = await loadBackground();
    const { events } = harness.mock;
    expect(events.notificationsOnClicked.listeners).toHaveLength(0);
    expect(events.notificationsOnButtonClicked.listeners).toHaveLength(0);
    expect(events.tabsOnCreated.listeners).toHaveLength(0);
    expect(events.tabsOnRemoved.listeners).toHaveLength(0);
    // Exactly one onUpdated listener: the fallback-popup clearer in
    // background.js. Anything more means monitor-style listeners crept back.
    expect(events.tabsOnUpdated.listeners).toHaveLength(1);
    expect(events.runtimeOnStartup.listeners).toHaveLength(0);
    expect(events.storageOnChanged.listeners).toHaveLength(0);
  });
});
