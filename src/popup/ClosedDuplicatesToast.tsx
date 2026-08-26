import type { ClosedDuplicateTab } from "@/types";

export function ClosedDuplicatesToast({
  closedTabs,
  onExpire,
}: {
  closedTabs: ClosedDuplicateTab[];
  onExpire: () => void;
}) {
  return (
    <div className="closed-toast relative mt-2 overflow-hidden rounded-md border border-border bg-muted/20">
      <ul aria-label="Closed duplicate tabs" className="max-h-36 space-y-1.5 overflow-y-auto p-2 pb-2.5">
        {closedTabs.map((tab, index) => (
          <li key={`${tab.url}-${index}`} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium leading-snug text-foreground">
                {tab.title || "Untitled tab"}
              </p>
              <p className="break-all leading-snug text-muted-foreground">{tab.url}</p>
            </div>
            {tab.keptTabId !== undefined && (
              <button
                type="button"
                onClick={() => chrome.runtime.sendMessage({ type: "focusTab", tabId: tab.keptTabId })}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                View existing
              </button>
            )}
          </li>
        ))}
      </ul>
      <div
        data-testid="closed-toast-timer"
        className="closed-toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/60"
        onAnimationEnd={onExpire}
      />
    </div>
  );
}
