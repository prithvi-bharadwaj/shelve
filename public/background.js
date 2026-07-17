// Service worker: gathers tabs, classifies them with Claude, applies tab groups.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODELS_URL = "https://api.anthropic.com/v1/models";

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

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
          tabIds: { type: "array", items: { type: "integer" } }
        },
        required: ["name", "color", "tabIds"],
        additionalProperties: false
      }
    },
    needsContent: {
      type: "array",
      description: "Tab ids whose title+URL are too ambiguous to classify (e.g. twitter.com/home). Only fill this on the first pass.",
      items: { type: "integer" }
    }
  },
  required: ["groups", "needsContent"],
  additionalProperties: false
};

const DEFAULT_PREFS = {
  model: "claude-opus-4-8",
  minGroupSize: 2,
  groupEverything: false,
  reviewFirst: false
};

async function getSettings() {
  const [prefs, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_PREFS),
    chrome.storage.local.get({ apiKey: "" })
  ]);
  return { ...DEFAULT_PREFS, ...prefs, apiKey: local.apiKey };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    organize: () => organize(msg.hasContentPermission),
    applyPlan: () => applyPlan(msg.groups),
    mergeWindows: () => mergeWindows(msg.windowId),
    windowCount: () => windowCount(),
    listModels: () => listModels()
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // async response
});

async function organize(hasContentPermission) {
  const settings = await getSettings();
  if (!settings.apiKey) return { error: "No API key set — open Settings and paste your Anthropic API key." };

  const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
  // Skip tabs that are already in a group — only organize loose ones.
  const candidates = tabs.filter((t) => t.groupId === -1 && t.url && /^https?:/.test(t.url));
  if (candidates.length < 2) return { error: "Not enough ungrouped tabs to organize." };

  const tabInfo = candidates.map((t) => ({ id: t.id, title: t.title || "", url: t.url }));
  const candidateIds = new Set(tabInfo.map((t) => t.id));

  // Pass 1: titles + URLs only
  let plan = await classify(settings, tabInfo, {});

  // Pass 2: read page content for tabs the model flagged as ambiguous
  const ambiguous = (plan.needsContent || []).filter((id) => candidateIds.has(id));
  if (ambiguous.length > 0 && hasContentPermission) {
    const urlById = Object.fromEntries(tabInfo.map((t) => [t.id, t.url]));
    const snippets = {};
    await Promise.all(
      ambiguous.map(async (id) => {
        try {
          // Skip if the tab navigated away since we captured it
          const tab = await chrome.tabs.get(id);
          if (tab.url !== urlById[id]) return;
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: id },
            func: () => (document.body ? document.body.innerText.slice(0, 1500) : "")
          });
          if (result?.result) snippets[id] = result.result;
        } catch {
          // tab gone or not scriptable (chrome://, discarded, etc.) — skip
        }
      })
    );
    if (Object.keys(snippets).length > 0) {
      plan = await classify(settings, tabInfo, snippets);
    }
  }

  const minSize = settings.groupEverything ? 1 : settings.minGroupSize;
  const groups = sanitizePlan(plan, candidateIds, minSize);

  if (groups.length === 0) return { error: "No coherent groups found — tabs left as they are." };

  if (settings.reviewFirst) {
    const titleById = Object.fromEntries(tabInfo.map((t) => [t.id, t.title]));
    return {
      review: true,
      groups: groups.map((g) => ({ ...g, tabTitles: g.tabIds.map((id) => titleById[id] || "(tab)") }))
    };
  }

  return applyPlan(groups, minSize);
}

// Drop hallucinated/duplicate tab ids and undersized groups.
function sanitizePlan(plan, candidateIds, minSize) {
  const seen = new Set();
  const groups = [];
  for (const g of plan.groups || []) {
    const tabIds = [...new Set(g.tabIds)].filter((id) => candidateIds.has(id) && !seen.has(id));
    tabIds.forEach((id) => seen.add(id));
    if (tabIds.length >= minSize) groups.push({ name: g.name, color: g.color, tabIds });
  }
  return groups;
}

