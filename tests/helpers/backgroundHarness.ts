import { vi } from "vitest";
import { createChromeMock, type ChromeMock } from "./chromeMock";

// The worker is real ES modules now; the harness stubs the globals the modules
// read (chrome, fetch, timers), resets the module registry, and imports the
// entry so each test gets fresh module-level state.

// Captured before any stubbing so harness plumbing keeps working while the
// worker sees inert timers.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);

export interface UndoSnapshot {
  version: number;
  windowId: number;
  incognito: boolean;
  tabs: Array<{ id: number; url: string; index: number; pinned: boolean; groupId: number }>;
  groups: Array<{ id: number; title: string; color: string; collapsed?: boolean }>;
  closedTabs?: Array<{ originalId: number | null; url: string; reopenedId: number | null }>;
  closedUrls?: string[];
  closedTabIds?: number[];
}

interface WorkerExports {
  sanitizePlan: (
    plan: { groups?: unknown[]; needsContent?: number[] },
    candidateIds: Set<number>,
    existingById: Map<number, unknown>,
    minSize: number
  ) => Array<{ name: string; color: string; tabIds: number[]; existingGroupId: number | null; importance: number }>;
  safeImportUrl: (value: unknown) => boolean;
  normalizedDuplicateUrl: (value: unknown) => string | null;
  captureSnapshot: (windowId: number) => Promise<UndoSnapshot>;
  storeUndoSnapshot: (snapshot: UndoSnapshot) => Promise<void>;
  getUndoSnapshot: (windowId: number) => Promise<UndoSnapshot | null>;
  clearUndoSnapshot: (windowId: number) => Promise<void>;
  undoStorageKey: (windowId: number) => string | null;
  getSettings: () => Promise<Record<string, unknown>>;
}

type MessageListener = (
  msg: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

export interface BackgroundHarness {
  mock: ChromeMock;
  exports: WorkerExports;
  messageListener: MessageListener;
  invokeMessage: (message: Record<string, unknown>) => Promise<unknown>;
  fetchMock: ReturnType<typeof vi.fn>;
  flush: () => Promise<void>;
  cleanup: () => void;
}

// `prepare` runs before the worker modules are evaluated, so tests can seed
// storage that startup code (e.g. the legacy-undo purge) must observe.
export async function loadBackground(prepare?: (mock: ChromeMock) => void): Promise<BackgroundHarness> {
  const mock = createChromeMock();
  prepare?.(mock);

  // Timers are inert: callbacks are recorded, never executed, so worker-side
  // scheduling (keepalive, cascade sleeps) cannot run asynchronously mid-test.
  const pendingTimers = new Set<number>();
  let timerId = 1;
  const inertSetTimer = (_callback: unknown, _ms?: number) => {
    const id = timerId++;
    pendingTimers.add(id);
    return id;
  };
  const inertClearTimer = (id?: number) => {
    if (id !== undefined) pendingTimers.delete(id);
  };

  const fetchMock = vi.fn(() => Promise.reject(new Error("Network access is not available in tests.")));

  vi.resetModules();
  vi.stubGlobal("chrome", mock.chrome);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("setTimeout", inertSetTimer);
  vi.stubGlobal("clearTimeout", inertClearTimer);
  vi.stubGlobal("setInterval", inertSetTimer);
  vi.stubGlobal("clearInterval", inertClearTimer);

  // The entry registers the message listener and browser event hooks.
  await import("../../public/background.js");
  const [organizeModule, undoModule, dedupeModule, utilModule, settingsModule] = await Promise.all([
    import("../../public/background/organize.js"),
    import("../../public/background/undo.js"),
    import("../../public/background/dedupe.js"),
    import("../../public/background/util.js"),
    import("../../public/background/settings.js"),
  ]);

  // The worker modules are untyped JS; the WorkerExports interface is the
  // harness-side contract, so the loose inferred shapes are cast to it.
  const workerExports = {
    sanitizePlan: organizeModule.sanitizePlan,
    safeImportUrl: utilModule.safeImportUrl,
    normalizedDuplicateUrl: dedupeModule.normalizedDuplicateUrl,
    captureSnapshot: undoModule.captureSnapshot,
    storeUndoSnapshot: undoModule.storeUndoSnapshot,
    getUndoSnapshot: undoModule.getUndoSnapshot,
    clearUndoSnapshot: undoModule.clearUndoSnapshot,
    undoStorageKey: undoModule.undoStorageKey,
    getSettings: settingsModule.getSettings,
  } as unknown as WorkerExports;

  const messageListener = mock.events.runtimeOnMessage.listeners[0] as MessageListener | undefined;
  if (!messageListener) throw new Error("The worker did not register a runtime.onMessage listener.");

  const invokeMessage = (message: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      const timer = realSetTimeout(
        () => reject(new Error(`Handler for "${String(message.type)}" never responded.`)),
        2000
      );
      let handled: boolean | undefined;
      try {
        handled = messageListener(
          message,
          {},
          (response?: unknown) => {
            realClearTimeout(timer);
            resolve(response);
          }
        );
      } catch (error) {
        realClearTimeout(timer);
        reject(error);
        return;
      }
      if (handled === false) {
        realClearTimeout(timer);
        reject(new Error(`No handler for message type "${String(message.type)}".`));
      }
    });

  return {
    mock,
    exports: workerExports,
    messageListener,
    invokeMessage,
    fetchMock,
    flush: () => new Promise((resolve) => realSetTimeout(resolve, 0)),
    cleanup: () => {
      pendingTimers.clear();
      vi.unstubAllGlobals();
    },
  };
}
