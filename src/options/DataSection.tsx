import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SectionHeading } from "@/options/section";

export function DataSection() {
  const [importText, setImportText] = useState("");
  const [dataStatus, setDataStatus] = useState<{ text: string; error?: boolean } | null>(null);

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
    anchor.download = "shelve.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setDataStatus({ text: copied ? "Copied and downloaded shelve.json" : "Downloaded shelve.json; clipboard unavailable" });
  };

  const importData = async () => {
    setDataStatus(null);
    let payload: unknown;
    try {
      payload = JSON.parse(importText);
    } catch {
      setDataStatus({ text: "Paste valid Shelve JSON.", error: true });
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

  return (
    <section className="flex flex-col gap-4" aria-labelledby="data-heading">
      <SectionHeading id="data-heading">Data</SectionHeading>
      <div>
        <Button variant="outline" onClick={exportData}>Export groups</Button>
        <p className="mt-2 text-xs text-muted-foreground">Copies JSON and downloads shelve.json.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="importJson">Import groups</Label>
        <textarea
          id="importJson"
          rows={6}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="Paste Shelve JSON…"
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button variant="outline" onClick={importData} disabled={!importText.trim()} className="self-start">Import groups</Button>
      </div>
      <p className={`min-h-4 text-xs ${dataStatus?.error ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
        {dataStatus?.text || ""}
      </p>
    </section>
  );
}
