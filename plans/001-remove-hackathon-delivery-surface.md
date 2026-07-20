# Plan 001: Remove the redundant hackathon delivery surface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report—do not improvise. When done, update this plan's row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- site scripts/build-zips.mjs README.md .gitignore package.json pnpm-lock.yaml popup.html options.html`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code. A substantive mismatch is a STOP
> condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security | tech-debt | dx | docs
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

The repository contains a roughly 2,000-line landing page and fake extension
simulation that is not part of the Vite extension build. It duplicates the
real popup and already behaves differently. Its primary download path is worse:
the packaging script can insert a reusable Gemini credential into an extension
ZIP and the public page tells users that the key is shared. Removing this
surface eliminates the largest rushed duplicate, closes the credential-baking
path, and leaves one honest source-install workflow.

This plan does not rotate any credential. If a credential-bearing judges ZIP
was distributed, rotation is an external operator action.

## Current state

- `vite.config.ts:10-17` builds only `popup.html` and `options.html`:

  ```ts
  rollupOptions: {
    input: {
      popup: resolve(__dirname, "popup.html"),
      options: resolve(__dirname, "options.html"),
    },
  },
  ```

- `site/index.html:70` labels its duplicate UI explicitly:

  ```html
  <!-- Extension popup, replicated 1:1 from src/popup/Popup.tsx -->
  ```

- `site/index.html:217-224` advertises and links the credential-bearing ZIP:

  ```html
  <strong>Works straight out of the box.</strong>
  There's a Gemini API key already inside...
  ...
  <li><a class="step-download" href="focused-judges.zip" download>
    Download focused-judges.zip
  </a> and unzip it.</li>
  ```

- `scripts/build-zips.mjs:19-20` accepts a provider credential from process
  arguments or the environment, and `scripts/build-zips.mjs:51-56` writes it
  into `background.js` inside the judges artifact.
- `README.md:43` calls the generated ZIP a "Fast path" even though
  `scripts/build-zips.mjs:24` first runs a dependency-backed production build.
- `package.json:6-10` exposes `dev`, `build`, and a misleading `preview`
  command. Popup and Options require extension-only `chrome.*` APIs, so the
  ordinary HTTP preview is not a usable product preview.
- `popup.html:5` and `options.html:6` still use "Tab Organizer AI" titles.
- `.gitignore:9-12` contains stale site bundle and `regroup.zip` rules.
- The resolved Vite version in `pnpm-lock.yaml` requires Node
  `^20.19.0 || >=22.12.0`, while `package.json` declares no `engines` range.

Repository conventions:

- Package manager: pnpm, pinned by `packageManager` in `package.json`.
- Commit subjects use conventional prefixes, for example
  `d347e53 fix: drop Firefox from supported-browser copy` and
  `be05179 feat: popup polish...`.
- HTML uses two-space indentation; JSON uses two-space indentation.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0, no output |
| Production build | `pnpm build` | exit 0 and `dist/` contains manifest, popup, options, and worker |
| Whitespace | `git diff --check` | exit 0, no output |

## Scope

**In scope**:

- Delete `site/index.html`.
- Delete `site/styles.css`.
- Delete `site/sim.js`.
- Delete `site/demo.js`.
- Delete `site/icon128.png`.
- Delete `scripts/build-zips.mjs`; remove `scripts/` if it becomes empty.
- Update `README.md`.
- Update `.gitignore`.
- Update `package.json`.
- Update `pnpm-lock.yaml` only if pnpm changes importer metadata.
- Update `popup.html`.
- Update `options.html`.

**Out of scope**:

- Any extension behavior in `src/` or `public/background.js`.
- Creating a replacement website, recording, release ZIP, deployment, or CI.
- Editing provider defaults or adding/removing provider support.
- Rotating, revoking, or displaying any provider credential.
- Removing merge, monitor, or popup settings; Plan 004 owns those changes.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- Use one logical commit if the operator asks for commits. Suggested subject:
  `chore: remove hackathon demo and keyed bundle`.
- Do not push or open a pull request unless explicitly instructed.

## Steps

### Step 1: Delete the standalone landing, simulation, and packaging script

Delete every tracked file under `site/` and delete
`scripts/build-zips.mjs`. Do not preserve the clean-ZIP branch of that script:
the selected cleanup intentionally removes this entire ad hoc delivery path.
Do not replace it with another packager.

**Verify**:

```sh
test ! -e site
test ! -e scripts/build-zips.mjs
```

Expected: both commands exit 0.

