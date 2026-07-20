# Plan 007: Resolve credential, review, command, model, and polling races

> **Executor instructions**: This final cleanup plan addresses several small
> async/state races that share the Popup/Options message boundary. Follow the
> named contracts; do not fold in deferred spend, prompt-size, or worker-typing
> work. Run every gate and stop on listed conditions. Update Plan 007 in
> `plans/README.md` when complete unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- public/background.js src/popup/Popup.tsx src/popup/CommandBar.tsx src/popup/ReviewGroups.tsx src/options/Options.tsx tests`
>
> Plans 003–006 intentionally change these files. Confirm the selected current
> behaviors described below still exist. Preserve worker consent enforcement,
> versioned/window-scoped undo, removed merge/monitor surfaces, transactional
> stash, and partial-undo journaling.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/006-preserve-urls-and-partial-undo.md`
- **Category**: bug | perf | migration
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

Upgraded users can clear the Anthropic credential field and have an old
`apiKey` silently restore it on the next load. Review mode has no discard path,
so rejecting every suggestion traps the popup until the persisted result
expires. Command activity is local to CommandBar, leaving destructive parent
actions active while a provider request uses a stale tab snapshot.

Options can also apply a slow model-list response for the previously selected
provider, and Popup sends status messages every 450 ms forever even when no job
exists. These are small fixes with clear tests; together they remove the
remaining rushed state races in the recommended scope.

## Current state

- `public/background.js:35-42` includes legacy `apiKey` in local defaults and
  `public/background.js:343` uses it as an Anthropic fallback.
- `src/options/Options.tsx:77-96` reads/falls back to `apiKey`.
- `src/options/Options.tsx:133-137` saves new credential fields but never removes
  the legacy key.
- `src/popup/Popup.tsx:191-207` reads provider credentials only to preflight
  organize and also falls back to `apiKey`; the worker already performs the
  authoritative provider-access check.
- `src/popup/Popup.tsx:112-117` retains review results; `ReviewGroups.tsx:52-55`
  exposes only Apply, disabled when selection is empty.
- `src/popup/CommandBar.tsx:16-18` owns `running` locally and
  `src/popup/Popup.tsx:378-380` cannot include it in shared disabled state.
- `src/options/Options.tsx:50-67` lets every async model request write shared
  state; `src/options/Options.tsx:110-115` launches requests on provider
  changes without request identity.
- `src/popup/Popup.tsx:162-189` starts a 450 ms status loop whenever a window ID
  exists, rescheduling even after `{ job: null }`.

Conventions:

- Storage migrations are idempotent and remove obsolete fields after preserving
  the current value once.
- Worker remains authoritative for credentials and consent.
- Popup results use the existing `Status` object.
- Async UI work uses `try/finally` so busy state always clears.
- Tests use fake timers and deferred Promises; no real provider requests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Credential tests | `pnpm test -- tests/background.credentials.test.ts` | all pass |
| UI race tests | `pnpm test -- tests/ui/ReviewGroups.test.tsx tests/ui/CommandBar.test.tsx tests/ui/Popup.races.test.tsx tests/ui/Options.models.test.tsx` | all pass |
| Full gate | `pnpm check` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `public/background.js`
- `src/popup/Popup.tsx`
- `src/popup/CommandBar.tsx`
- `src/popup/ReviewGroups.tsx`
- `src/options/Options.tsx`
- Extend `tests/helpers/chromeMock.ts` and existing tests as required
- Create `tests/background.credentials.test.ts`
- Extend `tests/ui/ReviewGroups.test.tsx`
- Create `tests/ui/CommandBar.test.tsx`
- Create `tests/ui/Popup.races.test.tsx`
- Create `tests/ui/Options.models.test.tsx`

**Out of scope**:

- Provider model/default/pricing changes.
- Shared typed settings modules or worker conversion.
- Spend-cap reservations/queue recovery.
- Prompt bounding/chunking or filing animation batching.
- Remote Ollama permission policy.
- Removing CommandBar, review mode, or provider support.
- Adding background-wide locks across multiple simultaneously open popups.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, suggested subject:
  `fix: resolve popup and settings async races`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Add one idempotent legacy credential migration

In `public/background.js`:

1. Remove `apiKey` from `DEFAULT_LOCAL` and every ordinary fallback read.
2. Add a single-flight `migrateLegacyCredential()` helper:
   - read only `anthropicKey` and legacy `apiKey`;
   - if `anthropicKey` is empty and legacy `apiKey` is a non-empty string, copy
     the trimmed legacy value into `anthropicKey` once;
   - always remove `apiKey` after any required copy succeeds;
   - if storage rejects, reset the cached migration Promise so a later call can
     retry rather than remaining permanently rejected;
   - never log or return the credential value.