async function classify(settings, tabInfo, snippets) {
  const lines = tabInfo.map((t) => {
    let line = `[${t.id}] ${t.title}\n    ${t.url}`;
    if (snippets[t.id]) line += `\n    PAGE CONTENT: ${snippets[t.id].replace(/\s+/g, " ").slice(0, 1200)}`;
    return line;
  });
  const secondPass = Object.keys(snippets).length > 0;

  const system = `You organize browser tabs into Chrome tab groups by topic/intent.

Rules:
- Group tabs by what the user is actually doing, not just by website. Two YouTube tabs about different topics belong in different groups.
- Group names are short and specific: "O1 Visa", not "Immigration Stuff"; the actual research topic name, not "Research".
${settings.groupEverything
  ? "- Assign EVERY tab to a group. Use broad catch-all groups like 'Social' or 'Misc' for tabs that don't fit a specific theme."
  : "- Only create a group when 2+ tabs genuinely share a task or topic. Loose one-off tabs (random social browsing, messaging apps, a lone inspiration tab) should NOT be assigned to any group — omit them entirely."}
- Each tab id appears in at most one group.
- needsContent: ${secondPass ? "must be an empty array — page content was already provided." : "list tab ids where the title+URL alone don't reveal the topic (e.g. twitter.com/home, generic titles). Do NOT flag tabs whose title already tells you the topic (a YouTube video title is usually enough)."}`;

  const userMsg = `Here are my open tabs:\n\n${lines.join("\n")}`;

  // Latency-tuned request: no extended thinking, low effort — tab classification
  // doesn't need deep reasoning, and this cuts seconds off every click.
  // If the selected model rejects a parameter (older models don't support
  // effort / json_schema), retry with a plain prompt-based request.
  const rich = {
    model: settings.model,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    system,
    messages: [{ role: "user", content: userMsg }]
  };
  const plain = {
    model: settings.model,
    max_tokens: 4000,
    system: `${system}\n\nRespond with ONLY a JSON object matching this schema, no prose:\n${JSON.stringify(PLAN_SCHEMA)}`,
    messages: [{ role: "user", content: userMsg }]
  };

  let data = await request(settings.apiKey, rich);
  if (data.__invalidParam) data = await request(settings.apiKey, plain);
  if (data.__invalidParam) throw new Error(data.__invalidParam);

  if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from model.");
  const jsonStart = text.indexOf("{");
  return JSON.parse(jsonStart > 0 ? text.slice(jsonStart, text.lastIndexOf("}") + 1) : text);
}

async function request(apiKey, body) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: apiHeaders(apiKey),
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    const message = err?.error?.message || `API error ${resp.status}`;
    if (resp.status === 400) return { __invalidParam: message };
    throw new Error(message);
  }
  return resp.json();
}

function apiHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };
}

// Fetch the live model list so the options page never goes stale.
async function listModels() {
  const settings = await getSettings();
  if (!settings.apiKey) return { models: [] };
  const resp = await fetch(`${MODELS_URL}?limit=50`, { headers: apiHeaders(settings.apiKey) });
  if (!resp.ok) return { models: [] };
  const data = await resp.json();
  return {
    models: (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }))
  };
}

async function applyPlan(groups, minSize = 1) {
  let groupCount = 0;
  let tabCount = 0;
  for (const g of groups) {
    // Re-validate tab ids (tabs may have closed since planning)
    const liveIds = [];
    for (const id of g.tabIds) {
      try {
        await chrome.tabs.get(id);
        liveIds.push(id);
      } catch {
        /* tab gone */
      }
    }
    // A group that shrank to a single tab (others closed) is no longer a group
    if (liveIds.length < (minSize > 1 ? 2 : 1)) continue;
    const groupId = await chrome.tabs.group({ tabIds: liveIds });
    await chrome.tabGroups.update(groupId, {
      title: g.name,
      color: GROUP_COLORS.includes(g.color) ? g.color : "grey"
    });
    groupCount++;
    tabCount += liveIds.length;
  }
  if (groupCount === 0) return { error: "Tabs closed before groups could be created." };
  return { done: true, groupCount, tabCount };
}

async function windowCount() {
  const current = await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return { count: windows.filter((w) => w.incognito === current.incognito).length };
}

// Merge every other window (same profile only) into the target window —
// the one the popup was opened from — and keep it focused.
// Whole tab groups are moved intact via tabGroups.move; pinned tabs are re-pinned.
async function mergeWindows(targetWindowId) {
  const current = targetWindowId
    ? await chrome.windows.get(targetWindowId)
    : await chrome.windows.getCurrent();
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  const others = windows.filter((w) => w.id !== current.id && w.incognito === current.incognito);
  if (others.length === 0) return { error: "Only one window open." };

  let moved = 0;
  for (const win of others) {
    const groupIds = [...new Set(win.tabs.map((t) => t.groupId).filter((id) => id !== -1))];
    for (const groupId of groupIds) {
      await chrome.tabGroups.move(groupId, { windowId: current.id, index: -1 });
    }
    const loose = win.tabs.filter((t) => t.groupId === -1);
    for (const tab of loose) {
      await chrome.tabs.move(tab.id, { windowId: current.id, index: -1 });
      if (tab.pinned) await chrome.tabs.update(tab.id, { pinned: true });
      moved++;
    }
    moved += win.tabs.length - loose.length;
  }
  // Moving tabs can shift OS focus as source windows close — reclaim it.
  await chrome.windows.update(current.id, { focused: true });
  return { done: true, windows: others.length, tabs: moved };
}
