// Service worker: gathers tabs, classifies them with the configured provider, and applies tab groups.

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const UNDO_KEY = "undoSnapshot";
const AUTO_GUARD_MS = 5 * 60 * 1000;

const DEFAULT_MODELS = {
  openai: "gpt-5.6-luna",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash-lite",
  ollama: ""
};

const DEFAULT_PREFS = {
  provider: "openai",
  modelByProvider: DEFAULT_MODELS,
  minGroupSize: 2,
  groupEverything: false,
  reviewFirst: false,
  dedupeOnOrganize: false,
  auto: "off",
  autoThreshold: 15,
  budgetUsd: 1
};

const DEFAULT_LOCAL = {
  openaiKey: "",
  anthropicKey: "",
  geminiKey: "",
  ollamaUrl: "http://localhost:11434",
  spentUsd: 0,
  apiKey: ""
};

// Nullable existingGroupId is required so OpenAI's strict schema can require every property.
// A null value means "create a new group" and is optional in the plan's semantics.
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short group name, 1-2 words, e.g. 'O1 Visa' or the specific research topic" },
          color: { type: "string", enum: GROUP_COLORS },
          tabIds: { type: "array", items: { type: "integer" } },
          existingGroupId: {
            type: ["integer", "null"],
            description: "An existing group id to join, or null to create a new group"
          },
          importance: {
            type: "integer",
            description: "Integer 1-5. 1 = deep work/productivity, 5 = entertainment/social"
          }
        },
        required: ["name", "color", "tabIds", "existingGroupId", "importance"],
        additionalProperties: false
      }
    },
    needsContent: {
      type: "array",
      description: "Tab ids whose title+URL are too ambiguous to classify. Only fill this on the first pass.",
      items: { type: "integer" }
    }
  },
  required: ["groups", "needsContent"],
  additionalProperties: false
};

// USD per one million input/output tokens. Longest matching model prefix wins.
const PRICES = {
  openai: [
    ["gpt-5.6-sol", 5, 30],
    ["gpt-5.6-terra", 2.5, 15],
    ["gpt-5.6-luna", 1, 6],
    ["gpt-5.4-mini", 0.75, 4.5],
    ["gpt-5.4-nano", 0.2, 1.25]
  ],
  anthropic: [
    ["claude-opus-4-8", 5, 25],
    ["claude-sonnet-5", 3, 15],
    ["claude-haiku-4-5", 1, 5],
    ["claude-fable-5", 10, 50]
  ],
  gemini: [
    ["gemini-2.5-flash-lite", 0.1, 0.4],
    ["gemini-2.5-flash", 0.3, 2.5],
    ["gemini-3.1-flash-lite", 0.25, 1.5],
    ["gemini-3.5-flash", 1.5, 9],
    ["gemini-2.5-pro", 1.25, 10]
  ],
  ollama: []
};