3. Await the migration at the start of `getSettings()`.
4. Expose a narrow `migrateLegacyCredential` runtime message so Options can
   request completion before reading local storage.
5. Add the migration Promise to the existing Plan-004 update cleanup listener.

Do not overwrite a non-empty modern `anthropicKey` with the legacy value.

**Verify**:

```sh
git grep -n 'local.apiKey' -- public/background.js
node --check public/background.js
```

Expected: no fallback matches; syntax exits 0.

### Step 2: Remove UI legacy fallbacks and make clearing durable

In `Options` initialization:

1. Await `chrome.runtime.sendMessage({ type: "migrateLegacyCredential" })`
   before reading local credential fields.
2. Read `openaiKey`, `anthropicKey`, `geminiKey`, `ollamaUrl`, and `spentUsd`
   without `apiKey`.
3. Assign `anthropicKey` directly; no fallback.

In `save`, after writing modern credential fields, explicitly remove
`apiKey`. This makes clearing the Anthropic field durable even during a mixed
version/update edge.

In `Popup.organize` remove the entire direct provider/key preflight. Send
organize to the worker after the disclosure/permission flow and display the
worker's existing missing-credential error. This removes duplicated credential
logic and every popup `apiKey` reference.

**Verify**:

```sh
git grep -nE 'apiKey|local[.]anthropicKey [|][|]' -- src public/background.js
pnpm exec tsc --noEmit
```

Expected: `apiKey` remains only in the explicit migration/removal code and
parameter names internal to Anthropic request helpers; no storage fallback
remains. Typecheck exits 0.

### Step 3: Add a real review discard route

Extend `ReviewGroups` props with `onDiscard: () => void`. Render an explicit
Discard/Back action alongside Apply:

- Discard remains enabled when zero groups are selected.
- Both controls are disabled while `applying`.
- Preserve the full-width/accessible button treatment at popup width.

In `Popup` add `discardReview`:

1. identify the current job ID from `organizeJob` or `handledJobId`;
2. consume the persisted result without applying any tabs;
3. only after the worker confirms `cleared: true`, clear `groups`, `selected`,
   and local organize-job state;
4. show neutral status such as "Suggestions discarded.";
5. if consumption rejects or returns `cleared: false`, keep the review screen
   and job ID intact, show a retryable error, and apply nothing.

Capture the job ID before awaiting, and never destroy it before the worker
confirms consumption. Do not call `applyPlan` with an empty group array.

**Verify**:

```sh
git grep -n 'onDiscard' -- src/popup
pnpm exec tsc --noEmit
```

Expected: both component and parent matches appear; typecheck exits 0.

### Step 4: Propagate CommandBar busy state to Popup

Keep CommandBar's query/result UI local, but add
`onRunningChange(running: boolean)` and notify the parent:

- set a synchronous ref/guard before requesting permissions or sending the
  message so double submission cannot race a React render;
- call `onRunningChange(true)` at the same moment;
- clear both local/ref and parent state in one `finally` block;
- unmount cleanup must notify `false` if a request was active.

In `Popup`:

- add `commandRunning` state;
- include it in the shared disabled state used by Organize, Ungroup, Close
  duplicates, Undo, review/stash actions, and Settings if appropriate;
- pass the callback to CommandBar;
- do not disable CommandBar in a way that prevents its own in-flight result from
  rendering.

This plan coordinates one popup. Do not add a global worker mutex or block
background stash-brief generation.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 5: Ignore stale provider-model responses

In `Options`:

1. import/use `useRef`.
2. Track both the currently selected provider and a monotonically increasing
   model-request generation.
3. Whenever provider changes, update the provider ref synchronously before
   launching `refreshModels`.
4. Capture provider and generation at request start.
5. After `sendMessage` resolves or rejects, update `models`,
   `modelStatus`, or Ollama's default model only when both still match current
   refs.
6. Invalidate outstanding requests on component unmount.
7. Keep current fallback lists and model IDs unchanged.

Do not use response arrival order as provider state. Do not write a returned
model under a different provider.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 6: Poll organize status only while a job is running

Replace the forever loop with two responsibilities:

1. **One mount/window restoration query**: when `windowId` becomes available,
   request `organizeStatus` once. If no job exists, stop. If a completed result
   exists, handle it once. If a running job exists, put it in state.
2. **Running-only polling**: while the known job status/running action is
   running, schedule the next request 450 ms after the previous one completes.
   Stop immediately when the response is done/error/null, review begins, the
   result is consumed, or the popup unmounts.

