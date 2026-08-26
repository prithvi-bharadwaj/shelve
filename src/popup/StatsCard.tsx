import { useEffect, useState } from "react";

interface StatsSummary {
  totals: {
    tabsGrouped?: number;
    organizes?: number;
    stashes?: number;
    commands?: number;
    duplicatesClosed?: number;
  };
  streak: number;
  weekTabs: number;
  weekActions: number;
}

const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000];

// Local-only counters (stats.v1 in chrome.storage.local); hidden until the
// first organize so a fresh install never opens on a wall of zeros.
export function StatsCard({ refreshToken }: { refreshToken: unknown }) {
  const [stats, setStats] = useState<StatsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    chrome.runtime
      .sendMessage({ type: "getStats" })
      .then((res) => {
        if (!cancelled && res && !res.error && res.totals) setStats(res as StatsSummary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const tabs = stats?.totals?.tabsGrouped ?? 0;
  if (!stats || tabs < 1) return null;

  const nextMilestone = MILESTONES.find((m) => m > tabs);
  const subline = [
    stats.weekTabs > 0 ? `${stats.weekTabs.toLocaleString()} this week` : null,
    nextMilestone ? `${(nextMilestone - tabs).toLocaleString()} to ${nextMilestone.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label="Your stats"
      className="mt-2 rounded-md border border-border bg-muted/20 px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-2 tabular-nums">
        <Stat value={tabs} label="tabs sorted" />
        <Stat value={stats.totals.stashes ?? 0} label="shelved" />
        <Stat value={stats.streak} label={stats.streak === 1 ? "day streak" : "day streak"} />
      </div>
      {subline && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{subline}</p>}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <span className="text-sm font-semibold text-foreground">{value.toLocaleString()}</span>
      <span className="ml-1 text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