Then run:

```sh
git grep -nE 'focused-judges|GEMINI_API_KEY|--key|replicated 1:1' -- . ':!plans/**'
```

Expected: exit 1 and no output.

### Step 2: Replace the false install fast path with source installation

In `README.md`:

1. Remove the "Fast path" paragraph and every reference to generated ZIPs or
   `site/`.
2. Add a concise prerequisite immediately before the install commands:
   Node `^20.19.0` or `>=22.12.0` and pnpm 10.
3. Keep the existing `pnpm install` / `pnpm build` workflow and unpacked
   `dist/` instructions.
4. Do not edit the feature list yet; Plan 004 will remove merge/monitor copy
   after those features are removed from code.

**Verify**:

```sh
git grep -nE 'Fast path|build-zips|site/focused|focused[.]zip' -- README.md
```

Expected: exit 1 and no output.

### Step 3: Clean package and ignore metadata

In `package.json`:

1. Remove the `preview` script.
2. Add:

   ```json
   "engines": {
     "node": "^20.19.0 || >=22.12.0"
   }
   ```

Keep the existing `dev` and `build` commands unchanged. Run
`pnpm install --lockfile-only` only if pnpm requires the lockfile to reflect
the manifest metadata; do not upgrade packages.

In `.gitignore` remove:

- `site/*.zip`
- `regroup.zip`
- `focused.zip`

Do not add broad archive ignore rules; an accidentally committed release bundle
should remain visible to Git.

**Verify**:

```sh
node -e 'const p=require("./package.json"); if (p.scripts.preview) process.exit(1); if (p.engines.node !== "^20.19.0 || >=22.12.0") process.exit(2)'
git grep -nE 'site/[*][.]zip|regroup[.]zip|^focused[.]zip$' -- .gitignore
```

Expected: the Node command exits 0; `git grep` exits 1 with no output.

### Step 4: Finish visible product naming

Change the popup document title to `Focused` and the options document title to
`Focused — Settings`. Do not alter the manifest name or visible React headers;
they are already correct.

**Verify**:

```sh
git grep -n 'Tab Organizer AI' -- popup.html options.html
git grep -n '<title>Focused' -- popup.html options.html
```

Expected: the first command exits 1 with no output; the second prints exactly
one matching line from each HTML file.

### Step 5: Run the complete pre-test-suite gate

Run:

```sh
pnpm install --frozen-lockfile
node --check public/background.js
pnpm build
test -f dist/manifest.json
test -f dist/background.js
test -f dist/popup.html
test -f dist/options.html
git diff --check
```

Expected: every command exits 0. Finally inspect `git status --short` and
confirm that only the in-scope files are modified/deleted, plus ignored
`dist/` output if the local environment reports it.

## Test plan

There is no automated test harness at the planned commit. This plan changes no
extension runtime behavior, so its regression checks are:

- the production build succeeds;
- all four extension artifacts exist;
- no keyed-bundle or removed-site reference remains;
- the document titles and Node engine declaration match exact strings.

Plan 002 establishes automated tests before any runtime cleanup.

## Done criteria

- [ ] `test ! -e site` exits 0.
- [ ] `test ! -e scripts/build-zips.mjs` exits 0.
- [ ] `git grep -nE 'focused-judges|GEMINI_API_KEY|--key' -- . ':!plans/**'`
      returns no matches.
- [ ] `package.json` has no `preview` script and declares the exact Node range.
- [ ] README install instructions start from prerequisites and
      `pnpm install`; no ZIP fast path remains.
- [ ] Popup and options titles use Focused.
- [ ] `node --check public/background.js` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] No out-of-scope source file is modified.
- [ ] Plan 001 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report instead of improvising if:

- A new deployment or hosting configuration references `site/`.
- The operator says the hackathon URL or downloadable ZIP must remain live.
- A current credential value is discovered. Do not print or copy it; report
  only its file and credential type and recommend rotation.
- Removing `site/` would delete assets referenced by `popup.html`,
  `options.html`, `public/manifest.json`, or `vite.config.ts`.
- `pnpm install --frozen-lockfile` requires a dependency upgrade rather than a
  lockfile-consistent install.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Future releases should use an explicit, secret-free release workflow rather
  than modifying built JavaScript.
- If a marketing page is wanted later, use a real screenshot or recording and
  a release link; do not recreate application state and behavior in a parallel
  JavaScript simulator.
- Reviewers should verify that no secret-handling replacement was introduced
  and that the extension build remains independent of deleted site assets.
