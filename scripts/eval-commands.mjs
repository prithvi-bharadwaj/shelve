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
const { JEV_THRESHOLDS, JEV_DESTRUCTIVE_ACTIONS, GROUP_COLORS } = await import("../public/background/constants.js");
const args = process.argv.slice(2);
const fixtureName = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : "command-eval.json";
const fixture = JSON.parse(await readFile(new URL(`../tests/fixtures/${fixtureName}`, import.meta.url), "utf8"));
const mutableTabIds = new Set(fixture.tabs
  .filter((tab) => tab.windowId === fixture.windowId && !tab.pinned)
  .map((tab) => tab.id));
const fields = ["tabId", "tabIdAny", "tabIds", "groupIds", "allGroups", "color", "nameSpan"];
const MUTATING = ["create_group", "add_to_group", "update_group", "ungroup", "remove_duplicates", "merge_groups"];
const setFields = new Set(["tabIds", "groupIds"]);
const onlyIndex = args.indexOf("--only");
const commands = onlyIndex === -1 ? fixture.commands : fixture.commands.filter((command) => command.id === args[onlyIndex + 1]);

function compareField(field, expected, got) {
  if (field === "tabIdAny") return expected.includes(got);
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
      const got = field === "tabIdAny" ? result.tabId : result[field];
      if (Object.hasOwn(expect, field) && !compareField(field, expect[field], got)) {
        mismatches.push(field);
      }
    }
  }
  const outcome = result ? classifyOutcome(command, result, mismatches) : "error";
  return {
    id: command.id,
    query: command.query,
    expect,
    tags: command.tags,
    result,
    error,
    actionCorrect: Boolean(actionCorrect),
    mismatches,
    outcome,
    step: result ? pipelineStep(command.query, result) : "error"
  };
}

// Mirrors command.js decideWithJev + the dispatch guards (regexes copied from
// explicitMutationCommand) to get the user-visible outcome, not just the label.
function explicitMutationCommand(query, action) {
  if (action === "remove_duplicates") {
    return /\b(duplicates?|duplicated|dupes?|dups?|dedupe|de-duplicate|deduplicate)\b/i.test(query) &&
      /\b(close|remove|clean|clear|delete|kill|get rid of|dedupe|de-duplicate|deduplicate)\b/i.test(query);
  }
  // "get rid of the X group" keeps the tabs, so it is only ever read as ungroup.
  if (action === "ungroup") return /\b(un-?group|dissolve|disband)\b/i.test(query) || /\b(get rid of|remove|delete|break up)\b.*\bgroup\b/i.test(query);
  if (action === "merge_groups") return /\b(merge|combine|consolidate)\b/i.test(query);
  if (action === "add_to_group") return /\b(move|add|put|stick|drop|throw|->|→)/i.test(query);
  if (action === "update_group") {
    return /\b(rename|re-?colou?r|colou?r|name|call|title)\b/i.test(query) ||
      new RegExp(`\\b(${GROUP_COLORS.join("|")})\\b`, "i").test(query);
  }
  return false;
}

function pipelineStep(query, result) {
  if (result.isCompound >= JEV_THRESHOLDS.compound) return "refused";
  const floor = JEV_DESTRUCTIVE_ACTIONS.includes(result.action) ? JEV_THRESHOLDS.destructiveAction : JEV_THRESHOLDS.action;
  if (result.confidence < floor) return "clarify";
  if (result.action === "answer" || result.tabsUncertain) return "llm";
  if (result.action === "merge_groups") return "llm";
  if (result.action !== "answer" && result.needsContent >= JEV_THRESHOLDS.needsContent) return "llm"; // eval has no page access
  if (result.action === "update_group" && !result.nameSpan && !result.color) return "llm";
  if (MUTATING.includes(result.action) && result.action !== "create_group" && !explicitMutationCommand(query, result.action)) return "guard";
  if ((result.action === "add_to_group" || result.action === "update_group") && result.groupIds.length !== 1) return "guard";
  if ((result.action === "create_group" || result.action === "add_to_group") && !result.tabIds.length) return "not_found";
  if (result.action === "ungroup" && !result.allGroups && !result.groupIds.length) return "guard";
  if (result.action === "open_tab" && result.tabId == null) return "not_found";
  return "acted";
}

// correct: did what was asked. safe: fell back, asked, or refused (degraded UX,
// no harm). wrong-target: right action, wrong tabs/groups (harmful if mutating).
// wrong-mutation: performed a mutation that was not asked for. wrong-tab: jumped
// to the wrong tab (annoying, harmless).
function classifyOutcome(command, result, mismatches) {
  const step = pipelineStep(command.query, result);
  const { expect } = command;
  if (expect.compound) return step === "refused" ? "correct" : step === "acted" ? "wrong-mutation" : "safe";
  if (step !== "acted" && step !== "not_found") return "safe";
  const acted = step === "acted" ? result.action : "not_found";
  const wanted = [expect.action, ...(expect.altActions || [])];
  if (!wanted.includes(acted)) {
    if (acted === "not_found") return "safe";
    return MUTATING.includes(acted) ? "wrong-mutation" : "wrong-tab";
  }
  if (acted === "not_found" && expect.action !== "not_found") return "safe";
  if (!mismatches.length) return "correct";
  return MUTATING.includes(acted) ? "wrong-target" : "wrong-tab";
}

function printOutcomes(results) {
  const counts = {};
  for (const row of results) counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  console.log("User-visible outcomes (simulated gates + guards):");
  console.table(Object.entries(counts).map(([outcome, n]) => ({ outcome, n, "%": percent(n, results.length) })));
  for (const row of results.filter((item) => item.outcome.startsWith("wrong"))) {
    console.log(`  ${row.outcome.toUpperCase()} ${row.id}: "${row.query}" → ${row.result.action} tabIds=${JSON.stringify(row.result.tabIds)} groupIds=${JSON.stringify(row.result.groupIds)} conf=${row.result.confidence}`);
  }
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
  printOutcomes(results);
  printFields(results);
  printHistogram(results);
  printThresholds(results);
  printMisses(results);
  console.log(`Total estimated USD: $${spentUsd.toFixed(6)}`);
}
