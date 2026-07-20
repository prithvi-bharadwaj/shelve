import { afterEach, describe, expect, it } from "vitest";
import { loadBackground, type BackgroundHarness } from "./helpers/backgroundHarness";
import type { ChromeMock } from "./helpers/chromeMock";

const LEGACY_VALUE = "legacy-sentinel-not-a-real-key";

let harness: BackgroundHarness | null = null;

async function load(prepare?: (mock: ChromeMock) => void) {
  harness = await loadBackground(prepare);
  return harness;
}

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("legacy Anthropic credential migration", () => {
  it("copies a legacy-only value into anthropicKey and removes apiKey", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ apiKey: LEGACY_VALUE }));
    const response = await invokeMessage({ type: "migrateLegacyCredential" });
    expect(response).toEqual({ done: true });
    expect(mock.localData.anthropicKey).toBe(LEGACY_VALUE);
    expect(mock.localData.apiKey).toBeUndefined();
  });

  it("keeps an existing modern value and still removes the legacy key", async () => {
    const { invokeMessage, mock } = await load((prepared) =>
      prepared.seedLocal({ anthropicKey: "modern-sentinel", apiKey: LEGACY_VALUE })
    );
    await invokeMessage({ type: "migrateLegacyCredential" });
    expect(mock.localData.anthropicKey).toBe("modern-sentinel");
    expect(mock.localData.apiKey).toBeUndefined();
  });

  it("leaves everything empty when both fields are empty", async () => {
    const { invokeMessage, mock } = await load();
    await invokeMessage({ type: "migrateLegacyCredential" });
    expect(mock.localData.anthropicKey).toBeUndefined();
    expect(mock.localData.apiKey).toBeUndefined();
  });

  it("keeps a cleared Anthropic key cleared across getSettings", async () => {
    const { invokeMessage, exports, mock } = await load((prepared) => prepared.seedLocal({ apiKey: LEGACY_VALUE }));
    await invokeMessage({ type: "migrateLegacyCredential" });
    mock.seedLocal({ anthropicKey: "" });
    const settings = await exports.getSettings();
    expect(settings.anthropicKey).toBe("");
  });

  it("performs one logical migration for concurrent requests", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ apiKey: LEGACY_VALUE }));
    await Promise.all([
      invokeMessage({ type: "migrateLegacyCredential" }),
      invokeMessage({ type: "migrateLegacyCredential" }),
    ]);
    const copyWrites = mock.chrome.storage.local.set.mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>).anthropicKey !== undefined
    );
    expect(copyWrites).toHaveLength(1);
    expect(mock.localData.anthropicKey).toBe(LEGACY_VALUE);
  });

  it("retries after a storage failure resets the single-flight promise", async () => {
    const { invokeMessage, mock } = await load((prepared) => prepared.seedLocal({ apiKey: LEGACY_VALUE }));
    const originalRemove = mock.chrome.storage.local.remove.getMockImplementation()!;
    let failOnce = true;
    mock.chrome.storage.local.remove.mockImplementation(async (keys) => {
      if (failOnce && keys === "apiKey") {
        failOnce = false;
        throw new Error("storage unavailable");
      }
      return originalRemove(keys);
    });
    const first = (await invokeMessage({ type: "migrateLegacyCredential" })) as { error?: string };
    expect(first.error).toBeDefined();
    const second = await invokeMessage({ type: "migrateLegacyCredential" });
    expect(second).toEqual({ done: true });
    expect(mock.localData.apiKey).toBeUndefined();
    expect(mock.localData.anthropicKey).toBe(LEGACY_VALUE);
  });

  it("never includes the credential value in any migration response", async () => {
    const { invokeMessage } = await load((prepared) => prepared.seedLocal({ apiKey: LEGACY_VALUE }));
    const response = await invokeMessage({ type: "migrateLegacyCredential" });
    expect(JSON.stringify(response)).not.toContain(LEGACY_VALUE);
  });
});
