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
  jobId?: string;
  running?: boolean;
  job?: OrganizeJob;
  review?: boolean;
  groups?: ProposedGroup[];
  done?: boolean;
  groupCount?: number;
  tabCount?: number;
  windowId?: number;
  minSize?: number;
};

export type OrganizeStage = "collecting" | "classifying" | "reading" | "applying";

export type OrganizeJob = {
  id: string;
  status: "running" | "done" | "error";
  stage: OrganizeStage;
  startedAt: number;
  updatedAt: number;
  tabCount: number;
  result?: OrganizeResponse;
  error?: string;
};

export type GroupInfo = {
  id: number;
  title: string;
  color: string;
  tabCount: number;
};

export type Stash = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  tabCount: number;
  brief: string;
  briefStatus: "pending" | "ready" | "unavailable";
};

export type CommandResponse = {
  error?: string;
  done?: boolean;
  action?: "open_tab" | "answer" | "not_found";
  reply?: string;
  tabId?: number | null;
  tabTitle?: string;
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
  customInstructions: string;
  auto: "off" | "badge" | "auto";
  autoThreshold: number;
  budgetUsd: number;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "gemini",
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
  customInstructions: "",
  auto: "off",
  autoThreshold: 15,
  budgetUsd: 1,
};
