import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";

let harness: BackgroundHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("shelve free tier", () => {
  it("lists the hosted model without any credential", async () => {
    harness = await loadBackground();
    const res = (await harness.invokeMessage({ type: "listModels", provider: "shelve" })) as {
      models: Array<{ id: string; name: string }>;
    };
    expect(res.models).toEqual([{ id: "gemini-3.1-flash-lite", name: "Shelve Free (Gemini Flash Lite)" }]);
  });

  it("mints an install token, stores the remaining count, and maps 402 to a friendly error", async () => {
    harness = await loadBackground();
    harness.fetchMock.mockResolvedValueOnce({
      status: 402,
      ok: false,
      headers: { get: (name: string) => (name === "x-shelve-actions-remaining" ? "0" : null) },
      json: async () => ({ error: "free_actions_exhausted" }),
      text: async () => JSON.stringify({ error: "free_actions_exhausted" }),
    });
    const { PROVIDERS } = await import("../public/background/providers.js");
    await expect(
      PROVIDERS.shelve.classify({}, "system prompt", "user prompt", { type: "object", properties: {} })
    ).rejects.toThrow(/free actions are used up/i);
    await flushMicrotasks();
    expect(harness.mock.localData.installToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(harness.mock.localData.freeActionsRemaining).toBe("0");
  });

  it("reuses the same install token across calls", async () => {
    harness = await loadBackground((mock) => mock.seedLocal({ installToken: "11111111-2222-3333-4444-555555555555" }));
    const notFound = { status: 500, ok: false, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" };
    harness.fetchMock.mockResolvedValue(notFound);
    const { PROVIDERS } = await import("../public/background/providers.js");
    await PROVIDERS.shelve.classify({}, "s", "u", { type: "object", properties: {} }).catch(() => undefined);
    const call = harness.fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers.Authorization).toBe("Bearer 11111111-2222-3333-4444-555555555555");
  });
});
