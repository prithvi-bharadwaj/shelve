# Plan 006: Preserve distinct URLs and retain partial undo recovery

> **Executor instructions**: This plan changes duplicate-closing identity and
> undo journaling. Follow the schema and retry rules exactly; do not clear a
> snapshot merely because some restoration succeeded. Run all gates and stop on
> the listed conditions. Update Plan 006 in `plans/README.md` when complete
> unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- public/background.js src/popup/Popup.tsx tests`
>
> Plans 003–005 intentionally change snapshot storage, Popup actions, and stash
> code. Confirm the post-Plan-003 versioned/window-scoped snapshot contract is
> present before proceeding. If snapshots are not v2 or incognito records can
> persist, stop.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/005-make-stash-lifecycle-loss-resistant.md`
- **Category**: bug
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

Duplicate cleanup removes the entire URL fragment before comparing tabs.
Hash-routed applications commonly encode the selected document or route after
`#`, so two distinct documents can be classified as duplicates and one closed.

Undo then swallows per-tab/group failures and unconditionally deletes its only
snapshot. A transient Chrome API failure or closed target window can leave some
duplicate URLs missing and make retry impossible. This plan keeps fragments,
journals reopened tab IDs so retry cannot duplicate them, retains undo state on
retryable partial failure, and clears it only after all recoverable operations
succeed or are explicitly no longer recoverable.

## Current state

- `public/background.js:849-881` groups tabs by
  `normalizedDuplicateUrl(tab.url)` and closes all but protected/newest copies.
- `public/background.js:884-893` currently does:

  ```js
  function normalizedDuplicateUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }
  ```

- `public/background.js:873-877` records closed data in parallel arrays:

  ```js
  captured.closedUrls = toClose.map((tab) => tab.url).filter(Boolean);
  captured.closedTabIds = toClose.map((tab) => tab.id);
  ```

- `public/background.js:954-961` tolerates URL reopen failures.
- `public/background.js:964-1003` silently skips missing tabs and swallows
  grouping/mutation failures.
- `public/background.js:1006-1008` always clears the snapshot and returns
  success.
- Plan 003 changes storage to versioned, per-window regular keys and memory-only
  incognito records. Preserve that boundary and use its
  `storeUndoSnapshot(snapshot)` function to checkpoint retries.
- `src/popup/Popup.tsx:315-321` already displays `res.error` and refreshes
  window-scoped undo availability after the operation.

Conventions:

- Chrome mutation failures are expected runtime events and return serializable
  error results.
- Snapshot storage is the recovery journal; writes must occur before a later
  retry could duplicate a reopened tab.
- User-closed tabs that were not closed by the action have no stored URL and
  cannot be recreated. Report them as skipped, not endlessly retryable.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Worker undo tests | `pnpm test -- tests/background.undo.test.ts` | all pass |
| Popup undo tests | `pnpm test -- tests/ui/Popup.undo.test.tsx` | all pass |
| Full gate | `pnpm check` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `public/background.js`
- `src/popup/Popup.tsx`
- Extend `tests/helpers/chromeMock.ts` and
  `tests/helpers/backgroundHarness.ts` if needed
- Create `tests/background.undo.test.ts`
- Create `tests/ui/Popup.undo.test.tsx`

**Out of scope**:

- Changing which duplicate copy is protected (pinned, active, newest).
- Query-parameter canonicalization, tracking-parameter stripping, or
  domain-specific duplicate rules.
- Multi-window topology undo or restoring browser history/page state.
- Stash recovery; Plan 005 owns it.
- Persisting incognito undo.
- Adding a permanent undo history stack; retain one scoped snapshot per window.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, suggested subject:
  `fix: preserve URL fragments and retry partial undo`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Preserve URL fragments in duplicate identity

Remove `url.hash = ""` from `normalizedDuplicateUrl`. Continue parsing through
`new URL(value)` and returning its normalized `href`; invalid/empty values still
return `null`.

Do not add a special case for anchor-only hashes. Correctness takes precedence
over closing a few additional anchor duplicates.

**Verify**:

```sh
git grep -n 'url.hash = ""' -- public/background.js
node --check public/background.js
```

Expected: grep exits 1 with no output; syntax exits 0.

### Step 2: Replace parallel closed-tab arrays with journal entries

For new snapshots use:

```js
closedTabs: [
  {
    originalId: 123,
    url: "https://example.test/#/document/1",
    reopenedId: null
  }
]
```

`captureSnapshot` initializes `closedTabs: []`. `cleanDuplicates` fills it from
`toClose` and omits entries without a non-empty URL.

Add `normalizeUndoSnapshot(snapshot)` for records created between Plan 003 and
this plan:

- require the Plan 003 v2/window/incognito fields;
- if `closedTabs` is already an array, sanitize each entry;
- otherwise zip `closedTabIds` and `closedUrls` by index into `closedTabs`;
- set invalid/missing `reopenedId` to `null`;
- drop the old parallel fields from the normalized in-memory record.

Do not accept unversioned global snapshots; Plan 003 intentionally discards
those for privacy.

Apply normalization immediately after reading a snapshot and before restoring
it. New writes use only `closedTabs`.

**Verify**:

```sh
git grep -nE 'closedUrls|closedTabIds' -- public/background.js
git grep -n 'closedTabs' -- public/background.js
```

Expected: old names appear only inside the narrow v2 compatibility conversion;
new capture, duplicate cleanup, and undo use `closedTabs`.

### Step 3: Checkpoint every reopened tab before continuing

In `undo(windowId)`, for every `closedTabs` entry:

1. If `reopenedId` is an integer, call `chrome.tabs.get` and reuse it only if it
   still belongs to the snapshot window and its URL still equals the journaled
   URL.
2. If that tab is missing/moved/navigated, clear `reopenedId` in memory.
3. Create a fresh inactive tab only when no reusable tab exists.
4. Immediately assign its ID to `reopenedId` and persist the updated snapshot
   through Plan 003's scoped `storeUndoSnapshot` **before** opening the next
   URL or changing group layout.
5. If checkpoint persistence fails, best-effort close the just-created tab and
   return a partial error without continuing. Never leave a new unjournaled tab
   and then report success.
6. If `tabs.create` fails, leave that entry pending and collect a retryable
   failure.

Build the old-to-current ID map from these journal entries. A retry must reuse
checkpointed IDs and create no duplicate tabs.

**Verify**:

```sh
node --check public/background.js
```

Expected: exit 0.

### Step 4: Track retryable restoration failures

Refactor the restoration phases so failures are recorded instead of swallowed:

- closed URL creation/checkpoint failure: retryable;
- ungroup failure: retryable;
- pin update failure: retryable;
- move failure: retryable;
- group creation, metadata update, or group move failure: retryable;
- an original tab missing after the user's later action and lacking a
  `closedTabs` entry: not recreatable; increment `skippedCount` and continue.

It is acceptable to re-run the desired layout idempotently on retry:

1. resolve currently available original/reopened tabs;
2. ungroup those tabs;
3. set pin state;
4. move by original index;
5. recreate desired groups and metadata.

Before retrying a successful prior grouping, the ungroup phase returns it to a
known state. Never close a tab during undo.

Return shapes:

- Complete:

  ```js
  {
    done: true,
    tabCount,
    reopenedCount,
    skippedCount
  }
  ```

- Retryable partial:

  ```js
  {
    error: "Undo partially restored. Retry Undo to finish.",
    partial: true,
    tabCount,
    reopenedCount,
    failedCount,
    skippedCount
  }
  ```

Keep the snapshot on the partial path. Clear it only on complete success after
all retryable operations have succeeded. Skipped unrecoverable later-closed
tabs do not by themselves retain the snapshot forever.

**Verify**:

```sh
git grep -n 'clearUndoSnapshot' -- public/background.js
```

Expected: the undo call site is visibly inside the complete-success branch, not
an unconditional tail/finally.

### Step 5: Make popup feedback honest and preserve Retry Undo

In `Popup.undo`:

- retain the existing window-scoped message and `refreshUndo` call;
- if `res.partial`, show its error text and leave Undo enabled because the
  worker retained the snapshot;