const PROVIDERS = {
  openai: {
    async listModels(settings) {
      if (!settings.openaiKey) return [];
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${settings.openaiKey}` }
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data || [])
        .map((model) => model.id)
        .filter((id) => id.startsWith("gpt-"))
        .sort()
        .map((id) => ({ id, name: id }));
    },

    async classify(settings, system, user, schema) {
      const resp = await fetch("https://api.openai.com/v1/responses", {
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
      });
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
      const resp = await fetch("https://api.anthropic.com/v1/models?limit=50", {
        headers: anthropicHeaders(settings.anthropicKey)
      });
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
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(settings.geminiKey)}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.models || [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => {
          const id = model.name.replace(/^models\//, "");
          return { id, name: model.displayName || id };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async classify(settings, system, user, schema) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.geminiKey)}`;
      const resp = await fetch(url, {
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
      });
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
        const resp = await fetch(`${normalizeOllamaUrl(settings.ollamaUrl)}/api/tags`);
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        return (data.models || []).map((model) => ({ id: model.name, name: model.name }));
      } catch {
        throw ollamaConnectionError();
      }
    },

    async classify(settings, system, user, schema) {
      let resp;
      try {
        resp = await fetch(`${normalizeOllamaUrl(settings.ollamaUrl)}/api/chat`, {
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
        });
      } catch {
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
let autoTimer = null;
const organizingWindows = new Set();

async function getSettings() {
  const [prefs, local] = await Promise.all([
    chrome.storage.sync.get({ ...DEFAULT_PREFS, model: "" }),
    chrome.storage.local.get(DEFAULT_LOCAL)
  ]);
  const modelByProvider = { ...DEFAULT_MODELS, ...(prefs.modelByProvider || {}) };
  if (prefs.model && !prefs.modelByProvider?.anthropic) modelByProvider.anthropic = prefs.model;
  return {
    ...DEFAULT_PREFS,
    ...prefs,
    ...local,
    anthropicKey: local.anthropicKey || local.apiKey || "",
    modelByProvider,
    model: modelByProvider[prefs.provider || DEFAULT_PREFS.provider]
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    organize: () => organize(msg.hasContentPermission, { windowId: msg.windowId }),
    applyPlan: () => applyPlan(msg.groups, msg.minSize || 1, { windowId: msg.windowId, snapshot: true }),
    ungroupAll: () => ungroupAll(msg.windowId),
    cleanDuplicates: () => cleanDuplicates(msg.windowId, { snapshot: true }),
    undo: () => undo(),
    hasUndo: () => hasUndo(),
    mergeWindows: () => mergeWindows(msg.windowId),
    windowCount: () => windowCount(),
    listModels: () => listModels(msg.provider),
    exportGroups: () => exportGroups(msg.windowId),
    importGroups: () => importGroups(msg.payload, msg.windowId)
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || "Something went wrong." }));
  return true;
});

async function organize(hasContentPermission, { automatic = false, windowId } = {}) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  if (organizingWindows.has(targetWindowId)) {
    return automatic ? { skipped: true } : { error: "Already organizing this window." };
  }
  organizingWindows.add(targetWindowId);

  try {
    let settings = await getSettings();
    if (!hasProviderAccess(settings)) {
      return automatic ? { skipped: true } : { error: missingCredentialMessage(settings.provider) };
    }
    settings = await ensureModel(settings);

    let dedupeMutated = false;
    if (settings.dedupeOnOrganize) {
      const result = await cleanDuplicates(targetWindowId, { snapshot: true });
      dedupeMutated = Boolean(result.closedCount);
    }

    const allTabs = await chrome.tabs.query({ windowId: targetWindowId });
    const candidates = allTabs.filter((tab) => !tab.pinned && tab.groupId === -1 && tab.url && /^https?:/.test(tab.url));
    const existingGroups = await getExistingGroupContext(targetWindowId, allTabs);
    if (candidates.length < 2 && !(candidates.length === 1 && existingGroups.length > 0)) {
      return { error: "Not enough ungrouped tabs to organize." };
    }

    const tabInfo = candidates.map((tab) => ({ id: tab.id, title: tab.title || "", url: tab.url }));
    const candidateIds = new Set(tabInfo.map((tab) => tab.id));
    const existingById = new Map(existingGroups.map((group) => [group.id, group]));

    let plan = await classifyTabs(settings, tabInfo, {}, existingGroups);
    const ambiguous = (plan.needsContent || []).filter((id) => candidateIds.has(id));
    if (ambiguous.length > 0 && hasContentPermission) {
      const urlById = Object.fromEntries(tabInfo.map((tab) => [tab.id, tab.url]));
      const snippets = {};
      await Promise.all(
        ambiguous.map(async (id) => {
          try {
            const tab = await chrome.tabs.get(id);
            if (tab.url !== urlById[id]) return;
            const [result] = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: () => (document.body ? document.body.innerText.slice(0, 1500) : "")
            });
            if (result?.result) snippets[id] = result.result;
          } catch {
            // The tab disappeared, navigated, or cannot be scripted.
          }
        })
      );
      if (Object.keys(snippets).length > 0) {
        plan = await classifyTabs(settings, tabInfo, snippets, existingGroups);
      }
    }

    const minSize = settings.groupEverything ? 1 : clamp(settings.minGroupSize, 1, 6);
    const groups = sanitizePlan(plan, candidateIds, existingById, minSize);
    if (groups.length === 0) return { error: "No coherent groups found — tabs left as they are." };

    if (settings.reviewFirst && !automatic) {
      const titleById = Object.fromEntries(tabInfo.map((tab) => [tab.id, tab.title]));
      return {
        review: true,
        windowId: targetWindowId,
        minSize,
        groups: groups.map((group) => ({
          ...group,
          tabTitles: group.tabIds.map((id) => titleById[id] || "(tab)")
        }))
      };
    }

    return applyPlan(groups, minSize, { windowId: targetWindowId, snapshot: !dedupeMutated });
  } finally {
    organizingWindows.delete(targetWindowId);
  }
}

