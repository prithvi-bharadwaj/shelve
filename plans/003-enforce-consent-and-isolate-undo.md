# Plan 003: Enforce AI consent and isolate undo by browsing context

> **Executor instructions**: Follow this plan exactly and run every verification
> gate. This plan changes privacy and recovery behavior; do not broaden it into
> a general storage refactor. Stop on any listed STOP condition. When complete,
> update the Plan 003 row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- public/background.js src/popup/Popup.tsx tests`
>
> Plans 001–002 intentionally add/remove non-runtime files and add the test
> harness. Production excerpts below must still match. If another change has
> altered consent, undo keys, message shapes, or snapshot fields, stop.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-establish-verification-baseline.md`
- **Category**: security | bug
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

The popup initializes AI-data acknowledgement to `true` and corrects it only
after asynchronous storage reads. A fast organize click can therefore send tab
titles and URLs before the user has acknowledged the disclosure. The worker
already guards command requests, but not organize requests, so UI state alone
is not a security boundary.

Undo snapshots contain full URLs and use one global storage key. Organize,
ungroup, or duplicate cleanup in an incognito window can place those URLs in
shared session storage or the persistent local fallback, and a regular popup
can see the same undo record. This plan makes worker-side consent mandatory,
versions and scopes regular undo records per window, and keeps incognito undo
strictly memory-only.

## Current state

- `src/popup/Popup.tsx:53` defaults acknowledgement to allowed:

  ```tsx
  const [acknowledged, setAcknowledged] = useState(true);
  ```

- `src/popup/Popup.tsx:124-153` loads `dataNoticeAck` asynchronously.
- `src/popup/Popup.tsx:444-447` enables Organize whenever the ordinary
  `disabled` state is false.
- `public/background.js:349-352` already provides:

  ```js
  async function hasDataNoticeAck() {
    const stored = await chrome.storage.local.get({ dataNoticeAck: false });
    return Boolean(stored.dataNoticeAck);
  }
  ```

- `public/background.js:386-405` creates/persists an organize job before any
  consent check; `public/background.js:445` sends the first classification
  prompt without calling `hasDataNoticeAck`.
- `public/background.js:1077` correctly guards the command path, which is the
  behavior to match.
- `public/background.js:895-912` captures tab URLs without the window's
  incognito flag.
- `public/background.js:915-922` writes one `undoSnapshot` key to session
  storage and falls back to persistent local storage.
- `public/background.js:925-945` reads that same global key without a window or
  browsing-context check.
- `public/background.js:354-376` maps `hasUndo` and `undo` messages without
  forwarding `msg.windowId`.
- `src/popup/Popup.tsx:62-65` and `src/popup/Popup.tsx:315-321` send those
  messages without a window ID.

Applicable conventions:

- Worker handlers return an error object rather than throwing for expected
  user-state failures.
- Promise rejections from optional storage cleanup are caught and do not hide a
  successful primary operation.
- Popup actions use one `Status` object and Chrome Promise APIs.
- Tests must use the VM/Chrome fake created by Plan 002; production worker code
  must remain a classic script with no exports.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused worker tests | `pnpm test -- tests/background.security.test.ts` | all pass |
| Focused popup tests | `pnpm test -- tests/ui/Popup.security.test.tsx` | all pass |
| Full gate | `pnpm check` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0, no output |
| Whitespace | `git diff --check` | exit 0, no output |

## Scope

**In scope**:

- `public/background.js`
- `src/popup/Popup.tsx`
- Extend `tests/helpers/chromeMock.ts`
- Extend `tests/helpers/backgroundHarness.ts`
- Create `tests/background.security.test.ts`
- Create `tests/ui/Popup.security.test.tsx`

**Out of scope**:

- Stash transaction/deletion behavior; Plan 005 owns it.
- Partial undo retry behavior and URL normalization; Plan 006 owns them.
- Removing merge, monitor, or popup settings; Plan 004 owns that cleanup.
- Changing which tab metadata is sent after consent.
- Adding an incognito-specific permission, persistent incognito storage, or a
  new manifest permission.
- Sharing undo across different regular windows.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, suggested subject:
  `fix: enforce consent and isolate incognito undo`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Add worker-side organize consent enforcement

In `organize`, resolve the target window ID as today, then call
`hasDataNoticeAck()` **before** checking/creating `organizeJobs`, persisting a
job, listing models, querying tabs, or invoking a provider.

If acknowledgement is absent, return exactly:

```js
{ error: "Acknowledge the AI data notice in the popup first." }
```

