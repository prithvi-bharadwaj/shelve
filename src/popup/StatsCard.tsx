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
  const line = [
    `${tabs.toLocaleString()} tabs sorted`,
    (stats.totals.stashes ?? 0) > 0 ? `${(stats.totals.stashes ?? 0).toLocaleString()} shelved` : null,
    stats.streak > 1 ? `${stats.streak}-day streak` : null,
    stats.weekTabs > 0 ? `${stats.weekTabs.toLocaleString()} this week` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <p
      aria-label="Your stats"
      title={nextMilestone ? `${(nextMilestone - tabs).toLocaleString()} tabs to ${nextMilestone.toLocaleString()}` : undefined}
      className="mt-3 text-[11px] leading-snug text-muted-foreground tabular-nums"
    >
      {line}
    </p>
  );
}