function sanitizePlan(plan, candidateIds, existingById, minSize) {
  const seen = new Set();
  const groups = [];
  const existingIndexes = new Map();
  for (const raw of plan.groups || []) {
    const tabIds = [...new Set(Array.isArray(raw.tabIds) ? raw.tabIds : [])].filter(
      (id) => candidateIds.has(id) && !seen.has(id)
    );
    const existing = Number.isInteger(raw.existingGroupId) ? existingById.get(raw.existingGroupId) : null;
    const requiredSize = existing ? 1 : minSize;
    if (tabIds.length < requiredSize) continue;
    tabIds.forEach((id) => seen.add(id));
    const sanitized = {
      name: existing?.title || String(raw.name || "Tabs").slice(0, 80),
      color: existing?.color || (GROUP_COLORS.includes(raw.color) ? raw.color : "grey"),
      tabIds,
      existingGroupId: existing?.id ?? null,
      importance: clamp(Number(raw.importance) || 3, 1, 5)
    };
    if (existing && existingIndexes.has(existing.id)) {
      const group = groups[existingIndexes.get(existing.id)];
      group.tabIds.push(...tabIds);
      group.importance = Math.min(group.importance, sanitized.importance);
    } else {
      if (existing) existingIndexes.set(existing.id, groups.length);
      groups.push(sanitized);
    }
  }
  return groups;
}

async function classifyTabs(settings, tabInfo, snippets, existingGroups) {
  const lines = tabInfo.map((tab) => {
    let line = `[${tab.id}] ${tab.title}\n    ${tab.url}`;
    if (snippets[tab.id]) line += `\n    PAGE CONTENT: ${snippets[tab.id].replace(/\s+/g, " ").slice(0, 1200)}`;
    return line;
  });
  const secondPass = Object.keys(snippets).length > 0;
  const existingText = existingGroups.length
    ? `\nExisting groups are listed in the user message. You may add a loose tab to one by setting existingGroupId to that integer id. When you do, name and color are ignored. Never return the ids of tabs already in a group.`
    : "\nThere are no existing groups. Set existingGroupId to null for every group.";

  const system = `You organize browser tabs into Chrome tab groups by topic/intent.

Rules:
- Group tabs by what the user is actually doing, not just by website. Two YouTube tabs about different topics belong in different groups.
- Group names are short and specific: "O1 Visa", not "Immigration Stuff"; the actual research topic name, not "Research".
${settings.groupEverything
  ? "- Assign EVERY loose tab to a group. Use broad catch-all groups like 'Social' or 'Misc' only when needed."
  : `- Only create a new group when at least ${clamp(settings.minGroupSize, 1, 6)} tabs genuinely share a task or topic. Loose one-off tabs should be omitted, but a single loose tab may join a relevant existing group.`}
- Each loose tab id appears in at most one group.
- Set importance from 1 (deep work/productivity) through 5 (entertainment/social).
- needsContent: ${secondPass ? "must be an empty array — page content was already provided." : "list tab ids where title+URL do not reveal the topic. Do not flag tabs whose title already tells you the topic."}${existingText}`;

  const existing = existingGroups.length
    ? `\n\nExisting groups:\n${JSON.stringify(existingGroups)}`
    : "";
  const user = `Here are my loose open tabs:\n\n${lines.join("\n")}${existing}`;
  return callProvider(settings, system, user, PLAN_SCHEMA);
}

