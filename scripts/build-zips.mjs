// Builds the extension and produces the two downloadable zips served by site/:
//   site/focused.zip         — clean OSS build, bring your own key
//   site/focused-judges.zip  — Gemini key baked in, provider defaulted to gemini
//
// Usage:
//   node scripts/build-zips.mjs                          # OSS zip only
//   GEMINI_API_KEY=AIza... node scripts/build-zips.mjs   # both zips
//   node scripts/build-zips.mjs --key AIza...            # both zips

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");

const keyArgIndex = process.argv.indexOf("--key");
const geminiKey = keyArgIndex !== -1 ? process.argv[keyArgIndex + 1] : process.env.GEMINI_API_KEY;

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

run("pnpm build", root);
fs.mkdirSync(site, { recursive: true });

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "focused-zip-"));
const pkgDir = path.join(stage, "focused");

function makeZip(name, mutate) {
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.cpSync(path.join(root, "dist"), pkgDir, { recursive: true });
  if (mutate) mutate(pkgDir);
  const out = path.join(site, name);
  fs.rmSync(out, { force: true });
  run(`zip -qr ${JSON.stringify(out)} focused`, stage);
  console.log(`wrote ${path.relative(root, out)}`);
}

function replaceOnce(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(from)} in ${file}, found ${count}. background.js defaults changed — update build-zips.mjs.`);
  }
  fs.writeFileSync(file, text.replace(from, to));
}

makeZip("focused.zip");

if (geminiKey) {
  makeZip("focused-judges.zip", (dir) => {
    const worker = path.join(dir, "background.js");
    replaceOnce(worker, `provider: "openai",`, `provider: "gemini",`);
    replaceOnce(worker, `geminiKey: "",`, `geminiKey: ${JSON.stringify(geminiKey)},`);
  });
} else {
  console.log("no GEMINI_API_KEY / --key given — skipped focused-judges.zip (the site's main download button points at it, so build it before deploying)");
}

fs.rmSync(stage, { recursive: true, force: true });
