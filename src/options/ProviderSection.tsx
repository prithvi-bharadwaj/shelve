import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/options/section";
import type { Provider, Settings } from "@/types";

export type Model = { id: string; name: string };

const PROVIDER_NAMES: Record<Provider, string> = {
  shelve: "Shelve Free — no key needed",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
};

export function ProviderSection({
  settings,
  models,
  modelStatus,
  freeActionsRemaining,
  onChangeProvider,
  onSetModel,
  onSet,
}: {
  settings: Settings;
  models: Model[];
  modelStatus: string;
  freeActionsRemaining: string | null;
  onChangeProvider: (provider: Provider) => void;
  onSetModel: (model: string) => void;
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const activeModel = settings.modelByProvider[settings.provider];
  const modelInList = models.some((model) => model.id === activeModel);
  const keyByProvider: Partial<Record<Provider, string>> = {
    openai: settings.openaiKey,
    anthropic: settings.anthropicKey,
    gemini: settings.geminiKey,
  };
  const missingKey = settings.provider in keyByProvider && !keyByProvider[settings.provider]?.trim();

  return (
    <section className="flex flex-col gap-4" aria-labelledby="provider-heading">
      <SectionHeading id="provider-heading">Provider</SectionHeading>
      <div className="flex flex-col gap-2">
        <Label htmlFor="provider">AI provider</Label>
        <Select value={settings.provider} onValueChange={(value) => onChangeProvider(value as Provider)}>
          <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(PROVIDER_NAMES).map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {settings.provider === "shelve" && <ShelveFreeHint freeActionsRemaining={freeActionsRemaining} />}

      {missingKey && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400" role="status">
          Not set up yet — {PROVIDER_NAMES[settings.provider]} needs an API key before Shelve can run.
          Paste one below, or switch to Shelve Free above to start instantly.
        </p>
      )}

      {settings.provider === "openai" && (
        <CredentialField
          id="openaiKey"
          label="OpenAI API key"
          placeholder="sk-…"
          value={settings.openaiKey}
          onChange={(value) => onSet("openaiKey", value)}
          hint="Stored in this browser's local extension storage and sent only to OpenAI."
        />
      )}
      {settings.provider === "anthropic" && (
        <CredentialField
          id="anthropicKey"
          label="Anthropic API key"
          placeholder="sk-ant-…"
          value={settings.anthropicKey}
          onChange={(value) => onSet("anthropicKey", value)}
          hint="Stored in this browser's local extension storage and sent only to Anthropic."
        />
      )}
      {settings.provider === "gemini" && (
        <CredentialField
          id="geminiKey"
          label="Gemini API key"
          placeholder="AIza…"
          value={settings.geminiKey}
          onChange={(value) => onSet("geminiKey", value)}
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
            onChange={(event) => onSet("ollamaUrl", event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Run Ollama with <code>OLLAMA_ORIGINS=&quot;chrome-extension://*&quot;</code> so the extension can connect.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="model">Model</Label>
        <Select value={activeModel || undefined} onValueChange={onSetModel}>
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
  );
}

function ShelveFreeHint({ freeActionsRemaining }: { freeActionsRemaining: string | null }) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const copyResetTimer = useRef<number | undefined>(undefined);

  const copyInstallCode = async () => {
    setCopyStatus(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: "getInstallToken" });
      if (!res?.token) throw new Error("no token");
      await navigator.clipboard.writeText(res.token);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyStatus(null), 2000);
  };

  return (
    <div className="flex flex-col gap-2">
      {freeActionsRemaining === "unlimited" ? (
        <p className="text-xs text-muted-foreground">
          No key, no signup — unlimited actions on Shelve's hosted model. This install is on the
          unlimited list.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No key, no signup — 30 free AI actions a day on Shelve's hosted model
          {freeActionsRemaining !== null ? ` (${freeActionsRemaining} left)` : ""}. When they run out,
          pick a provider above and paste your own key: Shelve stays free.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={copyInstallCode}>
          <Copy className="size-3.5" />
          Copy my install code
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Couldn't copy — try again." : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Your install code is an anonymous ID. Send it to Shelve's developer to get more free actions.
      </p>
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