Use the same wording as `runCommand`. Keep the existing command and stash-brief
checks. Do not trust `msg.hasContentPermission` as consent; it controls only
optional page snippet access.

**Verify**:

```sh
node --check public/background.js
git grep -n 'Acknowledge the AI data notice in the popup first' -- public/background.js
```

Expected: syntax exits 0 and the message appears in both organize and command
guard paths.

### Step 2: Represent uninitialized acknowledgement explicitly in the popup

In `Popup`:

1. Change `acknowledged` to `boolean | null` and initialize it to `null`.
2. Keep the storage result assignment as a real boolean.
3. Include `acknowledged === null` in the shared disabled calculation so
   Organize, CommandBar, quick actions, and stash controls cannot run while
   initial storage/window state is unresolved.
4. Pass `acknowledged === true` to `CommandBar`.
5. Keep the existing two-click disclosure behavior once the value has resolved
   to `false`.
6. Do not display the disclosure as accepted while the value is `null`.

The worker guard from Step 1 remains authoritative even if a future UI forgets
this disabled state.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0 with no type errors.

### Step 3: Introduce versioned, window-scoped undo keys

Replace the single undo constant with:

- `LEGACY_UNDO_KEY = "undoSnapshot"`;
- `UNDO_KEY_PREFIX = "undoSnapshot:v2:"`;
- a helper that returns `undoSnapshot:v2:<windowId>` only for an integer window
  ID;
- an in-memory `Map` named for incognito undo snapshots, keyed by window ID.

Every newly captured snapshot must include:

```js
{
  version: 2,
  windowId,
  incognito: Boolean(window.incognito),
  // existing tabs, groups, closedUrls, closedTabIds fields
}
```

Fetch the window and tabs/groups together in `captureSnapshot`. If the target
window cannot be read, let snapshot capture fail before the destructive action
runs.

Add an idempotent privacy migration that removes `LEGACY_UNDO_KEY` from both
`storage.session` (when available) and `storage.local`. Never attempt to
migrate an unversioned legacy record because it does not state whether it came
from incognito. Losing one old undo record on extension update is the
privacy-safe choice.

**Verify**:

```sh
git grep -n 'undoSnapshot:v2:' -- public/background.js
git grep -n 'version: 2' -- public/background.js
node --check public/background.js
```

Expected: all commands exit 0 and show the new declarations/capture field.

### Step 4: Store incognito undo only in worker memory

Refactor `storeUndoSnapshot(snapshot)`:

- If `snapshot.incognito` is true, place it in the in-memory Map and return.
  Do not call `storage.session.set` or `storage.local.set`.
- For a regular snapshot, write the per-window v2 key to session storage, remove
  the same key from local storage, and retain the current local fallback only
  when session storage is unavailable/fails.
- Before accepting a snapshot, require `version === 2`, an integer `windowId`,
  and a boolean `incognito`; throw on malformed internal data rather than
  silently persisting it.

Refactor `getUndoSnapshot(windowId)`:

1. Resolve/validate the target window and determine its current incognito flag.
2. For incognito, return only the in-memory entry for that exact window.
3. For regular browsing, read only that window's v2 session/local key.
4. Reject and remove a stored record unless its version, window ID, and
   `incognito === false` match the request.
5. Never fall back to `LEGACY_UNDO_KEY`.

Refactor `clearUndoSnapshot(windowId)` to remove the memory entry and that
window's session/local v2 key. Add a `chrome.windows.onRemoved` listener that
deletes the matching memory entry.

**Verify**:

```sh
node --check public/background.js
git grep -n 'LEGACY_UNDO_KEY' -- public/background.js
```

Expected: syntax passes; legacy key occurrences are limited to declaration and
removal, never reads or writes of snapshot content.

### Step 5: Scope undo messages to the popup window

Change the dispatcher contracts to:

```js
undo: () => undo(msg.windowId),
hasUndo: () => hasUndo(msg.windowId),
```

Update `hasUndo` and `undo` to accept a window ID and call the scoped
`getUndoSnapshot`/`clearUndoSnapshot` functions.

In `Popup`:

- make `refreshUndo` accept the current `windowId` and no-op while it is absent;
- during initialization, pass the freshly fetched `window.id` to `hasUndo`
  rather than relying on React state that has not committed yet;
- send `windowId` with every `hasUndo` and `undo` message;
- after an action, refresh only that window's undo state.

If a snapshot's stored window differs from the requested window, return
`{ error: "Nothing to undo." }` and do not mutate any tabs.

