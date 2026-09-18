import { afterEach, expect, test, vi } from "vitest";

// Pure pieces of organize's Jev fast lane: reading file_* answers, turning
// placements into plan rows, and summing two apply results.

async function load() {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    storage: { local: { get: async (defaults: Record<string, unknown>) => ({ ...defaults }), set: vi.fn(async () => {}) } },
  });
  const [decide, organize] = await Promise.all([
    import("../public/background/decide.js"),
    import("../public/background/organize.js"),
  ]);
  return { ...decide, ...organize };
}

afterEach(() => vi.unstubAllGlobals());

const tabs = [
  { id: 1, title: "arXiv: Attention", url: "https://arxiv.org/abs/1" },
  { id: 2, title: "Amazon cart", url: "https://amazon.com/cart" },
  { id: 3, title: "Random blog", url: "https://blog.example/" },
];
const groups = [
  { id: 7, title: "Research", color: "blue", tabs: ["Papers with Code"] },
  { id: 8, title: "Shopping", color: "red", tabs: [] },
];

test("readFileAnswers keeps only confident picks of real groups", async () => {
  const { readFileAnswers, buildFileQuestions } = await load();
  expect(Object.keys(buildFileQuestions(tabs, groups))).toEqual(["file_1", "file_2", "file_3"]);
  const placements = readFileAnswers({
    file_1: { choice: "7", probabilities: { "7": 0.92, "8": 0.03, none: 0.05 } },
    file_2: { choice: "8", probabilities: { "8": 0.55, none: 0.45 } },
    file_3: { choice: "99", probabilities: { "99": 0.99 } },
  }, tabs, groups);
  expect([...placements]).toEqual([[1, 7]]);
});

test("placementGroups folds tabs per existing group and combineResults sums both stages", async () => {
  const { placementGroups, combineResults } = await load();
  const existingById = new Map(groups.map((group) => [group.id, group]));
  expect(placementGroups(new Map([[1, 7], [3, 7], [2, 8], [4, 99]]), existingById)).toEqual([
    { existingGroupId: 7, tabIds: [1, 3], importance: 3 },
    { existingGroupId: 8, tabIds: [2], importance: 3 },
  ]);
  const early = { done: true, groupCount: 1, tabCount: 2, newGroupCount: 0, groupNames: ["Research"] };
  const late = { done: true, groupCount: 2, tabCount: 3, newGroupCount: 2, groupNames: ["Research", "Travel"] };
  expect(combineResults(early, late)).toEqual({ done: true, groupCount: 3, tabCount: 5, newGroupCount: 2, groupNames: ["Research", "Travel"] });
  expect(combineResults(early, { error: "nothing left" })).toEqual(early);
  expect(combineResults(null, late)).toEqual(late);
});
