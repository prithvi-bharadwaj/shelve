// Evaluates Jev's organize fast lane: filing loose tabs into existing groups.
// Prints precision/recall at several thresholds so JEV_THRESHOLDS.file can be tuned.
import { readFile } from "node:fs/promises";

if (!process.env.TYPESAFE_API_KEY) {
  console.log("skip: TYPESAFE_API_KEY not set");
  process.exit(0);
}
globalThis.chrome = {
  storage: {
    local: { get: async (defaults) => ({ ...defaults }), set: async () => {} },
    sync: { get: async (defaults) => ({ ...defaults }) }
  }
};

const { askJev, buildFileState, buildFileQuestions, readFileAnswers, JevError } = await import("../public/background/decide.js");
const { JEV_THRESHOLDS } = await import("../public/background/constants.js");
const args = process.argv.slice(2);
const fixtureName = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : "file-eval.json";
const fixture = JSON.parse(await readFile(new URL(`../tests/fixtures/${fixtureName}`, import.meta.url), "utf8"));

let answers;
const started = Date.now();
try {
  answers = await askJev({ typesafeKey: process.env.TYPESAFE_API_KEY }, buildFileState(fixture.tabs, fixture.groups), buildFileQuestions(fixture.tabs, fixture.groups));
} catch (error) {
  if (error instanceof JevError && ["network", "timeout"].includes(error.code)) { console.log("skip: TypeSafe API unreachable"); process.exit(0); }
  throw error;
}
console.log(`One Jev call: ${fixture.tabs.length} tabs × ${fixture.groups.length} groups in ${Date.now() - started} ms\n`);

const rows = [];
for (const threshold of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const placements = readFileAnswers(answers, fixture.tabs, fixture.groups, threshold);
  let tp = 0, fp = 0, fn = 0;
  for (const tab of fixture.tabs) {
    const got = placements.get(tab.id) ?? null;
    if (got !== null && got === tab.expect) tp++;
    else if (got !== null) fp++;
    else if (tab.expect !== null) fn++;
  }
  rows.push({ threshold, filed: tp + fp, correct: tp, wrong: fp, missed: fn, precision: pct(tp, tp + fp), recall: pct(tp, tp + fn) });
}
console.table(rows);
console.log(`Shipping threshold: ${JEV_THRESHOLDS.file}\n`);

const titleOf = new Map(fixture.groups.map((group) => [group.id, group.title]));
for (const tab of fixture.tabs) {
  const answer = answers[`file_${tab.id}`];
  const choice = answer?.choice;
  const probability = Number(answer?.probabilities?.[choice]) || 0;
  const got = readFileAnswers({ [`file_${tab.id}`]: answer }, [tab], fixture.groups).get(tab.id) ?? null;
  const mark = got === tab.expect ? "ok  " : got === null ? "MISS" : "WRONG";
  console.log(`${mark} ${tab.id} "${tab.title}" → ${choice === "none" ? "none" : titleOf.get(Number(choice))} ${probability.toFixed(2)} (want ${tab.expect === null ? "none" : titleOf.get(tab.expect)})`);
}

function pct(n, d) { return d ? `${(100 * n / d).toFixed(0)}%` : "n/a"; }
