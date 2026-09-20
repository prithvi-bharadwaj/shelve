// Shared constants, defaults, and provider JSON schemas.

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
export const GROUP_NAME_STYLES = ["text", "monochrome", "emoji"];
export const LEGACY_UNDO_KEY = "undoSnapshot";
export const UNDO_KEY_PREFIX = "undoSnapshot:v2:";
export const STASH_KEY = "stashes";
export const ORGANIZE_JOB_PREFIX = "organizeJob:";
export const ORGANIZE_RESULT_TTL_MS = 5 * 60 * 1000;
export const PROVIDER_TIMEOUT_MS = 45 * 1000;
export const OLLAMA_TIMEOUT_MS = 90 * 1000;
export const SNIPPET_TIMEOUT_MS = 8 * 1000;
export const ORGANIZE_STALE_MS = 2 * 60 * 1000;
export const STASH_RESUME_STALE_MS = 2 * 60 * 1000;

// TypeSafe "Jev" decision model: typed answers only, never generated text.
// Pinned so a model update can't silently shift the thresholds below.
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
// Hosted Jev access for users without their own key; metered by install token,
// same CORS-served project as SHELVE_PROXY_URL (never a host_permission).
export const SHELVE_DECIDE_URL = "https://shelve-api.vercel.app/api/decide";
export const TYPESAFE_ORIGIN = "https://api.typesafe.ai/*";
export const JEV_MODEL = "jev-1.13.0";
export const JEV_TIMEOUT_MS = 8 * 1000;
export const JEV_MAX_RETRIES = 2;
// State and questions share ~32k tokens; estimated at 4 chars per token with
// headroom. Bigger requests skip Jev and use the LLM path.
export const JEV_MAX_REQUEST_CHARS = 100 * 1000;
export const JEV_CHOICE_CHUNK = 250;
export const DECISION_PROVIDERS = ["llm", "typesafe"];
// action/destructiveAction/compound held up on scripts/eval-commands.mjs (50
// commands, 2026-09). match* come from scripts/eval-tab-selection.mjs: over 3
// runs of 40 cases wanted tabs scored >= 0.76 and unwanted <= 0.64, and every
// bad selection had 4+ tabs in the unsure band (113 of 117 good ones had none).
// Re-run both whenever the fixtures, wording, or JEV_MODEL change.
export const JEV_THRESHOLDS = {
  action: 0.5,
  destructiveAction: 0.8,
  match: 0.7,
  matchUnsureFloor: 0.4,
  matchUnsureCeil: 0.75,
  matchUnsureMax: 2,
  merge: 0.5,
  allGroups: 0.5,
  needsContent: 0.5,
  compound: 0.7,
  // Organize: a loose tab joins an existing group only on a confident pick.
  file: 0.7
};
export const JEV_DESTRUCTIVE_ACTIONS = ["ungroup", "merge_groups", "remove_duplicates"];

// Dedicated API project — no manifest host permission on purpose: the proxy
// serves CORS headers, and adding a new host_permission in an update would
// disable the extension for every user until they re-approve it.
export const SHELVE_PROXY_URL = "https://shelve-api.vercel.app/api/generate";

// Payments scaffold — built but not enabled. Flipping this on requires a live
// Stripe account and the Checkout URL below. Entitlement is never decided in
// the extension: the Stripe webhook (shelve-site/api/stripe-webhook.mjs)
// verifies payment server-side and writes paid:<token> to KV, which the proxy
// trusts on every request.
export const PAYMENTS_ENABLED = false;
// TODO(stripe-payment-link): set to the live Stripe Payment Link once the
// Stripe account exists. The install token is appended as
// ?client_reference_id={installToken} so the webhook can attribute payments.
export const STRIPE_CHECKOUT_URL = "";

export const DEFAULT_MODELS = {
  shelve: "gemini-3.1-flash-lite",
  openai: "gpt-5.6-luna",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-3.1-flash-lite",
  ollama: ""
};

export const DEFAULT_PREFS = {
  provider: "shelve",
  modelByProvider: DEFAULT_MODELS,
  minGroupSize: 2,
  groupEverything: false,
  groupNameStyle: "text",
  reviewFirst: false,
  dedupeOnOrganize: false,
  mergeOnOrganize: false,
  customInstructions: "",
  budgetUsd: 1,
  decisionProvider: "llm"
};

export const DEFAULT_LOCAL = {
  openaiKey: "",
  anthropicKey: "",
  geminiKey: "",
  typesafeKey: "",
  ollamaUrl: "http://localhost:11434",
  spentUsd: 0
};

// Nullable existingGroupId is required so OpenAI's strict schema can require every property.
// A null value means "create a new group" and is optional in the plan's semantics.
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short group label following the selected text, monochrome-symbol, or emoji naming rule" },
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

export const COMMAND_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["open_tab", "answer", "create_group", "add_to_group", "update_group", "ungroup", "remove_duplicates", "merge_groups", "not_found"],
      description: "The single browser action that best matches the command."
    },
    tabId: {
      type: ["integer", "null"],
      description: "The tab to open, or the tab that best supports the answer. Null when nothing matches."
    },
    reply: {
      type: "string",
      description: "answer: one concise sentence. not_found: what was searched and that it wasn't found. Empty for open_tab and mutating actions."
    },
    tabIds: {
      type: "array",
      description: "create_group or add_to_group only: every eligible tab id that belongs in the requested group. Empty for other actions.",
      items: { type: "integer" }
    },
    groupIds: {
      type: "array",
      description: "ungroup, merge_groups, update_group, or add_to_group (single destination) only: current-window group ids selected by the command. Empty for other actions.",
      items: { type: "integer" }
    },
    allGroups: {
      type: "boolean",
      description: "ungroup only: true when the user explicitly asks to ungroup all groups; false otherwise."
    },
    groupName: {
      type: "string",
      description: "create_group or merge_groups: a short, specific 1-3 word destination group name. update_group: the new name, or empty to keep the current name. Empty for other actions."
    },
    color: {
      type: "string",
      enum: GROUP_COLORS,
      description: "Chrome color for create_group or merge_groups. update_group: the requested color, or the group's current color when only renaming. Use grey for other actions."
    },
    needsContent: {
      type: "array",
      description: "First pass only: up to 6 tab ids whose page content is needed to answer. Empty otherwise.",
      items: { type: "integer" }
    }
  },
  required: ["action", "tabId", "reply", "tabIds", "groupIds", "allGroups", "groupName", "color", "needsContent"],
  additionalProperties: false
};

export const GROUP_NAME_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "A short, specific 1-3 word tab group name." }
  },
  required: ["name"],
  additionalProperties: false
};

export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    brief: {
      type: "string",
      description: "1-2 sentence 'where you left off' brief, second person, leading with concrete details."
    }
  },
  required: ["brief"],
  additionalProperties: false
};

// USD per one million input/output tokens. Longest matching model prefix wins.
export const PRICES = {
  // Hosted free tier runs on Shelve's own key; user-visible spend is always $0.
  shelve: [],
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
  ollama: [],
  // Jev bills input only.
  typesafe: [["jev", 0.042, 0]]
};
