# Plan 002: Establish a deterministic verification baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report—do not redesign the application. When
> done, update this plan's row in `plans/README.md` unless a reviewer owns the
> index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- package.json pnpm-lock.yaml tsconfig.json vite.config.ts public/background.js src/popup/ReviewGroups.tsx`
>
> Plan 001 intentionally changes `package.json` by removing `preview` and adding
> `engines`. That exact change is expected. Any runtime-source drift or other
> manifest change must be compared with the excerpts below.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-remove-hackathon-delivery-surface.md`
- **Category**: tests | dx
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

The service worker closes, moves, groups, and reopens users' tabs, but the
repository has no tests and a successful build typechecks only React source.
Plans 003–007 deliberately change those destructive paths. This plan adds a
deterministic Chrome API fake, a worker-loading harness, a small set of
characterization tests, and one `pnpm check` command so every later executor
has a repeatable safety gate.

The goal is a reliable baseline, not comprehensive coverage or a worker
refactor. Keep production behavior unchanged.

## Current state

- `package.json:6-10` has only:

  ```json
  "scripts": {
    "dev": "vite build --watch",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  }
  ```

  Plan 001 removes `preview` before this plan executes.

- `tsconfig.json:17` includes only `src`:

  ```json
  "include": ["src"]
  ```

- `public/background.js:354-383` registers one promise-based message
  dispatcher and keeps all handlers private in a classic service-worker
  script.
- `public/background.js:849-881` closes duplicate tabs.
- `public/background.js:948-1008` restores and clears undo state.
- `public/background.js:1222-1362` persists, closes, resumes, and deletes
  stashed groups.
- `src/popup/ReviewGroups.tsx:6-18` is a small pure component with explicit
  props and is a suitable first UI-test exemplar.
- There are no existing tests, fake Chrome APIs, lint config, or CI jobs.

Conventions to preserve:

- TypeScript is strict, uses ES modules, two-space indentation, semicolons in
  TS/TSX, and path aliases under `@/`.
- Worker JavaScript is dependency-free, uses two-space indentation, semicolons,
  and returns serializable result objects such as `{ done: true }` or
  `{ error: "..." }`.
- React components use explicit prop object types rather than `React.FC`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Add test tooling | `pnpm add -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/node` | exit 0; manifest and lockfile updated |
| Tests | `pnpm test` | exit 0; all tests pass |
| Aggregate gate | `pnpm check` | exit 0; typecheck, worker syntax, tests, and production build pass |
| Whitespace | `git diff --check` | exit 0, no output |

## Scope

**In scope**:

- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- Create `vitest.config.ts`
- Create `tests/setup.ts`
- Create `tests/helpers/chromeMock.ts`
- Create `tests/helpers/backgroundHarness.ts`
- Create `tests/background.baseline.test.ts`
- Create `tests/ui/ReviewGroups.test.tsx`

**Out of scope**:

- Any behavior change in `public/background.js` or `src/`.
- Moving, bundling, converting, or adding exports to the service worker.
- Adding ESLint, Prettier, CI, coverage thresholds, browser E2E, or snapshot
  tests.
- Real Chrome calls, real provider calls, real timers, or network access in
  tests.
- Asserting the known-bug behavior that URL fragments are discarded.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, use one logical commit such as
  `test: add worker and popup verification baseline`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Add test dependencies and scripts

Install the listed development dependencies with pnpm. Preserve Plan 001's
`engines` declaration and do not upgrade unrelated packages.

