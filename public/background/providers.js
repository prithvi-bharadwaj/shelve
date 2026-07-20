// AI provider clients, model listing, spend tracking, and the shared call path.

import {
  DEFAULT_MODELS,
  DEFAULT_LOCAL,
  PRICES,
  PROVIDER_TIMEOUT_MS,
  OLLAMA_TIMEOUT_MS
} from "./constants.js";
import { fetchWithTimeout, withTimeout, parseProviderJson, providerOutputError } from "./util.js";
import { getSettings } from "./settings.js";

export const PROVIDERS = {
  openai: {
    async listModels(settings) {
      if (!settings.openaiKey) return [];
      const resp = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${settings.openaiKey}` }
      }, 10000);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data || [])
        .map((model) => model.id)
        .filter((id) => id.startsWith("gpt-"))
        .sort()
        .map((id) => ({ id, name: id }));
    },

    async classify(settings, system, user, schema) {
      const resp = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: settings.model,
          instructions: system,
          input: user,
          reasoning: { effort: "low" },
          text: { format: { type: "json_schema", name: "tab_plan", strict: true, schema } }
        })
      }, PROVIDER_TIMEOUT_MS);
      const data = await readApiResponse(resp);
      const text = data.output?.find((item) => item.type === "message")?.content?.[0]?.text;
      const usage = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
      if (!text) throw providerOutputError("Empty response from model.", usage);
      return {
        json: parseProviderJson(text, usage),
        usage
      };
    }
  },

  anthropic: {
    async listModels(settings) {
      if (!settings.anthropicKey) return [];
      const resp = await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=50", {
        headers: anthropicHeaders(settings.anthropicKey)
      }, 10000);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data || []).map((model) => ({ id: model.id, name: model.display_name || model.id }));
    },

    async classify(settings, system, user, schema) {
      const rich = {
        model: settings.model,
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: user }]
      };
      const plain = {
        model: settings.model,
        max_tokens: 4000,
        system: `${system}\n\nRespond with ONLY a JSON object matching this schema, no prose:\n${JSON.stringify(schema)}`,
        messages: [{ role: "user", content: user }]
      };

      let result = await anthropicRequest(settings.anthropicKey, rich);
      if (result.invalidParam) result = await anthropicRequest(settings.anthropicKey, plain);
      if (result.invalidParam) throw new Error(result.invalidParam);
      const data = result.data;
      const usage = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
      if (data.stop_reason === "refusal") throw providerOutputError("The model declined this request.", usage);
      const text = data.content?.find((block) => block.type === "text")?.text;
      if (!text) throw providerOutputError("Empty response from model.", usage);
      return {
        json: parseProviderJson(text, usage),
        usage
      };
    }
  },

  gemini: {
    async listModels(settings) {
      if (!settings.geminiKey) return [];
      const resp = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(settings.geminiKey)}`,
        {},
        10000
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      // The raw list is full of aliases (-001, -latest), previews, and
      // non-chat models (image/tts/embedding); keep one entry per real model.
      const noise = /(preview|exp|latest|image|imagen|tts|audio|live|embed|gemma|learnlm|aqa|thinking|robotics|-\d{3}$|-8b)/;
      const version = (id) => parseFloat(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] || "0");
      return (data.models || [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => {
          const id = model.name.replace(/^models\//, "");
          return { id, name: model.displayName || id };
        })
        .filter((model) => model.id.startsWith("gemini-") && !noise.test(model.id))
        .sort((a, b) => version(b.id) - version(a.id) || a.id.localeCompare(b.id));
    },

    async classify(settings, system, user, schema) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.geminiKey)}`;
      const resp = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(schema)
          }
        })
      }, PROVIDER_TIMEOUT_MS);
      const data = await readApiResponse(resp);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const usage = {
        input: data.usageMetadata?.promptTokenCount || 0,
        output: data.usageMetadata?.candidatesTokenCount || 0
      };
      if (!text) throw providerOutputError("Empty response from model.", usage);
      return {
        json: parseProviderJson(text, usage),
        usage
      };
    }
  },

  ollama: {
    async listModels(settings) {
      try {
        const resp = await fetchWithTimeout(`${normalizeOllamaUrl(settings.ollamaUrl)}/api/tags`, {}, 10000);
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        return (data.models || []).map((model) => ({ id: model.name, name: model.name }));
      } catch (error) {
        if (error?.name === "TimeoutError") throw error;
        throw ollamaConnectionError();
      }
    },

    async classify(settings, system, user, schema) {
      let resp;
      try {
        resp = await fetchWithTimeout(`${normalizeOllamaUrl(settings.ollamaUrl)}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user }
            ],
            stream: false,
            format: schema
          })
        }, OLLAMA_TIMEOUT_MS);
      } catch (error) {
        if (error?.name === "TimeoutError") throw error;
        throw ollamaConnectionError();
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || `Ollama error ${resp.status}`);
      }
      const data = await resp.json();
      const usage = { input: data.prompt_eval_count || 0, output: data.eval_count || 0 };
      if (!data.message?.content) throw providerOutputError("Empty response from model.", usage);
      return {
        json: parseProviderJson(data.message.content, usage),
        usage
      };
    }
  }
};

