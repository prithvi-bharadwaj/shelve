import { vi, type Mock } from "vitest";

type StorageRecord = Record<string, unknown>;
type Listener = (...args: unknown[]) => unknown;

interface EventRegistry {
  addListener: Mock;
  removeListener: Mock;
  hasListener: Mock;
  listeners: Listener[];
  emit: (...args: unknown[]) => unknown[];
}

function createEvent(): EventRegistry {
  const listeners: Listener[] = [];
  return {
    listeners,
    addListener: vi.fn((listener: Listener) => {
      listeners.push(listener);
    }),
    removeListener: vi.fn((listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
    hasListener: vi.fn((listener: Listener) => listeners.includes(listener)),
    emit: (...args: unknown[]) => listeners.map((listener) => listener(...args)),
  };
}

// Chrome's storage.get semantics: string/array keys return only present keys,
// an object argument fills missing keys with its defaults, null returns all.
function createStorageArea(initial: StorageRecord = {}) {
  const data: StorageRecord = { ...initial };
  const clone = <T>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
  return {
    data,
    get: vi.fn(async (keys?: string | string[] | StorageRecord | null) => {
      if (keys === undefined || keys === null) return clone(data);
      if (typeof keys === "string") {
        return keys in data ? { [keys]: clone(data[keys]) } : {};
      }
      if (Array.isArray(keys)) {
        const out: StorageRecord = {};
        for (const key of keys) if (key in data) out[key] = clone(data[key]);
        return out;
      }
      const out: StorageRecord = {};
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = key in data ? clone(data[key]) : clone(fallback);
      }
      return out;
    }),
    set: vi.fn(async (items: StorageRecord) => {
      for (const [key, value] of Object.entries(items)) data[key] = clone(value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
    seed(items: StorageRecord) {
      for (const [key, value] of Object.entries(items)) data[key] = clone(value);
    },
  };
}

export interface MockTab {
  id: number;
  windowId: number;
  url: string;
  active: boolean;
  pinned: boolean;
  groupId: number;
  index?: number;
  title?: string;
}

export interface MockTabGroup {
  id: number;
  windowId: number;
  title?: string;
  color: string;
  collapsed?: boolean;
}

export interface MockWindow {
  id: number;
  incognito: boolean;
  type: string;
  focused: boolean;
  tabs?: MockTab[];
}

export type ChromeMock = ReturnType<typeof createChromeMock>;

export function createChromeMock() {
  const events = {
    runtimeOnMessage: createEvent(),
    runtimeOnInstalled: createEvent(),
    runtimeOnStartup: createEvent(),
    storageOnChanged: createEvent(),
    tabsOnCreated: createEvent(),
    tabsOnRemoved: createEvent(),
    tabsOnUpdated: createEvent(),
    windowsOnRemoved: createEvent(),
    actionOnClicked: createEvent(),
    notificationsOnClicked: createEvent(),
    notificationsOnButtonClicked: createEvent(),
  };

  const local = createStorageArea();
  const sync = createStorageArea();
  const session = createStorageArea();

  const currentWindow = { id: 1, incognito: false, type: "normal", focused: true };
  let nextTabId = 1000;
  let nextGroupId = 500;

  const chrome = {
    runtime: {
      onMessage: events.runtimeOnMessage,
      onInstalled: events.runtimeOnInstalled,
      onStartup: events.runtimeOnStartup,
      getPlatformInfo: vi.fn(async () => ({ os: "mac" })),
      getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
      sendMessage: vi.fn(async (_message: unknown) => ({} as unknown)),
      openOptionsPage: vi.fn(async () => undefined),
      lastError: undefined as { message: string } | undefined,
    },
    storage: {
      local,
      sync,
      session,
      onChanged: events.storageOnChanged,
    },
    tabs: {
      onCreated: events.tabsOnCreated,
      onRemoved: events.tabsOnRemoved,
      onUpdated: events.tabsOnUpdated,
      query: vi.fn(async (_query?: { windowId?: number }): Promise<MockTab[]> => []),
      get: vi.fn(async (tabId: number): Promise<MockTab> => {
        throw new Error(`No tab with id: ${tabId}.`);
      }),
      create: vi.fn(
        async (props: { windowId?: number; url?: string; active?: boolean }): Promise<MockTab> => ({
          id: nextTabId++,
          windowId: props.windowId ?? currentWindow.id,
          url: props.url ?? "chrome://newtab/",
          active: props.active ?? false,
          pinned: false,
          groupId: -1,
        })
      ),
      remove: vi.fn(async (_tabIds: number | number[]) => undefined),
      move: vi.fn(async (_tabIds: number | number[], _props: object) => undefined),
      update: vi.fn(async (_tabId: number, _props: object) => undefined),
      group: vi.fn(async (_options: { tabIds: number | number[]; groupId?: number }) => nextGroupId++),
      ungroup: vi.fn(async (_tabIds: number | number[]) => undefined),
      sendMessage: vi.fn(async (_tabId: number, _message: unknown): Promise<unknown> => {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }),
    },
    tabGroups: {
      query: vi.fn(async (_query?: { windowId?: number }): Promise<MockTabGroup[]> => []),
      get: vi.fn(async (groupId: number): Promise<MockTabGroup> => {
        throw new Error(`No group with id: ${groupId}.`);
      }),
      update: vi.fn(async (_groupId: number, _props: object) => undefined),
      move: vi.fn(async (_groupId: number, _props: object) => undefined),
    },
    windows: {
      onRemoved: events.windowsOnRemoved,
      getCurrent: vi.fn(async () => ({ ...currentWindow })),
      get: vi.fn(async (_windowId: number) => ({ ...currentWindow })),
      getAll: vi.fn(async (_query?: object): Promise<MockWindow[]> => [{ ...currentWindow }]),
      update: vi.fn(async () => undefined),
      create: vi.fn(async (_props?: object) => ({ id: 2 })),
    },
    action: {
      onClicked: events.actionOnClicked,
      setPopup: vi.fn(async (_props: { tabId?: number; popup: string }) => undefined),
      setBadgeText: vi.fn(async () => undefined),
      openPopup: vi.fn(async () => undefined),
      getUserSettings: vi.fn(async () => ({ isOnToolbar: true })),
    },
    notifications: {
      onClicked: events.notificationsOnClicked,
      onButtonClicked: events.notificationsOnButtonClicked,
      create: vi.fn((...args: unknown[]) => {
        const callback = args.find((arg) => typeof arg === "function") as (() => void) | undefined;
        if (callback) {
          callback();
          return undefined;
        }
        return Promise.resolve("notification-id");
      }),
      clear: vi.fn(async () => true),
    },
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => false),
    },
    scripting: {
      executeScript: vi.fn(async () => [] as unknown[]),
    },
  };

  return {
    chrome,
    events,
    currentWindow,
    seedLocal: (items: StorageRecord) => local.seed(items),
    seedSync: (items: StorageRecord) => sync.seed(items),
    seedSession: (items: StorageRecord) => session.seed(items),
    localData: local.data,
    syncData: sync.data,
    sessionData: session.data,
  };
}