**Verify**:

```sh
git grep -nE 'type: "hasUndo"|type: "undo"' -- src/popup/Popup.tsx
git grep -nE 'hasUndo:|undo:' -- public/background.js
pnpm exec tsc --noEmit
```

Expected: every popup message includes `windowId`, worker handlers forward it,
and typecheck exits 0.

### Step 6: Add worker security regression tests

Extend the Plan 002 harness test-only export list with the snapshot functions
and any key helper required to inspect behavior. Do not export them from
production.

Create `tests/background.security.test.ts` covering:

1. Direct `organize` message with `dataNoticeAck: false` returns the exact
   acknowledgement error and does not query tabs or call `fetch`.
2. With acknowledgement true, organize proceeds beyond the consent guard
   (it may then return the configured missing-key/not-enough-tabs result).
3. Capturing an incognito window marks the snapshot v2/incognito.
4. Storing an incognito snapshot performs zero session/local `set` calls.
5. An incognito snapshot is visible only to that exact incognito window.
6. A regular snapshot uses only `undoSnapshot:v2:<windowId>`.
7. A regular window cannot read another regular window's record.
8. A regular window cannot read an incognito in-memory record.
9. Legacy `undoSnapshot` values are deleted and never returned.
10. Removing an incognito window deletes its in-memory undo record.

Use two regular and two incognito window fixtures with distinct IDs and URLs so
cross-context mistakes are visible.

**Verify**:

```sh
pnpm test -- tests/background.security.test.ts
```

Expected: ten or more tests pass, with no real storage/network/timers.

### Step 7: Add the popup initialization regression test

Create `tests/ui/Popup.security.test.tsx`. Use a deferred Promise for the
initial `chrome.storage.local.get` call:

1. Render `Popup` while the storage Promise is unresolved.
2. Assert Organize, the command input/send control, and visible destructive
   actions are disabled.
3. Resolve storage with `dataNoticeAck: false` and assert the UI enters the
   existing disclosure flow rather than sending organize immediately.
4. Resolve a separate test with `dataNoticeAck: true` and assert controls become
   enabled after initialization.
5. Assert `hasUndo` initialization is sent with the fetched current window ID.

Use fake timers and unmount after each test so no organize polling remains.

**Verify**:

```sh
pnpm test -- tests/ui/Popup.security.test.tsx
```

Expected: five or more tests pass.

### Step 8: Run the complete gate

```sh
pnpm check
git diff --check
git status --short
```

Expected: all commands succeed; only in-scope production/test files and the
Plan 003 status row differ from the post-Plan-002 tree.

## Test plan

Required regression coverage:

- UI controls cannot act while consent storage is unresolved.
- Worker rejects organize without acknowledgement regardless of caller UI.
- No tab query/provider request occurs before the worker guard.
- Regular undo is keyed and readable only by the target regular window.
- Incognito undo uses memory only and cannot cross window/context boundaries.
- Legacy unscoped undo data is discarded.
- Window removal clears ephemeral private state.

All tests run under `pnpm check`.

## Done criteria

- [ ] `acknowledged` initializes to `null`, not `true`.
- [ ] Organize consent is enforced inside the worker before job/provider/tab
      work.
- [ ] Every new undo snapshot is version 2 and records incognito state.
- [ ] No incognito URL is written to session or local storage.
- [ ] Regular snapshots use per-window keys.
- [ ] `undo` and `hasUndo` require the requesting window ID.
- [ ] Legacy global undo storage is deleted, never migrated/read.
- [ ] Ten or more worker security tests pass.
- [ ] Popup initialization regression tests pass.
- [ ] `pnpm check` and `git diff --check` exit 0.
- [ ] No out-of-scope file is modified.
- [ ] Plan 003 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- The worker no longer uses the classic-script message dispatcher shown above.
- Chrome APIs in the supported target cannot report `window.incognito`.
- The proposed fix would persist incognito URLs in any storage area.
- Undo must remain shared between windows for an undocumented product
  requirement.
- Correct scoping appears to require a new permission.
- A test can pass only by weakening the worker-side consent guard.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- All future AI entry points must enforce `hasDataNoticeAck` in the worker, not
  only in React.
- Any new undo operation must pass its originating window ID through the
  message boundary.
- Incognito undo intentionally disappears when the MV3 worker is terminated.
  Do not "improve" persistence without a privacy design review.
- Plan 006 extends the v2 snapshot with partial-restore bookkeeping; reviewers
  should ensure that extension never reintroduces a global undo key.