async function callProvider(settings, system, user, schema) {
  await checkBudget(settings);
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error("Unknown AI provider.");
  try {
    const result = await provider.classify(settings, system, user, schema);
    await addSpend(settings, result.usage);
    return result.json;
  } catch (error) {
    if (error.usage) await addSpend(settings, error.usage);
    throw error;
  }
}

async function ensureModel(settings) {
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

function hasProviderAccess(settings) {
  if (settings.provider === "ollama") return true;
  return Boolean(settings[`${settings.provider}Key`]);
}

function missingCredentialMessage(provider) {
  const names = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };
  return `No ${names[provider] || "provider"} API key set — open Settings and add one.`;
}

async function listModels(providerOverride) {
  let settings = await getSettings();
  const provider = providerOverride || settings.provider;
  settings = { ...settings, provider, model: settings.modelByProvider[provider] || DEFAULT_MODELS[provider] };
  const models = await PROVIDERS[provider].listModels(settings);
  return { models };
}

async function applyPlan(groups, minSize = 1, { windowId, snapshot = true } = {}) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const prepared = [];
  for (const group of groups || []) {
    const liveIds = [];
    for (const id of group.tabIds || []) {
      try {
        const tab = await chrome.tabs.get(id);
        if (tab.windowId === targetWindowId && tab.groupId === -1 && !tab.pinned) liveIds.push(id);
      } catch {
        // Tab closed while the review or model request was open.
      }
    }
    const existingGroupId = await validExistingGroupId(group.existingGroupId, targetWindowId);
    const requiredSize = existingGroupId !== null ? 1 : Math.max(1, minSize);
    if (liveIds.length >= requiredSize) prepared.push({ ...group, tabIds: liveIds, existingGroupId });
  }
  if (prepared.length === 0) return { error: "Tabs closed or moved before groups could be created." };

  if (snapshot) await storeUndoSnapshot(await captureSnapshot(targetWindowId));

  let groupCount = 0;
  let tabCount = 0;
  const newGroups = [];
  for (const group of prepared) {
    if (group.existingGroupId !== null) {
      await chrome.tabs.group({ tabIds: group.tabIds, groupId: group.existingGroupId });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: group.tabIds });
      await chrome.tabGroups.update(groupId, {
        title: group.name,
        color: GROUP_COLORS.includes(group.color) ? group.color : "grey"
      });
      newGroups.push({ id: groupId, importance: clamp(Number(group.importance) || 3, 1, 5) });
    }
    groupCount++;
    tabCount += group.tabIds.length;
  }
  await orderTabStrip(targetWindowId, newGroups);
  scheduleAutoCheck();
  return { done: true, groupCount, tabCount };
}

async function validExistingGroupId(groupId, windowId) {
  if (!Number.isInteger(groupId)) return null;
  try {
    const group = await chrome.tabGroups.get(groupId);
    return group.windowId === windowId ? groupId : null;
  } catch {
    return null;
  }
}

