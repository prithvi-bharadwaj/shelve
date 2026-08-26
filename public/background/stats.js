// Local-only usage counters rendered in the popup's stats card. Nothing here
// ever leaves the machine: totals and a rolling window of daily buckets live
// in chrome.storage.local under one key.

const STATS_KEY = "stats.v1";
const DAY_LIMIT = 45;
const DAY_MS = 86400000;

export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Noon-anchored day stepping so DST shifts cannot skip or repeat a date.
function daysAgo(now, count) {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  return noon.getTime() - count * DAY_MS;
}

export function emptyStats() {
  return {
    totals: /** @type {Record<string, number>} */ ({}),
    days: /** @type {Record<string, { actions: number, tabsGrouped: number }>} */ ({})
  };
}

export function mergeDelta(stats, delta, key) {
  const next = { totals: { ...stats.totals }, days: { ...stats.days } };
  for (const [name, value] of Object.entries(delta)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    next.totals[name] = (next.totals[name] || 0) + value;
  }
  const day = { ...(next.days[key] || { actions: 0, tabsGrouped: 0 }) };
  day.actions += 1;
  day.tabsGrouped += Math.max(0, delta.tabsGrouped || 0);
  next.days[key] = day;
  const keys = Object.keys(next.days).sort();
  while (keys.length > DAY_LIMIT) delete next.days[keys.shift()];
  return next;
}

// Consecutive active days ending today — or ending yesterday, so a streak
// isn't reported broken before the user has done anything today.
export function computeStreak(days, now) {
  let start = 0;
  if (!(days[dateKey(daysAgo(now, 0))]?.actions > 0)) start = 1;
  let streak = 0;
  for (let i = start; days[dateKey(daysAgo(now, i))]?.actions > 0; i++) streak++;
  return streak;
}

export async function recordAction(delta, now = Date.now()) {
  const stored = await chrome.storage.local.get(STATS_KEY).catch(() => ({}));
  const stats = stored[STATS_KEY] || emptyStats();
  await chrome.storage.local
    .set({ [STATS_KEY]: mergeDelta(stats, delta, dateKey(now)) })
    .catch(() => undefined);
}

export async function getStats(now = Date.now()) {
  const stored = await chrome.storage.local.get(STATS_KEY).catch(() => ({}));
  const stats = stored[STATS_KEY] || emptyStats();
  let weekTabs = 0;
  let weekActions = 0;
  for (let i = 0; i < 7; i++) {
    const day = stats.days[dateKey(daysAgo(now, i))];
    if (day) {
      weekTabs += day.tabsGrouped || 0;
      weekActions += day.actions || 0;
    }
  }
  return { totals: stats.totals, streak: computeStreak(stats.days, now), weekTabs, weekActions };
}
