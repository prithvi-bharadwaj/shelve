import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_SETTINGS, type Settings } from "@/types";

// Fallback shown until the live list loads (or when no key is set yet).
const FALLBACK_MODELS = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [saved, setSaved] = useState(false);

  const refreshModels = async () => {
    // Live model list from the API — never goes stale.
    const res = await chrome.runtime.sendMessage({ type: "listModels" });
    setModels(res?.models?.length ? res.models : FALLBACK_MODELS);
  };

  useEffect(() => {
    (async () => {
      const { apiKey, ...prefs } = DEFAULT_SETTINGS;
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get(prefs),
        chrome.storage.local.get({ apiKey }),
      ]);
      setSettings({ ...DEFAULT_SETTINGS, ...sync, apiKey: local.apiKey });
    })();
    refreshModels();
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const save = async () => {
    const normalized: Settings = {
      ...settings,
      apiKey: settings.apiKey.trim(),
      minGroupSize: clamp(settings.minGroupSize || 2, 1, 10),
    };
    setSettings(normalized);
    const { apiKey, ...prefs } = normalized;
    await Promise.all([
      chrome.storage.sync.set(prefs),
      chrome.storage.local.set({ apiKey }), // local only — never synced across devices
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    refreshModels(); // in case the key just changed
  };

  const modelInList = models.some((m) => m.id === settings.model);

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <div className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="apiKey">Anthropic API key</Label>
          <Input
            id="apiKey"
            type="password"
            placeholder="sk-ant-…"
            value={settings.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Kept in this browser's local extension storage (not synced), sent only to api.anthropic.com.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Model</Label>
          <Select value={settings.model} onValueChange={(v) => set("model", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!modelInList && <SelectItem value={settings.model}>{settings.model}</SelectItem>}
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Fetched live from your account once a key is saved.
          </p>
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="review">Review before applying</Label>
            <p className="text-xs text-muted-foreground mt-1">Show proposed groups first.</p>
          </div>
          <Switch id="review" checked={settings.reviewFirst} onCheckedChange={(v) => set("reviewFirst", v)} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="everything">Group every tab</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Off: loose one-off tabs are left untouched.
            </p>
          </div>
          <Switch
            id="everything"
            checked={settings.groupEverything}
            onCheckedChange={(v) => set("groupEverything", v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="minSize">Minimum tabs per group</Label>
            <p className="text-xs text-muted-foreground mt-1">Smaller groups are dropped.</p>
          </div>
          <Input
            id="minSize"
            type="number"
            min={1}
            max={10}
            className="w-16 text-center"
            value={settings.minGroupSize}
            onChange={(e) => set("minGroupSize", clamp(parseInt(e.target.value, 10) || 2, 1, 10))}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          <span
            className={`text-sm text-muted-foreground transition-opacity duration-200 [transition-timing-function:var(--ease-out-strong)] ${saved ? "opacity-100" : "opacity-0"}`}
          >
            Saved
          </span>
        </div>
      </div>
    </div>
  );
}