async function orderTabStrip(windowId, newGroups) {
  let tabs = await chrome.tabs.query({ windowId });
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const newIds = new Set(newGroups.map((group) => group.id));
  const existingIds = [...new Set(tabs.filter((tab) => tab.groupId !== -1 && !newIds.has(tab.groupId)).map((tab) => tab.groupId))]
    .sort((a, b) => firstGroupIndex(tabs, a) - firstGroupIndex(tabs, b));
  const orderedIds = [
    ...newGroups.sort((a, b) => a.importance - b.importance).map((group) => group.id),
    ...existingIds
  ];

  let index = pinnedCount;
  for (const groupId of orderedIds) {
    try {
      await chrome.tabGroups.move(groupId, { index });
      const members = await chrome.tabs.query({ windowId, groupId });
      index += members.length;
    } catch {
      // A group can disappear if its tabs close during ordering.
    }
  }

  tabs = await chrome.tabs.query({ windowId });
  const looseIds = tabs
    .filter((tab) => !tab.pinned && tab.groupId === -1)
    .sort((a, b) => a.index - b.index)
    .map((tab) => tab.id);
  if (looseIds.length) await chrome.tabs.move(looseIds, { index: -1 });
}

function firstGroupIndex(tabs, groupId) {
  return Math.min(...tabs.filter((tab) => tab.groupId === groupId).map((tab) => tab.index));
}

async function ungroupAll(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const ids = tabs.filter((tab) => tab.groupId !== -1).map((tab) => tab.id);
  if (!ids.length) return { error: "No grouped tabs in this window." };
  await storeUndoSnapshot(await captureSnapshot(targetWindowId));
  await chrome.tabs.ungroup(ids);
  scheduleAutoCheck();
  return { done: true, tabCount: ids.length };
}

async function cleanDuplicates(windowId, { snapshot = true } = {}) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const byUrl = new Map();
  for (const tab of tabs) {
    const url = normalizedDuplicateUrl(tab.url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(tab);
  }

  const toClose = [];
  for (const duplicates of byUrl.values()) {
    if (duplicates.length < 2) continue;
    const protectedTabs = duplicates.filter((tab) => tab.pinned || tab.active);
    const keep = new Set(protectedTabs.map((tab) => tab.id));
    if (!keep.size) {
      const newest = [...duplicates].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      keep.add(newest.id);
    }
    toClose.push(...duplicates.filter((tab) => !keep.has(tab.id)));
  }
  if (!toClose.length) return { done: true, closedCount: 0 };

  if (snapshot) {
    const captured = await captureSnapshot(targetWindowId);
    captured.closedUrls = toClose.map((tab) => tab.url).filter(Boolean);
    captured.closedTabIds = toClose.map((tab) => tab.id);
    await storeUndoSnapshot(captured);
  }
  await chrome.tabs.remove(toClose.map((tab) => tab.id));
  scheduleAutoCheck();
  return { done: true, closedCount: toClose.length };
}

function normalizedDuplicateUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function captureSnapshot(windowId) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  return {
    windowId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      url: tab.url || "",
      index: tab.index,
      pinned: Boolean(tab.pinned),
      groupId: tab.groupId
    })),
    groups: groups.map((group) => ({ id: group.id, title: group.title || "", color: group.color })),
    closedUrls: [],
    closedTabIds: []
  };
}

async function storeUndoSnapshot(snapshot) {
  try {
    if (!chrome.storage.session) throw new Error();
    await chrome.storage.session.set({ [UNDO_KEY]: snapshot });
    await chrome.storage.local.remove(UNDO_KEY);
  } catch {
    await chrome.storage.local.set({ [UNDO_KEY]: snapshot });
  }
}

async function getUndoSnapshot() {
  try {
    if (chrome.storage.session) {
      const session = await chrome.storage.session.get(UNDO_KEY);
      if (session[UNDO_KEY]) return session[UNDO_KEY];
    }
  } catch {
    // Fall through to local storage.
  }
  const local = await chrome.storage.local.get(UNDO_KEY);
  return local[UNDO_KEY] || null;
}

async function clearUndoSnapshot() {
  const tasks = [chrome.storage.local.remove(UNDO_KEY)];
  if (chrome.storage.session) tasks.push(chrome.storage.session.remove(UNDO_KEY).catch(() => undefined));
  await Promise.all(tasks);
}

async function hasUndo() {
  return { hasUndo: Boolean(await getUndoSnapshot()) };
}