Use `setTimeout` after each awaited response, never `setInterval`, so requests
cannot overlap. Starting a local organize that returns `{ running: true, job }`
must activate the polling effect. Preserve persisted-result restoration across
popup close/reopen.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 7: Add credential migration tests

Create `tests/background.credentials.test.ts`:

1. Legacy-only value is copied to Anthropic and removed from `apiKey`.
2. Existing modern Anthropic value wins and legacy is removed.
3. Empty modern and empty legacy remain empty.
4. After migration, clearing Anthropic stays cleared across `getSettings`.
5. Two concurrent migration messages perform one logical migration.
6. A rejected storage operation resets the single-flight Promise and a later
   retry succeeds.
7. No message response/log contains the credential value.

Use sentinel fake values; never use a real provider key pattern.

**Verify**:

```sh
pnpm test -- tests/background.credentials.test.ts
```

Expected: seven or more tests pass.

### Step 8: Add UI race regression tests

Extend `tests/ui/ReviewGroups.test.tsx`:

- zero selected groups still allows Discard;
- Discard calls `onDiscard` once and never calls Apply;
- Popup discard consumes the job and returns to idle without `applyPlan`.

Create `tests/ui/CommandBar.test.tsx`:

- a deferred command Promise marks parent busy before permission/provider work;
- parent quick actions are disabled until the Promise settles;
- rejection clears busy state;
- rapid double-submit sends one message;
- unmount clears parent busy state.

Create `tests/ui/Options.models.test.tsx`:

- select provider A then B;
- resolve B first and A later;
- assert B's list/status/selected model remain;
- assert an old Ollama response cannot set the current provider's model;
- unmount ignores late responses.

Create `tests/ui/Popup.races.test.tsx` with fake timers:

- idle mount sends one `organizeStatus` request and sends no more after several
  seconds;
- a restored running job polls repeatedly;
- polling stops on done, error, review, null, and unmount;
- local organize result with a running job starts polling;
- no two status requests overlap when one is deferred.

**Verify**:

```sh
pnpm test -- tests/ui/ReviewGroups.test.tsx tests/ui/CommandBar.test.tsx tests/ui/Options.models.test.tsx tests/ui/Popup.races.test.tsx
```

Expected: all named cases pass.

### Step 9: Run the complete final gate

```sh
pnpm check
git diff --check
git grep -n 'apiKey' -- src public/background.js
git status --short
```

Expected:

- `pnpm check` and `git diff --check` exit 0;
- `apiKey` matches only explicit migration/removal code and Anthropic helper
  parameter names, never a fallback/default;
- only in-scope files plus Plan 007 status differ from the post-Plan-006 tree.

## Test plan

Required test groups:

- one-time credential migration, clearing, concurrency, and retry;
- review discard with zero selection and no mutation;
- command busy propagation and cleanup;
- out-of-order model responses and unmount;
- one-shot idle status query and running-only polling;
- all prior security/stash/undo suites remain green through `pnpm check`.

Tests must use deferred Promises and fake timers rather than sleeps.

## Done criteria

- [ ] Legacy `apiKey` is copied at most once, then removed.
- [ ] Clearing Anthropic credentials remains cleared.
- [ ] Popup no longer reads provider credentials.
- [ ] Review always has an enabled discard route when not applying.
- [ ] Discard consumes the persisted job without mutating tabs.
- [ ] Command busy state disables parent actions and always clears.
- [ ] Stale model responses cannot alter current provider state.
- [ ] Idle popup sends one status request, not a permanent 450 ms loop.
- [ ] Running/recovered organize jobs still update and survive popup reopen.
- [ ] All new focused tests and the complete prior suite pass.
- [ ] `pnpm check` and `git diff --check` exit 0.
- [ ] Plan 007 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- Legacy credential migration would require displaying/logging a key.
- A non-Anthropic feature still intentionally depends on `apiKey`.
- Discarding review would mutate tabs or require applying an empty plan.
- Busy propagation requires a global cross-window lock; that is outside this
  plan.
- Model-list response objects do not identify the requested provider and the
  caller cannot safely capture it.
- Running-only polling cannot restore persisted jobs without a permanent idle
  timer.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Future credential migrations should be versioned, single-flight, idempotent,
  and remove obsolete storage only after successful copy.
- Every new Popup async action should participate in shared busy state.
- Every async provider-specific UI response must carry/capture request identity.
- Persisted organize status should remain event-driven where possible; if a
  push channel is added later, it can replace running-only polling.
- Deferred spend/prompt/performance findings are listed in
  `plans/README.md` and must not be slipped into this cleanup review.
