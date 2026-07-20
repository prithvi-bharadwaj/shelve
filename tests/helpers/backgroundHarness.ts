import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { vi } from "vitest";
import { createChromeMock, type ChromeMock } from "./chromeMock";

// Vitest runs from the project root; import.meta.url is http-scheme under jsdom.
const WORKER_PATH = resolve(process.cwd(), "public/background.js");

// Appended inside the VM only — production background.js stays untouched.
const TEST_EXPORTS = `
;globalThis.__focusedTestExports = {
  sanitizePlan,
  safeImportUrl,
  normalizedDuplicateUrl,
  captureSnapshot,
  storeUndoSnapshot,
  getUndoSnapshot,
  clearUndoSnapshot,
  undoStorageKey,
};
`;

export interface UndoSnapshot {
  version: number;
  windowId: number;
  incognito: boolean;
  tabs: Array<{ id: number; url: string; index: number; pinned: boolean; groupId: number }>;
  groups: Array<{ id: number; title: string; color: string }>;
  closedUrls: string[];
  closedTabIds: number[];
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

// `prepare` runs before the worker script is evaluated, so tests can seed
// storage that startup code (e.g. the legacy-undo purge) must observe.
export function loadBackground(prepare?: (mock: ChromeMock) => void): BackgroundHarness {
  const mock = createChromeMock();
  prepare?.(mock);
  const source = readFileSync(WORKER_PATH, "utf8");

  // Timers are inert: callbacks are recorded, never executed, so the startup
  // scheduleAutoCheck() cannot run asynchronously mid-test.
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
  const sandbox: Record<string, unknown> = {
    chrome: mock.chrome,
    URL,
    AbortController,
    Promise,
    fetch: fetchMock,
    setTimeout: inertSetTimer,
    clearTimeout: inertClearTimer,
    setInterval: inertSetTimer,
    clearInterval: inertClearTimer,
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(source + TEST_EXPORTS, context, { filename: "background.js" });

  const messageListener = mock.events.runtimeOnMessage.listeners[0] as MessageListener | undefined;
  if (!messageListener) throw new Error("The worker did not register a runtime.onMessage listener.");

  const invokeMessage = (message: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Handler for "${String(message.type)}" never responded.`)),
        2000
      );
      let handled: boolean | undefined;
      try {
        handled = messageListener(
          message,
          {},
          (response?: unknown) => {
            clearTimeout(timer);
            resolve(response);
          }
        );
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      if (handled === false) {
        clearTimeout(timer);
        reject(new Error(`No handler for message type "${String(message.type)}".`));
      }
    });

  return {
    mock,
    exports: (sandbox as { __focusedTestExports?: WorkerExports }).__focusedTestExports as WorkerExports,
    messageListener,
    invokeMessage,
    fetchMock,
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    cleanup: () => pendingTimers.clear(),
  };
}
