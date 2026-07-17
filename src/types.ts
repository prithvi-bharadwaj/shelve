export type ProposedGroup = {
  name: string;
  color: string;
  tabIds: number[];
  tabTitles: string[];
  existingGroupId?: number | null;
  importance?: number;
};

export type OrganizeResponse = {
  error?: string;
  review?: boolean;
  groups?: ProposedGroup[];
  done?: boolean;
  groupCount?: number;
  tabCount?: number;
  windowId?: number;
  minSize?: number;
};

export type MergeResponse = {
  error?: string;
  done?: boolean;
  windows?: number;
  tabs?: number;
};

export type Provider = "openai" | "anthropic" | "gemini" | "ollama";

export type ModelByProvider = Record<Provider, string>;

export type Settings = {
  provider: Provider;
  modelByProvider: ModelByProvider;
  openaiKey: string;
  anthropicKey: string;
  geminiKey: string;
  ollamaUrl: string;
  minGroupSize: number;
  groupEverything: boolean;
  reviewFirst: boolean;
  dedupeOnOrganize: boolean;
  auto: "off" | "badge" | "auto";
  autoThreshold: number;
  budgetUsd: number;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  modelByProvider: {
    openai: "gpt-5.6-luna",
    anthropic: "claude-haiku-4-5",
    gemini: "gemini-2.5-flash-lite",
    ollama: "",
  },
  openaiKey: "",
  anthropicKey: "",
  geminiKey: "",
  ollamaUrl: "http://localhost:11434",
  minGroupSize: 2,
  groupEverything: false,
  reviewFirst: false,
  dedupeOnOrganize: false,
  auto: "off",
  autoThreshold: 15,
  budgetUsd: 1,
};
