import { readFile } from "node:fs/promises";

if (!process.env.TYPESAFE_API_KEY) {
  console.log("skip: TYPESAFE_API_KEY not set");
  process.exit(0);
}

let spentUsd = 0;
globalThis.chrome = {
  storage: {
    local: {
      get: async (defaults) => ({ ...defaults, spentUsd }),
      set: async (values) => {
        if (Object.hasOwn(values, "spentUsd")) spentUsd = Number(values.spentUsd);
      }
    },
    sync: {
      get: async (defaults) => ({ ...defaults })
    }
  }
};

const { routeCommand, JevError } = await import("../public/background/decide.js");
const { JEV_THRESHOLDS, JEV_DESTRUCTIVE_ACTIONS } = await import("../public/background/constants.js");
const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/command-eval.json", import.meta.url), "utf8"));
const mutableTabIds = new Set(fixture.tabs
  .filter((tab) => tab.windowId === fixture.windowId && !tab.pinned)
  .map((tab) => tab.id));
const fields = ["tabId", "tabIds", "groupIds", "allGroups", "color", "nameSpan"];
const setFields = new Set(["tabIds", "groupIds"]);
const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const commands = onlyIndex === -1 ? fixture.commands : fixture.commands.filter((command) => command.id === args[onlyIndex + 1]);

function compareField(field, expected, got) {
  if (!setFields.has(field)) return expected === got;
  const wanted = new Set(expected);
  const actual = new Set(got || []);
  return wanted.size === actual.size && [...wanted].every((id) => actual.has(id));
}

function score(command, result, error = null) {
  const { expect } = command;
  const actionCorrect = !error && (expect.compound
    ? result.isCompound >= JEV_THRESHOLDS.compound
    : result.action === expect.action || (expect.altActions || []).includes(result.action));
  const mismatches = [];
  if (!actionCorrect) {
    mismatches.push(expect.compound ? "isCompound" : "action");
  }
  if (actionCorrect && !expect.compound) {
    for (const field of fields) {
      if (Object.hasOwn(expect, field) && !compareField(field, expect[field], result[field])) {
        mismatches.push(field);
      }
    }
  }
  return {
    id: command.id,
    query: command.query,
    expect,
    tags: command.tags,
    result,
    error,
    actionCorrect: Boolean(actionCorrect),
    mismatches
  };
}

async function evaluate(command, first = false) {
  try {
    const result = await routeCommand({
      query: command.query,
      tabs: fixture.tabs,
      groups: fixture.groups,
      mutableTabIds,
      settings: { typesafeKey: process.env.TYPESAFE_API_KEY }
    });
    return score(command, result);
  } catch (error) {
    if (first && error instanceof JevError && ["network", "timeout"].includes(error.code)) {
      console.log("skip: TypeSafe API unreachable");
      process.exit(0);
    }
    if (first && error instanceof JevError && error.code === "auth") {
      console.error("TypeSafe rejected TYPESAFE_API_KEY; nothing was evaluated.");
      process.exit(1);
    }
    return score(command, null, error instanceof JevError ? error.code : "unexpected_error");
  }
}

async function runCommands() {
  if (!commands.length) return [];
  const results = [await evaluate(commands[0], true)];
  let next = 1;
  async function worker() {
    while (next < commands.length) {
      const index = next++;
      results[index] = await evaluate(commands[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, commands.length - 1) }, () => worker()));
  return results;
}

function percent(correct, total) {
  return total ? `${(100 * correct / total).toFixed(1)}%` : "n/a";
}

function printActions(results) {
  const counts = new Map();
  for (const row of results) {
    const action = row.expect.compound ? "compound" : row.expect.action;
    const count = counts.get(action) || { n: 0, correct: 0 };
    count.n++;
    count.correct += Number(row.actionCorrect);
    counts.set(action, count);
  }
  counts.set("overall", {
    n: results.length,
    correct: results.filter((row) => row.actionCorrect).length
  });
  console.log("Action accuracy (compound uses isCompound):");
  console.table([...counts].map(([action, count]) => ({
    action,
    ...count,
    "%": percent(count.correct, count.n)
  })));
}

function printFields(results) {
  const rows = fields.map((field) => {
    const eligible = results.filter((row) => row.actionCorrect && !row.expect.compound && Object.hasOwn(row.expect, field));
    const correct = eligible.filter((row) => !row.mismatches.includes(field)).length;
    const stats = { field, n: eligible.length, correct, "%": percent(correct, eligible.length) };
    if (setFields.has(field)) {
      let hits = 0;
      let predicted = 0;
      let expected = 0;
      for (const row of eligible) {
        const wanted = new Set(row.expect[field]);
        const actual = new Set(row.result[field] || []);
        hits += [...actual].filter((id) => wanted.has(id)).length;
        predicted += actual.size;
        expected += wanted.size;
      }
      stats.precision = percent(hits, predicted);
      stats.recall = percent(hits, expected);
    }
    return stats;
  });
  console.log("Field accuracy (action-correct, non-compound only; micro-averaged precision/recall):");
  console.table(rows);
}

function printHistogram(results) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    confidence: `${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)}${index === 9 ? " inclusive" : " exclusive"}`,
    correct: 0,
    incorrect: 0
  }));
  for (const row of results) {
    if (!row.result) continue;
    const index = Math.max(0, Math.min(9, Math.floor(row.result.confidence * 10)));
    buckets[index][row.actionCorrect ? "correct" : "incorrect"]++;
  }
  console.log("Confidence histogram (action correctness; errors have no confidence):");
  console.table(buckets);
}

function printThresholds(results) {
  const rows = [];
  for (let step = 3; step <= 9; step++) {
    const threshold = step / 10;
    const counts = {
      threshold: threshold.toFixed(1),
      destructiveCorrectClarify: 0,
      destructiveIncorrectPass: 0,
      otherCorrectClarify: 0,
      otherIncorrectPass: 0
    };
    for (const row of results) {
      if (!row.result) continue;
      const prefix = JEV_DESTRUCTIVE_ACTIONS.includes(row.result.action) ? "destructive" : "other";
      if (row.actionCorrect && row.result.confidence < threshold) counts[`${prefix}CorrectClarify`]++;
      if (!row.actionCorrect && row.result.confidence >= threshold) counts[`${prefix}IncorrectPass`]++;
    }
    rows.push(counts);
  }
  console.log("Threshold sweep (by returned action; action correctness; errors excluded):");
  console.table(rows);
}

function printMisses(results) {
  const misses = results.filter((row) => row.mismatches.length);
  console.log(`Misses: ${misses.length}`);
  for (const row of misses) {
    const got = row.result;
    console.log(`${row.id}: ${row.query}`);
    console.log(`  expected: ${JSON.stringify(row.expect)}`);
    console.log(`  got: ${got ? JSON.stringify(got) : `error:${row.error}`}`);
    console.log(`  confidence: ${got?.confidence ?? "n/a"}; runnerUp: ${got?.runnerUp ?? "n/a"}; mismatched: ${row.mismatches.join(", ")}`);
    if (got) console.log(`  probabilities: ${JSON.stringify(got.probabilities)}`);
  }
}

const results = await runCommands();
if (args.includes("--json")) {
  console.log(JSON.stringify({ results, spentUsd }, null, 2));
} else {
  if (!commands.length) console.log("No commands matched --only.");
  printActions(results);
  printFields(results);
  printHistogram(results);
  printThresholds(results);
  printMisses(results);
  console.log(`Total estimated USD: $${spentUsd.toFixed(6)}`);
}
