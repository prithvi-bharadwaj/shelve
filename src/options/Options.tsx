import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CUSTOM_INSTRUCTION_PLACEHOLDERS, useRotatingPlaceholder } from "@/lib/rotatingPlaceholders";
import { DEFAULT_SETTINGS, type Provider, type Settings } from "@/types";

type Model = { id: string; name: string };

const FALLBACK_MODELS: Record<Provider, Model[]> = {
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

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
};

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS.gemini);
  const [spentUsd, setSpentUsd] = useState(0);
  const [saved, setSaved] = useState(false);
  const [modelStatus, setModelStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [dataStatus, setDataStatus] = useState<{ text: string; error?: boolean } | null>(null);
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
        chrome.storage.local.get({ openaiKey, anthropicKey, geminiKey, ollamaUrl, spentUsd: 0 }),
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
      };
      providerRef.current = loaded.provider;
      setSettings(loaded);
      setSpentUsd(Number(local.spentUsd) || 0);
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

  const exportData = async () => {
    setDataStatus(null);
    const window = await chrome.windows.getCurrent();
    const data = await chrome.runtime.sendMessage({ type: "exportGroups", windowId: window.id });
    if (data?.error) {
      setDataStatus({ text: data.error, error: true });
      return;
    }
    const json = JSON.stringify(data, null, 2);
    let copied = true;
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      copied = false;
    }
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "focused.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setDataStatus({ text: copied ? "Copied and downloaded focused.json" : "Downloaded focused.json; clipboard unavailable" });
  };

  const importData = async () => {
    setDataStatus(null);
    let payload: unknown;
    try {
      payload = JSON.parse(importText);
    } catch {
      setDataStatus({ text: "Paste valid Focused JSON.", error: true });
      return;
    }
    const window = await chrome.windows.getCurrent();
    const res = await chrome.runtime.sendMessage({ type: "importGroups", payload, windowId: window.id });
    setDataStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `Imported ${res.groupCount} group${res.groupCount === 1 ? "" : "s"} · ${res.tabCount} tabs` }
    );
  };

  const activeModel = settings.modelByProvider[settings.provider];
  const modelInList = models.some((model) => model.id === activeModel);

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <div className="mt-8 flex flex-col gap-6">
        <section className="flex flex-col gap-4" aria-labelledby="provider-heading">
          <SectionHeading id="provider-heading">Provider</SectionHeading>
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider">AI provider</Label>
            <Select value={settings.provider} onValueChange={(value) => changeProvider(value as Provider)}>
              <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_NAMES).map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {settings.provider === "openai" && (
            <CredentialField
              id="openaiKey"
              label="OpenAI API key"
              placeholder="sk-…"
              value={settings.openaiKey}
              onChange={(value) => set("openaiKey", value)}
              hint="Stored in this browser's local extension storage and sent only to OpenAI."
            />
          )}
          {settings.provider === "anthropic" && (
            <CredentialField
              id="anthropicKey"
              label="Anthropic API key"
              placeholder="sk-ant-…"
              value={settings.anthropicKey}
              onChange={(value) => set("anthropicKey", value)}
              hint="Stored in this browser's local extension storage and sent only to Anthropic."
            />
          )}
          {settings.provider === "gemini" && (
            <CredentialField
              id="geminiKey"
              label="Gemini API key"
              placeholder="AIza…"
              value={settings.geminiKey}
              onChange={(value) => set("geminiKey", value)}
              hint="Stored in this browser's local extension storage and sent only to Google."
            />
          )}
          {settings.provider === "ollama" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ollamaUrl">Ollama URL</Label>
              <Input
                id="ollamaUrl"
                type="url"
                value={settings.ollamaUrl}
                onChange={(event) => set("ollamaUrl", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Run Ollama with <code>OLLAMA_ORIGINS=&quot;chrome-extension://*&quot;</code> so the extension can connect.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <Select value={activeModel || undefined} onValueChange={setModel}>
              <SelectTrigger id="model"><SelectValue placeholder="No models found" /></SelectTrigger>
              <SelectContent>
                {activeModel && !modelInList && <SelectItem value={activeModel}>{activeModel}</SelectItem>}
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{modelStatus || "Fetched live after your provider settings are saved."}</p>
          </div>
        </section>

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

        <section className="flex flex-col gap-4" aria-labelledby="data-heading">
          <SectionHeading id="data-heading">Data</SectionHeading>
          <div>
            <Button variant="outline" onClick={exportData}>Export groups</Button>
            <p className="mt-2 text-xs text-muted-foreground">Copies JSON and downloads focused.json.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="importJson">Import groups</Label>
            <textarea
              id="importJson"
              rows={6}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="Paste Focused JSON…"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button variant="outline" onClick={importData} disabled={!importText.trim()} className="self-start">Import groups</Button>
          </div>
          <p className={`min-h-4 text-xs ${dataStatus?.error ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
            {dataStatus?.text || ""}
          </p>
        </section>

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

function CredentialField({
  id,
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
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

function SectionHeading({ id, children }: { id: string; children: string }) {
  return <h2 id={id} className="text-sm font-semibold tracking-tight">{children}</h2>;
}

function Divider() {
  return <div className="h-px bg-border" />;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