async function undo() {
  const snapshot = await getUndoSnapshot();
  if (!snapshot) return { error: "Nothing to undo." };

  const idMap = new Map();
  const closedIds = snapshot.closedTabIds || [];
  for (let i = 0; i < (snapshot.closedUrls || []).length; i++) {
    const url = snapshot.closedUrls[i];
    try {
      const tab = await chrome.tabs.create({ windowId: snapshot.windowId, url, active: false });
      if (closedIds[i] !== undefined) idMap.set(closedIds[i], tab.id);
    } catch {
      // Invalid or no longer permitted URL; continue restoring the rest.
    }
  }

  const restored = [];
  for (const original of snapshot.tabs || []) {
    const id = idMap.get(original.id) || original.id;
    try {
      const tab = await chrome.tabs.get(id);
      if (tab.windowId === snapshot.windowId) restored.push({ original, id, tab });
    } catch {
      // A tab closed after the action cannot be restored without a closed URL record.
    }
  }

  const groupedIds = restored.filter((item) => item.tab.groupId !== -1).map((item) => item.id);
  if (groupedIds.length) await chrome.tabs.ungroup(groupedIds).catch(() => undefined);

  for (const item of restored) {
    if (item.tab.pinned !== item.original.pinned) {
      await chrome.tabs.update(item.id, { pinned: item.original.pinned }).catch(() => undefined);
    }
  }
  for (const item of [...restored].sort((a, b) => a.original.index - b.original.index)) {
    await chrome.tabs.move(item.id, { index: item.original.index }).catch(() => undefined);
  }

  const groupMeta = new Map((snapshot.groups || []).map((group) => [group.id, group]));
  const membersByGroup = new Map();
  for (const item of restored) {
    if (item.original.groupId === -1 || item.original.pinned) continue;
    if (!membersByGroup.has(item.original.groupId)) membersByGroup.set(item.original.groupId, []);
    membersByGroup.get(item.original.groupId).push(item);
  }
  for (const [oldGroupId, members] of membersByGroup) {
    try {
      const newGroupId = await chrome.tabs.group({ tabIds: members.map((item) => item.id) });
      const meta = groupMeta.get(oldGroupId);
      if (meta) await chrome.tabGroups.update(newGroupId, { title: meta.title, color: meta.color });
      const index = Math.min(...members.map((item) => item.original.index));
      await chrome.tabGroups.move(newGroupId, { index });
    } catch {
      // Restore as much as possible if a tab changes during undo.
    }
  }

  await clearUndoSnapshot();
  scheduleAutoCheck();
  return { done: true, tabCount: restored.length, reopenedCount: idMap.size };
}

async function exportGroups(windowId) {
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: targetWindowId }),
    chrome.tabGroups.query({ windowId: targetWindowId })
  ]);
  const groupOrder = [...groups].sort((a, b) => firstGroupIndex(tabs, a.id) - firstGroupIndex(tabs, b.id));
  return {
    version: 1,
    groups: groupOrder.map((group) => ({
      name: group.title || "Tabs",
      color: group.color,
      urls: tabs.filter((tab) => tab.groupId === group.id && tab.url).sort((a, b) => a.index - b.index).map((tab) => tab.url)
    }))
  };
}

async function importGroups(payload, windowId) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!data || data.version !== 1 || !Array.isArray(data.groups)) {
    return { error: "Invalid Regroup JSON." };
  }
  const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;
  let groupCount = 0;
  let tabCount = 0;
  for (const group of data.groups) {
    if (!group || !Array.isArray(group.urls)) continue;
    const tabIds = [];
    for (const value of group.urls) {
      if (!safeImportUrl(value)) continue;
      try {
        const tab = await chrome.tabs.create({ windowId: targetWindowId, url: value, active: false });
        tabIds.push(tab.id);
      } catch {
        // Skip URLs the browser refuses to open.
      }
    }
    if (!tabIds.length) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: String(group.name || "Tabs").slice(0, 80),
      color: GROUP_COLORS.includes(group.color) ? group.color : "grey"
    });
    groupCount++;
    tabCount += tabIds.length;
  }
  scheduleAutoCheck();
  return { done: true, groupCount, tabCount };
}

function safeImportUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol !== "javascript:" && protocol !== "data:";
  } catch {
    return false;
  }
}

async function getExistingGroupContext(windowId, tabs) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.map((group) => ({
    id: group.id,
    title: group.title || "Untitled",
    color: group.color,
    tabs: tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.title || "")
  }));
}

async function windowCount() {
  const current = await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return { count: windows.filter((window) => window.incognito === current.incognito).length };
}

// Merge every other same-profile window into the popup's window and retain whole groups.
async function mergeWindows(targetWindowId) {
  const current = targetWindowId ? await chrome.windows.get(targetWindowId) : await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  const others = windows.filter((window) => window.id !== current.id && window.incognito === current.incognito);
  if (!others.length) return { error: "Only one window open." };

  let moved = 0;
  for (const window of others) {
    const groupIds = [...new Set(window.tabs.map((tab) => tab.groupId).filter((id) => id !== -1))];
    for (const groupId of groupIds) {
      await chrome.tabGroups.move(groupId, { windowId: current.id, index: -1 });
    }
    const loose = window.tabs.filter((tab) => tab.groupId === -1);
    for (const tab of loose) {
      await chrome.tabs.move(tab.id, { windowId: current.id, index: -1 });
      if (tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      moved++;
    }
    moved += window.tabs.length - loose.length;
  }
  await chrome.windows.update(current.id, { focused: true });
  scheduleAutoCheck();
  return { done: true, windows: others.length, tabs: moved };
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

function scheduleAutoCheck() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    refreshAutoState().catch(() => undefined);
  }, 2000);
}

async function refreshAutoState() {
  const settings = await getSettings();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const threshold = Math.max(1, Number(settings.autoThreshold) || 15);
  let lastAutoRun = (await chrome.storage.local.get({ lastAutoRun: 0 })).lastAutoRun;

  for (const window of windows) {
    const tabs = await chrome.tabs.query({ windowId: window.id });
    const count = tabs.filter((tab) => tab.groupId === -1 && tab.url && /^https?:/.test(tab.url)).length;
    const showBadge = settings.auto !== "off" && count >= threshold;
    await Promise.all(
      tabs.map((tab) => chrome.action.setBadgeText({ tabId: tab.id, text: showBadge ? String(count) : "" }).catch(() => undefined))
    );

    if (settings.auto !== "auto" || count < threshold || Date.now() - lastAutoRun < AUTO_GUARD_MS) continue;
    if (!hasProviderAccess(settings)) continue;
    lastAutoRun = Date.now();
    await chrome.storage.local.set({ lastAutoRun });
    const hasContentPermission = await chrome.permissions.contains({
      permissions: ["scripting"],
      origins: ["<all_urls>"]
    });
    await organize(hasContentPermission, { automatic: true, windowId: window.id }).catch(() => undefined);
  }
}

chrome.tabs.onCreated.addListener(scheduleAutoCheck);
chrome.tabs.onRemoved.addListener(scheduleAutoCheck);
chrome.tabs.onUpdated.addListener(scheduleAutoCheck);
chrome.runtime.onInstalled.addListener(scheduleAutoCheck);
chrome.runtime.onStartup.addListener(scheduleAutoCheck);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.auto || changes.autoThreshold)) scheduleAutoCheck();
});
scheduleAutoCheck();

async function anthropicRequest(apiKey, body) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body)
  });
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

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("The model returned invalid JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

function parseProviderJson(text, usage) {
  try {
    return parseJson(text);
  } catch (error) {
    error.usage = usage;
    throw error;
  }
}

function providerOutputError(message, usage) {
  const error = new Error(message);
  error.usage = usage;
  return error;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
