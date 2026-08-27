import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CUSTOM_INSTRUCTION_PLACEHOLDERS, useRotatingPlaceholder } from "@/lib/rotatingPlaceholders";
import { DataSection } from "@/options/DataSection";
import { ProviderSection, type Model } from "@/options/ProviderSection";
import { Divider, SectionHeading } from "@/options/section";
import { DEFAULT_SETTINGS, GROUP_NAME_STYLES, type Provider, type Settings } from "@/types";

const FALLBACK_MODELS: Record<Provider, Model[]> = {
  shelve: [{ id: "gemini-3.1-flash-lite", name: "Shelve Free (Gemini Flash Lite)" }],
  openai: [
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
  ],
  gemini: [
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  ollama: [],
};

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS.gemini);
  const [spentUsd, setSpentUsd] = useState(0);
  const [freeActionsRemaining, setFreeActionsRemaining] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [modelStatus, setModelStatus] = useState("");
  const customInstructionsPlaceholder = useRotatingPlaceholder(CUSTOM_INSTRUCTION_PLACEHOLDERS);
  // Request identity: a slow model-list response for a previously selected
  // provider (or an unmounted page) must never overwrite current state.
  const providerRef = useRef<Provider>(DEFAULT_SETTINGS.provider);
  const modelRequestRef = useRef(0);

  const refreshModels = async (provider: Provider) => {
    const generation = ++modelRequestRef.current;
    setModelStatus("Loading models…");
    let res: { models?: Model[]; error?: string } | null = null;
    try {
      res = await chrome.runtime.sendMessage({ type: "listModels", provider });
    } catch {
      res = null;
    }
    if (generation !== modelRequestRef.current || providerRef.current !== provider) return;
    if (res?.models?.length) {
      setModels(res.models);
      setModelStatus("");
      if (provider === "ollama") {
        setSettings((current) =>
          current.modelByProvider.ollama
            ? current
            : { ...current, modelByProvider: { ...current.modelByProvider, ollama: res.models![0].id } }
        );
      }
      return;
    }
    setModels(FALLBACK_MODELS[provider]);
    setModelStatus(res?.error || (provider === "ollama" ? "No installed models found." : "Using the built-in model list."));
  };

  useEffect(() => {
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes.spentUsd) {
        setSpentUsd(Number(changes.spentUsd.newValue) || 0);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    (async () => {
      // The worker owns the legacy "apiKey" → anthropicKey migration; wait for
      // it so this page never reads (or re-persists) the legacy field.
      await chrome.runtime.sendMessage({ type: "migrateLegacyCredential" }).catch(() => undefined);
      const { openaiKey, anthropicKey, geminiKey, ollamaUrl, ...prefs } = DEFAULT_SETTINGS;
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get({ ...prefs, model: "" }),
        chrome.storage.local.get({ openaiKey, anthropicKey, geminiKey, ollamaUrl, spentUsd: 0, freeActionsRemaining: "" }),
      ]);
      const modelByProvider = { ...DEFAULT_SETTINGS.modelByProvider, ...(sync.modelByProvider || {}) };
      if (sync.model && !sync.modelByProvider?.anthropic) modelByProvider.anthropic = sync.model;
      // Old default; carry users forward to the current fast model.
      if (modelByProvider.gemini === "gemini-2.5-flash-lite") modelByProvider.gemini = "gemini-3.1-flash-lite";
      const loaded: Settings = {
        ...DEFAULT_SETTINGS,
        ...sync,
        ...local,
        modelByProvider,
        groupNameStyle: GROUP_NAME_STYLES.includes(sync.groupNameStyle)
          ? sync.groupNameStyle
          : DEFAULT_SETTINGS.groupNameStyle,
      };
      providerRef.current = loaded.provider;
      setSettings(loaded);
      setSpentUsd(Number(local.spentUsd) || 0);
      setFreeActionsRemaining(String(local.freeActionsRemaining || "") || null);
      await refreshModels(loaded.provider);
    })();
    return () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
      // Invalidate any in-flight model request after unmount.
      modelRequestRef.current++;
    };
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const setModel = (value: string) =>
    setSettings((current) => ({
      ...current,
      modelByProvider: { ...current.modelByProvider, [current.provider]: value },
    }));

  const changeProvider = (provider: Provider) => {
    providerRef.current = provider;
    set("provider", provider);
    setModels(FALLBACK_MODELS[provider]);
    setModelStatus("");
    refreshModels(provider);
  };

  const save = async () => {
    const normalized: Settings = {
      ...settings,
      openaiKey: settings.openaiKey.trim(),
      anthropicKey: settings.anthropicKey.trim(),
      geminiKey: settings.geminiKey.trim(),
      ollamaUrl: settings.ollamaUrl.trim().replace(/\/+$/, "") || DEFAULT_SETTINGS.ollamaUrl,
      modelByProvider: Object.fromEntries(
        Object.entries(settings.modelByProvider).map(([provider, model]) => [provider, model.trim()])
      ) as Settings["modelByProvider"],
      customInstructions: settings.customInstructions.trim().slice(0, 2000),
      minGroupSize: clamp(settings.minGroupSize, 1, 6),
      budgetUsd: Math.max(0, Number(settings.budgetUsd) || 0),
    };
    setSettings(normalized);
    const { openaiKey, anthropicKey, geminiKey, ollamaUrl, ...prefs } = normalized;
    await Promise.all([
      chrome.storage.sync.set(prefs),
      chrome.storage.local.set({ openaiKey, anthropicKey, geminiKey, ollamaUrl }),
    ]);
    // Clearing the Anthropic field must stick even if a legacy key lingers.
    await chrome.storage.local.remove("apiKey").catch(() => undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    refreshModels(normalized.provider);
  };

  const resetSpend = async () => {
    await chrome.storage.local.set({ spentUsd: 0 });
    setSpentUsd(0);
  };

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <div className="mt-8 flex flex-col gap-6">
        <ProviderSection
          settings={settings}
          models={models}
          modelStatus={modelStatus}
          freeActionsRemaining={freeActionsRemaining}
          onChangeProvider={changeProvider}
          onSetModel={setModel}
          onSet={set}
        />

        <Divider />

        <section className="flex flex-col gap-5" aria-labelledby="behavior-heading">
          <SectionHeading id="behavior-heading">Behavior</SectionHeading>
          <SwitchRow
            id="review"
            label="Review before applying"
            description="Show proposed groups first."
            checked={settings.reviewFirst}
            onCheckedChange={(value) => set("reviewFirst", value)}
          />
          <SwitchRow
            id="everything"
            label="Group every tab"
            description="Off: loose one-off tabs are left untouched."
            checked={settings.groupEverything}
            onCheckedChange={(value) => set("groupEverything", value)}
          />
          <SwitchRow
            id="monochrome-labels"
            label="Monochrome group labels"
            description="Name new groups with a plain symbol (⚙︎ ✈︎ ★) when one fits."
            checked={settings.groupNameStyle === "monochrome"}
            onCheckedChange={(value) => set("groupNameStyle", value ? "monochrome" : "text")}
          />
          <SwitchRow
            id="emoji-labels"
            label="Emoji group labels"
            description="Name new groups with a single emoji when one fits."
            checked={settings.groupNameStyle === "emoji"}
            onCheckedChange={(value) => set("groupNameStyle", value ? "emoji" : "text")}
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="minSize">Minimum tabs per group</Label>
              <p className="mt-1 text-xs text-muted-foreground">Smaller new groups are dropped.</p>
            </div>
            <Input
              id="minSize"
              type="number"
              min={1}
              max={6}
              className="w-16 text-center"
              value={settings.minGroupSize}
              onChange={(event) => set("minGroupSize", clamp(parseInt(event.target.value, 10), 1, 6))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-4">
              <Label htmlFor="customInstructions">Custom instructions</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {settings.customInstructions.length}/2000
              </span>
            </div>
            <textarea
              id="customInstructions"
              rows={4}
              maxLength={2000}
              value={settings.customInstructions}
              onChange={(event) => set("customInstructions", event.target.value)}
              placeholder={customInstructionsPlaceholder}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">
              Applied to group names and grouping decisions every time you organize.
            </p>
          </div>
          <label htmlFor="dedupe" className="flex cursor-pointer items-start gap-3">
            <Checkbox
              id="dedupe"
              className="mt-0.5"
              checked={settings.dedupeOnOrganize}
              onCheckedChange={(value) => set("dedupeOnOrganize", value === true)}
            />
            <span>
              <span className="block text-sm font-medium leading-none">Close duplicate tabs when organizing</span>
              <span className="mt-1 block text-xs text-muted-foreground">Keeps the active or most recently used copy.</span>
            </span>
          </label>
          <label htmlFor="merge-on-organize" className="flex cursor-pointer items-start gap-3">
            <Checkbox
              id="merge-on-organize"
              className="mt-0.5"
              checked={settings.mergeOnOrganize}
              onCheckedChange={(value) => set("mergeOnOrganize", value === true)}
            />
            <span>
              <span className="block text-sm font-medium leading-none">Merge windows when organizing</span>
              <span className="mt-1 block text-xs text-muted-foreground">Brings all windows together first.</span>
            </span>
          </label>
        </section>

        <Divider />

        <section className="flex flex-col gap-4" aria-labelledby="budget-heading">
          <SectionHeading id="budget-heading">Budget</SectionHeading>
          <div className="flex flex-col gap-2">
            <Label htmlFor="budget">Spend cap ($)</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              step="0.01"
              value={settings.budgetUsd}
              onChange={(event) => set("budgetUsd", Math.max(0, Number(event.target.value) || 0))}
            />
            <p className="text-xs text-muted-foreground">Estimated from provider token usage. Ollama is free.</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs tabular-nums text-muted-foreground">Spent: ${spentUsd.toFixed(4)}</p>
            <Button variant="outline" size="sm" onClick={resetSpend}>Reset spend</Button>
          </div>
        </section>

        <Divider />

        <DataSection />

        <Divider />

        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          <span
            className={`text-sm text-muted-foreground transition-opacity duration-200 [transition-timing-function:var(--ease-out-strong)] ${saved ? "opacity-100" : "opacity-0"}`}
            aria-live="polite"
          >
            Saved
          </span>
        </div>
      </div>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
