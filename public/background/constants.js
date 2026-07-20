// Shared constants, defaults, and provider JSON schemas.

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
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

export const DEFAULT_MODELS = {
  openai: "gpt-5.6-luna",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-3.1-flash-lite",
  ollama: ""
};

export const DEFAULT_PREFS = {
  provider: "gemini",
  modelByProvider: DEFAULT_MODELS,
  minGroupSize: 2,
  groupEverything: false,
  reviewFirst: false,
  dedupeOnOrganize: false,
  customInstructions: "",
  budgetUsd: 1
};

export const DEFAULT_LOCAL = {
  openaiKey: "",
  anthropicKey: "",
  geminiKey: "",
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
