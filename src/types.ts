export type ProposedGroup = {
  name: string;
  color: string;
  tabIds: number[];
  tabTitles: string[];
};

export type OrganizeResponse = {
  error?: string;
  review?: boolean;
  groups?: ProposedGroup[];
  done?: boolean;
  groupCount?: number;
  tabCount?: number;
};

export type MergeResponse = {
  error?: string;
  done?: boolean;
  windows?: number;
  tabs?: number;
};

export type Settings = {
  apiKey: string;
  model: string;
  minGroupSize: number;
  groupEverything: boolean;
  reviewFirst: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-opus-4-8",
  minGroupSize: 2,
  groupEverything: false,
  reviewFirst: false,
};
