import { describe, expect, it } from "vitest";
import { computeStreak, dateKey, emptyStats, mergeDelta } from "../public/background/stats.js";

const NOON = (iso: string) => new Date(`${iso}T12:00:00`).getTime();

describe("stats", () => {
  it("accumulates totals and daily buckets, ignoring non-positive deltas", () => {
    let stats = emptyStats();
    stats = mergeDelta(stats, { organizes: 1, tabsGrouped: 12, groupsCreated: 3 }, "2026-08-26");
    stats = mergeDelta(stats, { organizes: 1, tabsGrouped: 8, bogus: -5 }, "2026-08-26");
    stats = mergeDelta(stats, { stashes: 1 }, "2026-08-27");
    expect(stats.totals).toEqual({ organizes: 2, tabsGrouped: 20, groupsCreated: 3, stashes: 1 });
    expect(stats.days["2026-08-26"]).toEqual({ actions: 2, tabsGrouped: 20 });
    expect(stats.days["2026-08-27"]).toEqual({ actions: 1, tabsGrouped: 0 });
  });

  it("prunes the oldest daily buckets beyond the 45-day window", () => {
    let stats = emptyStats();
    for (let day = 1; day <= 50; day++) {
      stats = mergeDelta(stats, { commands: 1 }, dateKey(NOON("2026-01-01") + (day - 1) * 86400000));
    }
    const keys = Object.keys(stats.days).sort();
    expect(keys).toHaveLength(45);
    expect(keys[0]).toBe("2026-01-06");
    expect(stats.totals.commands).toBe(50);
  });

  it("counts a streak ending today", () => {
    let stats = emptyStats();
    for (const day of ["2026-08-24", "2026-08-25", "2026-08-26"]) {
      stats = mergeDelta(stats, { organizes: 1 }, day);
    }
    expect(computeStreak(stats.days, NOON("2026-08-26"))).toBe(3);
  });

  it("keeps a streak alive when today has no activity yet, but breaks on a gap", () => {
    let stats = emptyStats();
    for (const day of ["2026-08-24", "2026-08-25"]) {
      stats = mergeDelta(stats, { organizes: 1 }, day);
    }
    expect(computeStreak(stats.days, NOON("2026-08-26"))).toBe(2);
    expect(computeStreak(stats.days, NOON("2026-08-28"))).toBe(0);
  });
});
