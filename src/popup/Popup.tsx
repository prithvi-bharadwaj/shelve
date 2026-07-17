import { useEffect, useState } from "react";
import { Sparkles, Combine, Settings2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { MergeResponse, OrganizeResponse, ProposedGroup } from "@/types";

type Phase = "idle" | "organizing" | "review" | "applying" | "merging";

export function Popup() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [groups, setGroups] = useState<ProposedGroup[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [windowCount, setWindowCount] = useState(1);
  const [acknowledged, setAcknowledged] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "windowCount" }).then((res) => {
      if (res?.count) setWindowCount(res.count);
    });
    chrome.storage.local.get({ dataNoticeAck: false }).then((s) => setAcknowledged(s.dataNoticeAck));
  }, []);

  const organize = async () => {
    // No API key → don't prompt for permissions, just point to settings.
    const { apiKey } = await chrome.storage.local.get({ apiKey: "" });
    if (!apiKey) {
      setStatus({ text: "No API key set — add one in Settings.", error: true });
      return;
    }

    // One-time disclosure before anything leaves the browser.
    if (!acknowledged && !confirming) {
      setConfirming(true);
      setStatus({ text: "Sends tab titles & URLs (and, if allowed, page snippets) to the Anthropic API." });
      return;
    }
    if (confirming) {
      setConfirming(false);
      setAcknowledged(true);
      await chrome.storage.local.set({ dataNoticeAck: true });
    }

    setPhase("organizing");
    setStatus(null);

    // Ask for page-content access on first use (needs a user gesture).
    // Declining is fine — classification falls back to titles + URLs.
    let hasContentPermission = await chrome.permissions.contains({
      permissions: ["scripting"],
      origins: ["<all_urls>"],
    });
    if (!hasContentPermission) {
      try {
        hasContentPermission = await chrome.permissions.request({
          permissions: ["scripting"],
          origins: ["<all_urls>"],
        });
      } catch {
        hasContentPermission = false;
      }
    }

    const res: OrganizeResponse = await chrome.runtime.sendMessage({ type: "organize", hasContentPermission });
    if (!res || res.error) {
      setPhase("idle");
      setStatus({ text: res?.error ?? "Something went wrong.", error: true });
      return;
    }
    if (res.review && res.groups) {
      setGroups(res.groups);
      setSelected(new Set(res.groups.map((_, i) => i)));
      setPhase("review");
      setStatus(null);
      return;
    }
    setPhase("idle");
    setStatus({ text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} · ${res.tabCount} tabs sorted` });
  };

  const applySelected = async () => {
    const chosen = groups.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setPhase("applying");
    const res: OrganizeResponse = await chrome.runtime.sendMessage({ type: "applyPlan", groups: chosen });
    setPhase("idle");
    setGroups([]);
    setStatus(
      res?.error
        ? { text: res.error, error: true }
        : { text: `${res.groupCount} group${res.groupCount === 1 ? "" : "s"} created` }
    );
  };

  const merge = async () => {
    setPhase("merging");
    setStatus(null);
    const win = await chrome.windows.getCurrent(); // the window this popup is on
    const res: MergeResponse = await chrome.runtime.sendMessage({ type: "mergeWindows", windowId: win.id });
    setPhase("idle");
    if (res?.error) return setStatus({ text: res.error, error: true });
    setWindowCount(1);
    setStatus({ text: `Merged ${res.windows} window${res.windows === 1 ? "" : "s"} · ${res.tabs} tabs` });
  };

  const busy = phase !== "idle" && phase !== "review";

  return (
    <div className="w-72 p-3">
      <div className="flex flex-col gap-1.5">
        <Button
          onClick={organize}
          disabled={busy || phase === "review"}
          className="w-full justify-start gap-2.5 h-10"
        >
          {phase === "organizing" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {phase === "organizing" ? "Organizing…" : confirming ? "Continue" : "Organize tabs"}
        </Button>

        {windowCount > 1 && (
          <Button
            onClick={merge}
            disabled={busy || phase === "review"}
            variant="secondary"
            className="w-full justify-start gap-2.5 h-10"
          >
            {phase === "merging" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Combine className="size-4" />
            )}
            Merge {windowCount} windows
          </Button>
        )}
      </div>

      {(phase === "review" || phase === "applying") && (
        <div className="mt-3">
          <div className="flex flex-col gap-1">
            {groups.map((g, i) => (
              <label
                key={i}
                className="review-item flex items-start gap-2.5 rounded-md p-2 hover:bg-accent cursor-pointer"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(i)}
                  disabled={phase === "applying"}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    checked ? next.add(i) : next.delete(i);
                    setSelected(next);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">
                    {g.name}
                    <span className="ml-1.5 text-muted-foreground font-normal">{g.tabIds.length}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {g.tabTitles.join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Button
            onClick={applySelected}
            disabled={selected.size === 0 || phase === "applying"}
            className="w-full mt-2"
            size="sm"
          >
            {phase === "applying" ? "Applying…" : "Apply"}
          </Button>
        </div>
      )}

      <div className="mt-3 flex items-start justify-between gap-2 min-h-5">
        <p className={`text-xs ${status?.error ? "text-destructive" : "text-muted-foreground"}`}>
          {status?.text ?? ""}
        </p>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors duration-150"
          aria-label="Settings"
        >
          <Settings2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
