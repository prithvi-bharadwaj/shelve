// User settings, credential migration, and provider access checks.

import { DEFAULT_MODELS, DEFAULT_PREFS, DEFAULT_LOCAL } from "./constants.js";

let legacyCredentialMigration = null;

// Copies the pre-rename Anthropic credential ("apiKey") into anthropicKey at
// most once, then removes the legacy key so clearing the field stays cleared.
// Single-flight; a storage failure resets the cached promise so a later call
// retries. The credential value is never logged or returned.
export function migrateLegacyCredential() {
  if (!legacyCredentialMigration) {
    legacyCredentialMigration = (async () => {
      const stored = await chrome.storage.local.get({ anthropicKey: "", apiKey: "" });
      const legacy = typeof stored.apiKey === "string" ? stored.apiKey.trim() : "";
      if (!stored.anthropicKey && legacy) {
        await chrome.storage.local.set({ anthropicKey: legacy });
      }
      await chrome.storage.local.remove("apiKey");
    })().catch((error) => {
      legacyCredentialMigration = null;
      throw error;
    });
  }
  return legacyCredentialMigration;
}

export async function getSettings() {
  await migrateLegacyCredential().catch(() => undefined);
  const [prefs, local] = await Promise.all([
    chrome.storage.sync.get({ ...DEFAULT_PREFS, model: "" }),
    chrome.storage.local.get(DEFAULT_LOCAL)
  ]);
  const modelByProvider = { ...DEFAULT_MODELS, ...(prefs.modelByProvider || {}) };
  if (prefs.model && !prefs.modelByProvider?.anthropic) modelByProvider.anthropic = prefs.model;
  // Old default; carry users forward to the current fast model.
  if (modelByProvider.gemini === "gemini-2.5-flash-lite") modelByProvider.gemini = "gemini-3.1-flash-lite";
  return {
    ...DEFAULT_PREFS,
    ...prefs,
    ...local,
    modelByProvider,
    model: modelByProvider[prefs.provider || DEFAULT_PREFS.provider]
  };
}

export async function hasDataNoticeAck() {
  const stored = await chrome.storage.local.get({ dataNoticeAck: false });
  return Boolean(stored.dataNoticeAck);
}

export function hasProviderAccess(settings) {
  if (settings.provider === "ollama") return true;
  return Boolean(settings[`${settings.provider}Key`]);
}

export function missingCredentialMessage(provider) {
  const names = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };
  return `No ${names[provider] || "provider"} API key set — open Settings and add one.`;
}