Add these scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"check": "tsc --noEmit && node --check public/background.js && vitest run && vite build"
```

Keep `build` as `tsc --noEmit && vite build` and `dev` as
`vite build --watch`.

**Verify**:

```sh
node -e 'const p=require("./package.json"); for (const k of ["test","test:watch","check"]) if (!p.scripts[k]) process.exit(1)'
pnpm install --frozen-lockfile
```

Expected: both commands exit 0.

### Step 2: Configure Vitest and TypeScript test checking

Create `vitest.config.ts` with:

- `environment: "jsdom"` as the default;
- `setupFiles: ["./tests/setup.ts"]`;
- `clearMocks: true` and `restoreMocks: true`;
- the same `@` alias used by `vite.config.ts`.

Update `tsconfig.json` so TypeScript checks `src`, `tests`, and
`vitest.config.ts`. Add Node types alongside Chrome types. Tests must import
`describe`, `it`, `expect`, and mocks explicitly from `vitest`; do not enable
ambient Vitest globals.

Create `tests/setup.ts`:

- import `@testing-library/jest-dom/vitest`;
- call Testing Library `cleanup` after each test;
- restore mocks after each test;
- remove any test-assigned `globalThis.chrome` between tests.
- provide only the minimal deterministic DOM shims Radix needs if jsdom lacks
  them (for example `ResizeObserver` or `PointerEvent`); do not mock application
  behavior in global setup.

Do not copy the production Tailwind stylesheet into tests.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0 and no TypeScript diagnostics.

### Step 3: Create a reusable, deterministic Chrome API fake

Create `tests/helpers/chromeMock.ts`. It must expose a factory rather than one
shared singleton so tests cannot leak state. The returned object must include:

- listener registries for `runtime.onMessage`, `runtime.onInstalled`,
  `runtime.onStartup`, `storage.onChanged`, `tabs.onCreated`,
  `tabs.onRemoved`, `tabs.onUpdated`, `notifications.onClicked`, and
  `notifications.onButtonClicked`;
- in-memory `storage.local`, `storage.sync`, and `storage.session` implementing
  Promise-based `get`, `set`, and `remove` with Chrome's default-object
  semantics;
- spies/default implementations for the `tabs`, `tabGroups`, `windows`,
  `action`, `notifications`, `permissions`, `scripting`, and `runtime` methods
  used by the worker and popup;
- helpers for seeding storage, resolving the current window, inspecting writes,
  and emitting registered events;
- no real timer or network behavior.

Default the current normal window to a stable numeric ID and default queries to
empty arrays. Make every behavior overrideable per test with Vitest mocks.
Match Chrome's Promise API shapes; do not invent a second application API.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 4: Load the classic worker without changing production code

Create `tests/helpers/backgroundHarness.ts`. It must:

1. Read `public/background.js` as text.
2. Evaluate it in a fresh `node:vm` context for every test.
3. Inject the Chrome fake, `URL`, `AbortController`, Promise primitives, and
   inert timer functions. The startup `scheduleAutoCheck()` call must not run
   asynchronously during baseline tests.
4. Capture the registered `runtime.onMessage` listener.
5. Append a **test-only string inside the VM evaluation**, not production code,
   that assigns only named private functions needed by tests to
   `globalThis.__focusedTestExports`. Start with:
   `sanitizePlan`, `safeImportUrl`, and `normalizedDuplicateUrl`.
6. Provide an `invokeMessage(message)` helper that wraps `sendResponse` and
   rejects if a known handler never responds.
7. Provide a cleanup method that clears any VM timers.

Do not add `export` statements, test globals, or test hooks to
`public/background.js`. Doing so would change how Manifest V3 loads it.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 5: Add non-bug-dependent worker characterization tests

Create `tests/background.baseline.test.ts` with at least these cases:

1. Evaluating the worker registers exactly one runtime message listener.
2. An unknown message type returns `false` synchronously.
3. `safeImportUrl` accepts HTTPS URLs.
4. `safeImportUrl` rejects `javascript:` and `data:` URLs.
5. `sanitizePlan` removes unknown tab IDs and assigns a candidate tab to at
   most one group.
6. A known read-only message handler returns a serializable response through
   `sendResponse` using the Chrome fake.

Do not assert that `normalizedDuplicateUrl` strips hashes; Plan 006 fixes that
known defect.

**Verify**:

```sh
pnpm test -- tests/background.baseline.test.ts
```

Expected: exit 0 with at least six passing tests.

### Step 6: Add the first component characterization test

Create `tests/ui/ReviewGroups.test.tsx` using Testing Library and
`@testing-library/user-event`. Cover:

1. The heading and provided group names render.
2. With an empty selection the Apply button is disabled.
3. With one selected group, clicking Apply calls `onApply` exactly once.
4. Toggling a group calls `onSelectedChange` with the expected new Set.

Use role/name queries; do not use snapshots or CSS class assertions. This file
is the structural exemplar for the UI tests added in Plan 007.

**Verify**:

```sh
pnpm test -- tests/ui/ReviewGroups.test.tsx
```

Expected: exit 0 with four or more passing tests.

### Step 7: Run the aggregate gate

Run:

```sh
pnpm check
git diff --check
git status --short
```

Expected:

- `pnpm check` exits 0;
- the test suite contains at least ten passing tests total;
- the production build succeeds;
- `git diff --check` prints nothing;
- only in-scope files differ from the post-Plan-001 tree.

## Test plan

This plan is itself the test-infrastructure plan. Required coverage:

- VM isolation and runtime-listener capture;
- storage default/get/set/remove semantics;
- safe import URL boundaries;
- plan sanitation invariants;
- promise-based message response;
- basic ReviewGroups interaction.

Tests must be deterministic under repeated execution:

```sh
pnpm test
pnpm test
```

Expected: both runs pass with the same test count and no open-handle warning.

## Done criteria

- [ ] `pnpm test` exists and exits 0.
- [ ] `pnpm check` runs typecheck, worker syntax, all tests, and Vite build.
- [ ] Tests and `vitest.config.ts` are included in TypeScript checking.
- [ ] Worker tests evaluate a fresh VM context and never edit production code.
- [ ] Chrome APIs, storage, timers, and provider network are fake/deterministic.
- [ ] At least six worker and four component tests pass.
- [ ] `pnpm check` exits 0 twice consecutively.
- [ ] `git diff --check` exits 0.
- [ ] No production runtime source changed.
- [ ] Plan 002 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- Plan 001 is not complete or its package changes differ from the documented
  `preview`/`engines` edits.
- The worker cannot be evaluated without adding production exports, changing
  the manifest to a module worker, or executing real timers/network.
- A test requires changing current production behavior to pass.
- pnpm proposes unrelated dependency upgrades or lockfile replacement.
- The VM harness needs to expose a secret or read local extension storage.
- `pnpm check` fails twice after a reasonable harness/configuration correction.

## Maintenance notes

- Later plans should extend the Chrome fake rather than creating one-off mocks.
- Every regression test must create a fresh worker VM because service-worker
  module state includes queues, maps, and timers.
- Keep tests behavior-oriented. Do not freeze entire message objects or UI
  markup with snapshots.
- Static typing for the worker remains deferred. Once behavior coverage is
  mature, a separate plan can move it into a typed build safely.