- on complete success with `skippedCount > 0`, report that the available layout
  was restored and name the skipped count;
- use "Previous tab layout restored" only when complete with zero skipped
  items.

Do not add a second undo-history UI or a discard button in this plan.

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 6: Add duplicate and undo regression tests

Create `tests/background.undo.test.ts` with at least:

Duplicate identity:

1. Two identical full URLs are duplicates.
2. `/#/document/1` and `/#/document/2` are distinct.
3. `#section-a` and `#section-b` are distinct.
4. Invalid URLs are ignored.
5. Pinned/active/newest protection remains unchanged.

Snapshot compatibility:

6. A Plan-003 v2 snapshot with parallel closed arrays normalizes to
   `closedTabs`.
7. An unversioned snapshot is rejected.
8. Incognito storage behavior from Plan 003 remains memory-only.

Retry behavior:

9. All operations succeed: snapshot is cleared.
10. One URL fails to reopen: snapshot remains and partial is returned.
11. A second retry reuses the previously checkpointed reopened tab and creates
    only the failed URL.
12. Group creation failure retains the snapshot.
13. Pin/move failure retains the snapshot.
14. A user-closed original tab without a closed URL increments skipped count
    but does not make successful undo permanently retryable.
15. Checkpoint storage failure closes the just-created tab best-effort and does
    not clear recovery state.
16. A mapped reopened tab that navigated is not reused for the original URL.
17. A regular window cannot consume another window's partial snapshot.

Create `tests/ui/Popup.undo.test.tsx`:

18. Partial result displays retry copy and Undo remains enabled after refresh.
19. Complete result with skipped items uses honest status copy.
20. Complete result with no skips uses the ordinary success copy.

Use fresh VM/storage fixtures for each case.

**Verify**:

```sh
pnpm test -- tests/background.undo.test.ts tests/ui/Popup.undo.test.tsx
```

Expected: twenty or more tests pass.

### Step 7: Run the full gate

```sh
pnpm check
git diff --check
git status --short
```

Expected: all commands pass and only in-scope files plus Plan 006 status differ
from the post-Plan-005 tree.

## Test plan

The mandatory cases are listed in Step 6. Tests must assert:

- exact tabs passed to `chrome.tabs.remove` during duplicate cleanup;
- exact storage keys/content after each undo phase;
- snapshot presence after partial and absence after complete success;
- `tabs.create` call counts across retries;
- window/context boundaries from Plan 003 remain intact.

Do not rely only on response objects.

## Done criteria

- [ ] URL fragments remain part of duplicate identity.
- [ ] New snapshots use `closedTabs` journal entries.
- [ ] Plan-003 v2 parallel arrays are safely normalized.
- [ ] Every reopened tab ID is checkpointed before further restore work.
- [ ] Retry reuses checkpointed tabs and creates no duplicates.
- [ ] Any retryable Chrome/storage failure retains the snapshot.
- [ ] Snapshot clears only after complete recoverable restoration.
- [ ] Unrecoverable user-closed tabs are reported as skipped.
- [ ] Popup distinguishes partial, skipped, and complete outcomes.
- [ ] Twenty or more focused tests pass.
- [ ] `pnpm check` and `git diff --check` exit 0.
- [ ] Plan 006 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- Plan 003's versioned/window-scoped/incognito-memory undo contract is absent.
- Reopening exact URLs requires a new permission.
- A retry-safe design would close existing user tabs.
- Snapshot compatibility would require accepting an unversioned record whose
  incognito origin is unknown.
- The only proposed solution clears recovery state after a partial failure.
- A checkpoint cannot be persisted without leaking incognito data.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Treat fragments as semantic unless a future, separately tested
  domain-specific rule proves otherwise.
- Any future snapshot schema needs a version bump and an explicit privacy-safe
  migration.
- The `reopenedId` journal is what makes retry idempotent; reviewers should
  reject refactors that recreate closed URLs before consulting it.
- This remains one undo record per regular window and ephemeral per incognito
  window. A history stack is deliberately out of scope.
