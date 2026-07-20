// Small helpers with no feature-level dependencies.

import { PROVIDER_TIMEOUT_MS } from "./constants.js";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Request timed out.");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error("Request timed out.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("The model returned invalid JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export function parseProviderJson(text, usage) {
  try {
    return parseJson(text);
  } catch (error) {
    error.usage = usage;
    throw error;
  }
}

export function providerOutputError(message, usage) {
  const error = new Error(message);
  error.usage = usage;
  return error;
}

export function safeImportUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol !== "javascript:" && protocol !== "data:";
  } catch {
    return false;
  }
}

export function firstGroupIndex(tabs, groupId) {
  return Math.min(...tabs.filter((tab) => tab.groupId === groupId).map((tab) => tab.index));
}

// Extension API calls reset the MV3 idle timer; without this, closing the
// popup stops the status polling and Chrome can kill the worker ~30s into a
// long provider call.
export function startKeepalive() {
  const timer = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, 20 * 1000);
  return () => clearInterval(timer);
}