let spendQueue = Promise.resolve();

export async function callProvider(settings, system, user, schema) {
  await checkBudget(settings);
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error("Unknown AI provider.");
  try {
    // fetchWithTimeout only bounds time-to-headers; this bounds the whole call
    // so a stalled response body cannot wedge the job.
    const budgetMs = (settings.provider === "ollama" ? OLLAMA_TIMEOUT_MS : PROVIDER_TIMEOUT_MS) + 15 * 1000;
    const result = await withTimeout(provider.classify(settings, system, user, schema), budgetMs);
    await addSpend(settings, result.usage);
    return result.json;
  } catch (error) {
    if (error.usage) await addSpend(settings, error.usage);
    throw error;
  }
}

export async function ensureModel(settings) {
  if (settings.model) return settings;
  if (settings.provider !== "ollama") {
    settings.model = DEFAULT_MODELS[settings.provider];
    return settings;
  }
  const models = await PROVIDERS.ollama.listModels(settings);
  const model = models[0]?.id;
  if (!model) throw new Error("No Ollama models installed.");
  const modelByProvider = { ...settings.modelByProvider, ollama: model };
  await chrome.storage.sync.set({ modelByProvider });
  return { ...settings, model, modelByProvider };
}

export async function listModels(providerOverride) {
  let settings = await getSettings();
  const provider = providerOverride || settings.provider;
  settings = { ...settings, provider, model: settings.modelByProvider[provider] || DEFAULT_MODELS[provider] };
  const models = await PROVIDERS[provider].listModels(settings);
  return { models };
}

async function checkBudget(settings) {
  if (settings.provider === "ollama") return;
  const { spentUsd } = await chrome.storage.local.get({ spentUsd: 0 });
  const budget = Math.max(0, Number(settings.budgetUsd) || 0);
  if (Number(spentUsd) >= budget) {
    throw new Error(`Budget cap reached ($${Number(spentUsd).toFixed(2)} spent) — raise it in Settings.`);
  }
}

async function addSpend(settings, usage) {
  if (settings.provider === "ollama") return;
  const price = priceFor(settings.provider, settings.model);
  const cost = ((Number(usage?.input) || 0) * price.input + (Number(usage?.output) || 0) * price.output) / 1_000_000;
  if (!cost) return;
  spendQueue = spendQueue.then(async () => {
    const { spentUsd } = await chrome.storage.local.get({ spentUsd: 0 });
    await chrome.storage.local.set({ spentUsd: Number(spentUsd) + cost });
  });
  await spendQueue;
}

function priceFor(provider, model) {
  const match = (PRICES[provider] || [])
    .filter(([prefix]) => model.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? { input: match[1], output: match[2] } : { input: 10, output: 50 };
}

async function anthropicRequest(apiKey, body) {
  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body)
  }, PROVIDER_TIMEOUT_MS);
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    const message = data?.error?.message || `API error ${resp.status}`;
    if (resp.status === 400) return { invalidParam: message };
    throw new Error(message);
  }
  return { data: await resp.json() };
}

function anthropicHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };
}

async function readApiResponse(resp) {
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(data?.error?.message || data?.error || `API error ${resp.status}`);
  }
  return resp.json();
}

function toGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && Array.isArray(child) && child.includes("null")) {
      result.type = child.find((type) => type !== "null");
      result.nullable = true;
      continue;
    }
    result[key] = toGeminiSchema(child);
  }
  return result;
}

function normalizeOllamaUrl(value) {
  return String(value || DEFAULT_LOCAL.ollamaUrl).trim().replace(/\/+$/, "");
}

function ollamaConnectionError() {
  return new Error(`Can't reach Ollama — is it running with OLLAMA_ORIGINS="chrome-extension://*"?`);
}
