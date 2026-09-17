// Tunes the per-tab match question: runs every tab-selection case through each
// wording variant, then sweeps the noul threshold on the tune and holdout splits.
// Usage: TYPESAFE_API_KEY=… node scripts/eval-tab-selection.mjs [--variants current,byId] [--split tune] [--misses]
import { readFile, writeFile } from "node:fs/promises";

if (!process.env.TYPESAFE_API_KEY) {
  console.log("skip: TYPESAFE_API_KEY not set");
  process.exit(0);
}
globalThis.chrome = { storage: { local: { get: async (defaults) => ({ ...defaults }), set: async () => {} } } };

const { askJev, buildCommandState, matchQuestion } = await import("../public/background/decide.js");
const read = async (name) => JSON.parse(await readFile(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8"));
const fixture = await read("tab-selection-eval.json");
const strips = {};
for (const [name, strip] of Object.entries(fixture.strips)) strips[name] = strip.ref ? await read(strip.ref) : strip;

const criteria = {
  true: "This tab's own title or url fits the command's description of the tabs to collect, and any grouped or ungrouped condition holds.",
  false: "This tab does not fit the description, even if it shares a group or topic area with tabs that do."
};
// Each variant: how a tab is referenced from the instructions, and whether the
// state holds every tab (one request) or just the one being judged (one request per tab).
const VARIANTS = {
  current: { question: (tab) => matchQuestion(tab) },
  byIndex: {
    question: (tab, index) => ({ type: "noul", criteria, instructions: `\`command\` asks to group or move certain tabs, identified by site, topic, or current group. Is the tab at \`tabs[${index}]\` one of the tabs the command identifies?` })
  },
  keyed: {
    keyed: true,
    question: (tab) => ({ type: "noul", criteria, instructions: `\`command\` asks to group or move certain tabs, identified by site, topic, or current group. Is the tab at \`tabs.t${tab.id}\` one of the tabs the command identifies?` })
  },
  perTab: {
    perTab: true,
    question: () => ({ type: "noul", criteria, instructions: "`command` asks to group or move certain tabs, identified by site, topic, or current group. Is `tab` one of the tabs the command identifies?" })
  }
};

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
const variantNames = (option("--variants") || Object.keys(VARIANTS).join(",")).split(",");
const cases = fixture.cases.filter((item) => !option("--split") || item.split === option("--split"));
const settings = { typesafeKey: process.env.TYPESAFE_API_KEY };

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

async function nouls(variant, item) {
  const strip = strips[item.strip];
  const eligible = strip.tabs.filter((tab) => tab.windowId === strip.windowId && !tab.pinned);
  const context = { query: item.query, tabs: strip.tabs, groups: strip.groups, mutableTabIds: new Set(eligible.map((tab) => tab.id)) };
  const state = buildCommandState(context);
  if (variant.perTab) {
    const pairs = await pool(eligible, 6, async (tab) => {
      const own = state.tabs.find((entry) => entry.id === tab.id);
      const answers = await askJev(settings, { command: item.query, tab: own, groups: state.groups }, { match: variant.question(tab) });
      return [tab.id, answers.match.noul];
    });
    return Object.fromEntries(pairs);
  }
  if (variant.keyed) state.tabs = Object.fromEntries(state.tabs.map((tab) => [`t${tab.id}`, tab]));
  const questions = Object.fromEntries(eligible.map((tab) => [`match_${tab.id}`, variant.question(tab, strip.tabs.indexOf(tab))]));
  const answers = await askJev(settings, state, questions);
  return Object.fromEntries(eligible.map((tab) => [tab.id, answers[`match_${tab.id}`].noul]));
}

function sweep(rows) {
  const table = [];
  for (let step = 8; step <= 16; step++) {
    const threshold = step / 20;
    let exact = 0, hits = 0, predicted = 0, wanted = 0;
    for (const row of rows) {
      const picked = Object.entries(row.nouls).filter(([, p]) => p >= threshold).map(([id]) => Number(id));
      const want = new Set(row.item.tabIds);
      const right = picked.filter((id) => want.has(id)).length;
      hits += right; predicted += picked.length; wanted += want.size;
      if (right === want.size && picked.length === want.size) exact++;
    }
    const precision = hits / (predicted || 1), recall = hits / (wanted || 1);
    table.push({ threshold: threshold.toFixed(2), exact: `${exact}/${rows.length}`, precision: precision.toFixed(2), recall: recall.toFixed(2), f1: (2 * precision * recall / ((precision + recall) || 1)).toFixed(2) });
  }
  return table;
}

const raw = {};
for (const name of variantNames) {
  const variant = VARIANTS[name];
  const rows = (await pool(cases, variant.perTab ? 1 : 4, async (item) => {
    try {
      return { item, nouls: await nouls(variant, item) };
    } catch (error) {
      console.log(`  ${item.id}: error ${error.code || "unexpected"}`);
      return null;
    }
  })).filter(Boolean);
  raw[name] = rows.map((row) => ({ id: row.item.id, nouls: row.nouls }));
  for (const split of ["tune", "holdout"]) {
    const part = rows.filter((row) => row.item.split === split);
    if (!part.length) continue;
    console.log(`\n== ${name} · ${split} (${part.length} cases)`);
    console.table(sweep(part));
  }
  if (args.includes("--misses")) {
    const threshold = Number(option("--threshold")) || 0.5;
    for (const row of rows) {
      const want = new Set(row.item.tabIds);
      const wrong = Object.entries(row.nouls).filter(([id, p]) => (p >= threshold) !== want.has(Number(id)));
      if (wrong.length) console.log(`  ${row.item.id} [${row.item.tags}] "${row.item.query}" → ${wrong.map(([id, p]) => `${want.has(Number(id)) ? "missed" : "extra"} ${id}:${p.toFixed(2)}`).join(", ")}`);
    }
  }
}
if (option("--out")) await writeFile(option("--out"), JSON.stringify(raw, null, 2));
