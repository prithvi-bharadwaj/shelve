import { useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, LoaderCircle, X } from "lucide-react";
import type { GroupInfo, Stash } from "@/types";

const GROUP_DOT: Record<string, string> = {
  grey: "bg-zinc-400",
  blue: "bg-blue-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
};

// Stable Chrome has no per-tab memory API (chrome.processes is dev-channel
// only), so loaded (non-discarded) tab count is the best available proxy.
function ramEstimate(group: GroupInfo) {
  const loaded = group.loadedCount ?? group.tabCount;
  if (loaded >= 7) return { label: "high", className: "text-orange-400" };
  if (loaded >= 3) return { label: "med", className: "text-yellow-500" };
  return { label: "low", className: "text-muted-foreground" };
}

function timeAgo(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function StashPanel({
  groups,
  stashes,
  busyId,
  disabled,
  onStash,
  onResume,
  onDelete,
}: {
  groups: GroupInfo[];
  stashes: Stash[];
  busyId: number | string | null;
  disabled: boolean;
  onStash: (groupId: number) => void;
  onResume: (stashId: string) => void;
  onDelete: (stashId: string) => Promise<void>;
}) {
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  if (!groups.length && !stashes.length) return null;
  return (
    <>
      {groups.length > 0 && (
        <section className="mt-4" aria-label="Tab groups in this window">
          <button
            type="button"
            onClick={() => setGroupsOpen((open) => !open)}
            aria-expanded={groupsOpen}
            aria-controls="groups-list"
            className="flex h-7 w-full items-center justify-between rounded-md px-1.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Groups · {groups.length}
            </span>
            <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-200 [transition-timing-function:var(--ease-out-strong)] ${groupsOpen ? "rotate-180" : ""}`} />
          </button>
          {groupsOpen && (
          <div id="groups-list" className="mt-1 flex flex-col">
            {groups.map((group) => (
              <div key={group.id} className="flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-muted/50">
                <span className={`size-2 shrink-0 rounded-full ${GROUP_DOT[group.color] ?? GROUP_DOT.grey}`} />
                <span className="min-w-0 flex-1 truncate text-xs">{group.title}</span>
                <span
                  title={`Approximate memory use: ${group.loadedCount ?? group.tabCount} of ${group.tabCount} tabs loaded`}
                  className={`text-[10px] font-medium uppercase tracking-wide ${ramEstimate(group).className}`}
                >
                  {ramEstimate(group).label}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{group.tabCount}</span>
                <IconButton
                  title={`Stash “${group.title}”`}
                  disabled={disabled}
                  onClick={() => onStash(group.id)}
                >
                  {busyId === group.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                </IconButton>
              </div>
            ))}
          </div>
          )}
        </section>
      )}

      {stashes.length > 0 && (
        <section className="mt-4" aria-label="Stashed groups">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Stashed</h2>
          <div className="mt-1.5 flex flex-col gap-1">
            {stashes.map((stash) => {
              const resuming = stash.resumeStatus === "resuming";
              const rowDisabled = disabled || resuming;
              return (
                <div key={stash.id} className="rounded-md border border-border/70 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${GROUP_DOT[stash.color] ?? GROUP_DOT.grey}`} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{stash.name}</span>
                    {confirmingDelete === stash.id ? (
                      <>
                        <span className="text-[11px] text-destructive">Delete this stash?</span>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={rowDisabled}
                          onClick={async () => {
                            await onDelete(stash.id);
                            setConfirmingDelete(null);
                          }}
                          className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive outline-none transition-colors hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {stash.tabCount} · {timeAgo(stash.createdAt)}
                        </span>
                        <IconButton title="Resume" disabled={rowDisabled} onClick={() => onResume(stash.id)}>
                          {busyId === stash.id || resuming ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArchiveRestore className="size-3.5" />}
                        </IconButton>
                        <IconButton title="Delete stash" disabled={rowDisabled} onClick={() => setConfirmingDelete(stash.id)}>
                          <X className="size-3.5" />
                        </IconButton>
                      </>
                    )}
                  </div>
                  {resuming ? (
                    <p className="mt-1 pl-4 text-[11px] italic text-muted-foreground">Resuming this stash…</p>
                  ) : stash.briefStatus === "pending" ? (
                    <p className="mt-1 pl-4 text-[11px] italic text-muted-foreground">Writing where-you-left-off brief…</p>
                  ) : stash.brief ? (
                    <p className="mt-1 line-clamp-3 pl-4 text-[11px] leading-snug text-muted-foreground">{stash.brief}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
