import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness, type UndoSnapshot } from "./helpers/backgroundHarness";
import type { ChromeMock } from "./helpers/chromeMock";

const WINDOWS: Record<number, { id: number; incognito: boolean; type: string; focused: boolean }> = {
  1: { id: 1, incognito: false, type: "normal", focused: true },
  2: { id: 2, incognito: false, type: "normal", focused: false },
  11: { id: 11, incognito: true, type: "normal", focused: false },
  12: { id: 12, incognito: true, type: "normal", focused: false },
};

function useWindowFixtures(mock: ChromeMock) {
  mock.chrome.windows.get.mockImplementation(async (windowId: number) => {
    const found = WINDOWS[windowId];
    if (!found) throw new Error(`No window with id: ${windowId}.`);
    return { ...found };
  });
}

function snapshotFor(windowId: number, incognito: boolean, url: string): UndoSnapshot {
  return {
    version: 2,
    windowId,
    incognito,
    tabs: [{ id: windowId * 100, url, index: 0, pinned: false, groupId: -1 }],
    groups: [],
    closedUrls: [],
    closedTabIds: [],
  };
}

let harness: BackgroundHarness | null = null;

async function load(prepare?: (mock: ChromeMock) => void) {
  harness = await loadBackground((mock) => {
    useWindowFixtures(mock);
    prepare?.(mock);
  });
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("organize consent enforcement", () => {
  it("rejects organize without acknowledgement before any tab or provider work", async () => {
    const { invokeMessage, mock, fetchMock } = await load();
    const response = await invokeMessage({ type: "organize", windowId: 1, hasContentPermission: true });
    expect(response).toEqual({ error: "Acknowledge the AI data notice in the popup first." });
    expect(mock.chrome.tabs.query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds past the consent guard once acknowledged", async () => {
    const { invokeMessage } = await load((mock) => mock.seedLocal({ dataNoticeAck: true }));
    const response = (await invokeMessage({ type: "organize", windowId: 1 })) as { error?: string };
    expect(response.error).toMatch(/No Gemini API key set/);
  });
});

describe("undo snapshot browsing-context isolation", () => {
  it("marks a captured incognito snapshot as version 2 incognito", async () => {
    const { exports, mock } = await load();
    mock.chrome.tabs.query.mockResolvedValue([
      { id: 1100, windowId: 11, url: "https://private.example/secret", active: false, index: 0, pinned: false, groupId: -1 },
    ]);
    const snapshot = await exports.captureSnapshot(11);
    expect(snapshot.version).toBe(2);
    expect(snapshot.incognito).toBe(true);
    expect(snapshot.windowId).toBe(11);
  });

  it("never writes an incognito snapshot to session or local storage", async () => {
    const { exports, mock } = await load();
    await exports.storeUndoSnapshot(snapshotFor(11, true, "https://private.example/secret"));
    expect(mock.chrome.storage.session.set).not.toHaveBeenCalled();
    expect(mock.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.sessionData)).not.toContain("private.example");
    expect(JSON.stringify(mock.localData)).not.toContain("private.example");
  });

  it("returns an incognito snapshot only to that exact incognito window", async () => {
    const { exports } = await load();
    await exports.storeUndoSnapshot(snapshotFor(11, true, "https://private.example/secret"));
    const same = await exports.getUndoSnapshot(11);
    expect(same?.tabs[0].url).toBe("https://private.example/secret");
    expect(await exports.getUndoSnapshot(12)).toBeNull();
  });

  it("stores a regular snapshot only under its per-window v2 key", async () => {
    const { exports, mock } = await load();
    await exports.storeUndoSnapshot(snapshotFor(1, false, "https://work.example/doc"));
    expect(Object.keys(mock.sessionData)).toEqual(["undoSnapshot:v2:1"]);
    expect(mock.localData["undoSnapshot:v2:1"]).toBeUndefined();
    expect(mock.localData["undoSnapshot"]).toBeUndefined();
  });

  it("does not let a regular window read another regular window's record", async () => {
    const { exports } = await load();
    await exports.storeUndoSnapshot(snapshotFor(1, false, "https://work.example/doc"));
    expect(await exports.getUndoSnapshot(2)).toBeNull();
    expect((await exports.getUndoSnapshot(1))?.windowId).toBe(1);
  });

  it("does not let a regular window read an incognito in-memory record", async () => {
    const { exports } = await load();
    await exports.storeUndoSnapshot(snapshotFor(11, true, "https://private.example/secret"));
    expect(await exports.getUndoSnapshot(1)).toBeNull();
  });

  it("deletes legacy global undoSnapshot values and never returns them", async () => {
    const { exports, mock, flush } = await load((prepared) => {
      prepared.seedSession({ undoSnapshot: snapshotFor(1, false, "https://old.example/legacy") });
      prepared.seedLocal({ undoSnapshot: snapshotFor(1, false, "https://old.example/legacy") });
    });
    await flush();
    expect(mock.sessionData["undoSnapshot"]).toBeUndefined();
    expect(mock.localData["undoSnapshot"]).toBeUndefined();
    expect(await exports.getUndoSnapshot(1)).toBeNull();
  });

  it("drops the in-memory undo record when its incognito window closes", async () => {
    const { exports, mock } = await load();
    await exports.storeUndoSnapshot(snapshotFor(11, true, "https://private.example/secret"));
    mock.events.windowsOnRemoved.emit(11);
    expect(await exports.getUndoSnapshot(11)).toBeNull();
  });

  it("rejects malformed snapshots instead of persisting them", async () => {
    const { exports, mock } = await load();
    const malformed = { ...snapshotFor(1, false, "https://work.example/doc"), version: 1 };
    await expect(exports.storeUndoSnapshot(malformed)).rejects.toThrow("Invalid undo snapshot.");
    expect(mock.chrome.storage.session.set).not.toHaveBeenCalled();
    expect(mock.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("scopes the undo message to the requesting window", async () => {
    const { exports, invokeMessage } = await load();
    await exports.storeUndoSnapshot(snapshotFor(1, false, "https://work.example/doc"));
    expect(await invokeMessage({ type: "hasUndo", windowId: 1 })).toEqual({ hasUndo: true });
    expect(await invokeMessage({ type: "hasUndo", windowId: 2 })).toEqual({ hasUndo: false });
    expect(await invokeMessage({ type: "undo", windowId: 2 })).toEqual({ error: "Nothing to undo." });
  });
});
