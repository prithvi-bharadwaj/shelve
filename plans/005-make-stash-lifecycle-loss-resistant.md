# Plan 005: Make the stash lifecycle loss-resistant

> **Executor instructions**: Follow the state transitions in this plan exactly.
> Stashes may be the only surviving record of tabs already closed by Focused.
> Do not simplify this to "catch errors" or delete on partial success. Run each
> gate and stop on the listed conditions. Update Plan 005 in
> `plans/README.md` when done unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- public/background.js src/popup/Popup.tsx src/popup/StashPanel.tsx src/types.ts README.md tests`
>
> Plans 003–004 intentionally change consent, undo, Popup state, and remove
> monitor calls. The stash excerpts and `mutateStashes` queue below must still
> match semantically. If stash schema/resume behavior changed independently,
> stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/004-remove-merge-monitor-popup-settings.md`
- **Category**: bug | security
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

Current resume treats any non-empty set of reopened tabs as success and then
deletes the whole stash. One refused URL or group API failure can therefore
erase the only saved copy of tabs Focused already closed. Two resume requests
can also read the same stash concurrently and create duplicate groups.

Deletion is an adjacent one-click icon with no confirmation. Stash creation
also re-fetches a moved group correctly but creates its safety tab in the stale
original window. This plan makes resume claimed, crash-aware, all-or-nothing,
and retryable; keeps stored data on every partial failure; blocks stash data in
incognito in both directions; and requires explicit deletion confirmation.

## Current state

- `public/background.js:1178-1190` already serializes writes:

  ```js
  let stashQueue = Promise.resolve();

  function mutateStashes(mutator) {
    stashQueue = stashQueue.catch(() => undefined).then(async () => {
      const stored = await chrome.storage.local.get({ [STASH_KEY]: [] });
      const next = mutator(Array.isArray(stored[STASH_KEY]) ? stored[STASH_KEY] : []);
      await chrome.storage.local.set({ [STASH_KEY]: next });
      return next;
    });
    return stashQueue;
  }
  ```

  Reuse this queue; do not introduce a second competing stash write path.

- `public/background.js:1227-1229` correctly refuses stash creation from an
  incognito group because local storage is shared.
- `public/background.js:1251-1255` re-fetches the group/window after snippet
  collection.
- `public/background.js:1260-1269` persists URL/title records before closing.
- `public/background.js:1273-1276` creates a safety tab with stale
  `group.windowId`, ignores creation failure, and then removes the fresh tabs.
- `public/background.js:1316-1329` lists shared stashes without knowing which
  popup window requested them.
- `public/background.js:1332-1357` reopens entries one by one, swallows
  failures, groups any successes, and deletes the full stash.
- `public/background.js:1360-1362` permanently deletes immediately.
- `src/popup/StashPanel.tsx:94-99` places Resume and Delete icon buttons next to
  one another and invokes Delete on the first click.
- `src/popup/Popup.tsx:67-75` sends `listStashes` without `windowId`.
- `README.md:11` promises the group returns "exactly as it was", though only
  HTTP(S) URL/title records are stored and fresh inactive tabs are created.

Conventions:

- Internal stash records live in `chrome.storage.local`; `publicStash` controls
  which fields reach React.
- All stash list mutations flow through `mutateStashes`.
- Expected failures return specific error objects and keep other operations
  usable.
- Incognito storage policy is conservative: no private browsing history is
  placed in shared storage.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Worker stash tests | `pnpm test -- tests/background.stash.test.ts` | all pass |
| Stash UI tests | `pnpm test -- tests/ui/StashPanel.test.tsx` | all pass |
| Full gate | `pnpm check` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `public/background.js`
- `src/popup/Popup.tsx`
- `src/popup/StashPanel.tsx`
- `src/types.ts`
- `README.md`
- Extend `tests/helpers/chromeMock.ts` and
  `tests/helpers/backgroundHarness.ts` as required
- Create `tests/background.stash.test.ts`
- Create or replace `tests/ui/StashPanel.test.tsx`

**Out of scope**:

- Removing stashes or AI briefs.
- Saving browser history, form state, scroll position, non-web URLs, or exact
  Chrome sessions.
- Adding `sessions`, database, alarms, or other permissions.
- Generating a brief during resume.
- Persisting any incognito stash or exposing regular stash metadata in an
  incognito popup.
- General import/export transaction behavior.
- Undo snapshot behavior; Plan 006 owns it.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, suggested subject:
  `fix: make stash resume transactional and recoverable`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Define an internal resume claim schema

Add a small constant such as `STASH_RESUME_STALE_MS = 2 * 60 * 1000`.
An internal stash may gain:

```js
resume: {
  token: "unique-attempt-token",
  startedAt: 0,
  targetWindowId: 123,
  opened: [
    { sourceIndex: 0, tabId: 456, url: "https://example.test/" }
  ]
}
```

Requirements:

- `token` uniquely identifies one attempt.
- `opened` is persisted immediately after each successful `tabs.create`.
- Source entries are addressed by stable array index; do not use old Chrome tab
  IDs as durable identity.
- `publicStash` must not expose token, target window, URLs, or opened tab IDs.
- Add `resumeStatus: "idle" | "resuming"` to the public stash shape and
  `src/types.ts`. Report `resuming` only while a non-stale claim exists.

Create queue-backed helpers with explicit outcomes:

- claim a stash (success, missing, already-resuming, or stale-recovery);
- persist one opened mapping only if token still matches;
- release a matching claim while retaining the stash;
- delete/consume a stash only if token still matches.

Never read-modify-write stashes outside `mutateStashes`.

**Verify**:

```sh
node --check public/background.js
pnpm exec tsc --noEmit
```

Expected: both commands exit 0.

### Step 2: Make stale-attempt recovery idempotent

When claiming a stash:

1. If a claim is younger than `STASH_RESUME_STALE_MS`, return
   `{ error: "This stash is already being resumed." }` without creating tabs.
2. For a stale claim, inspect each recorded `opened.tabId`:
   - reuse it only when the tab still exists, remains in the recorded target
     window, and its URL equals the recorded URL;
   - drop missing/mismatched records from the recovered attempt;
   - if valid reopened tabs still exist in a different live window than the
     new requested target, return a specific error naming that resume must be
     completed from the original window. Do not create duplicates or move tabs.
3. Start a fresh token while preserving validated opened mappings.

If the recorded target window no longer exists and none of its recorded tabs
exist, reset the attempt to the newly requested regular window.

This provides practical MV3 restart recovery without a new permission. Do not
claim exactly-once semantics across a crash between `tabs.create` and the next
storage write; Step 4 must roll back or retain the stash on ambiguity.

**Verify**:

```sh
pnpm test -- tests/background.stash.test.ts -t 'claim|stale|concurrent'
```

Expected after tests are added in Step 7: all matching tests pass. Before Step
7, run `node --check public/background.js` instead.

### Step 3: Enforce the incognito boundary for list and resume

Change the message contract:

```js
listStashes: () => listStashes(msg.windowId),
resumeStash: () => resumeStash(msg.stashId, msg.windowId)
```

`resumeStash` already receives a window ID but must resolve the target window
and reject it when `incognito` is true **before claiming or reading public stash
data into the operation**.

`listStashes(windowId)` must resolve the requesting window. For incognito,
return an empty list plus a stable flag such as:

```js
{ stashes: [], unavailableInIncognito: true }
```

In `Popup.refreshPanels`, send `windowId` with `listStashes`. Do not display
regular stash names, counts, or briefs in incognito.

**Verify**:

```sh
git grep -n 'type: "listStashes"' -- src/popup/Popup.tsx
node --check public/background.js
```

Expected: the popup message includes `windowId` and worker syntax passes.

### Step 4: Make resume all-or-nothing and claim-aware

Rewrite `resumeStash` around this order:

1. Resolve and validate a regular target window.
2. Claim the stash through the queue.
3. Validate that the stash contains at least one entry and that **every** URL
   is a safe URL. An invalid entry fails the attempt; do not silently drop it.
4. Reuse valid opened mappings recovered in Step 2.
5. Create each missing inactive tab sequentially. After each success, persist
   its mapping under the matching token before continuing.
6. If any tab creation fails, best-effort remove only tabs created during the
   current invocation, retain the stash, update/remove journal mappings for
   tabs that were actually rolled back, and return a clear error. Never close a
   valid tab recovered from an older persisted attempt; keep that mapping for
   retry.
7. Group the complete tab set and update name/color. Any group/update failure
   follows the same rollback-and-retain path.
8. Consume the stash only through a token-matching queue mutation after all
   tabs and group metadata succeed.
9. Return success only after that storage deletion succeeds.

If rollback cannot remove every newly opened tab, or if older recovered tabs
remain, retain their claim metadata and the stash so a retry can identify those
tab IDs. Return an error that says some tabs may already be open; never delete
the stash and never report ordinary success.

The result object should distinguish success from recoverable error and include
`tabCount` only on complete success.

**Verify**:

```sh
node --check public/background.js
```

Expected: exit 0.

### Step 5: Protect stash creation with the fresh window

In `stashGroup`:

1. After `freshGroup` and `allTabs` are fetched, use
   `freshGroup.windowId` consistently.
2. Build the saved name/color from `freshGroup`, not the stale initial group.
3. If closing the saved tabs would empty the fresh window, create a safety tab
   in `freshGroup.windowId` and require that creation to succeed.
4. Create the safety tab **before** persisting/closing. If stash persistence
   fails, best-effort close only the newly created safety tab.
5. Persist the stash before removing saved tabs.
6. If tab removal fails, leave the persisted stash intact and return an error;
   data duplication is safer than data loss.

Continue closing only HTTP(S) tabs actually written to the stash. Do not close
unsaved `chrome:`, `file:`, or other group members.

**Verify**:

```sh
git grep -n 'windowId: group.windowId' -- public/background.js
node --check public/background.js
```

Expected: no stale-window match remains in stash creation; syntax exits 0.

### Step 6: Require explicit stash deletion confirmation

In `StashPanel` add local confirmation state keyed by stash ID.

Behavior:

- First Delete icon click does not call `onDelete`. Replace/expand that row's
  controls with visible text "Delete this stash?" and explicit Cancel/Delete
  buttons.
- Cancel restores normal row controls.
- Confirm calls `onDelete` exactly once and clears confirmation after the
  Promise/callback completes.
- Resume, delete, and stash controls remain disabled during any current busy
  operation or while `resumeStatus === "resuming"`.
- Use buttons with accessible names; do not rely on icon/color alone.

Change `onDelete`'s prop to return `Promise<void>` if needed so the component can
await it. In `Popup.deleteStash`, inspect the worker response and show an error
instead of always saying "Stash deleted".

**Verify**:

```sh
pnpm exec tsc --noEmit
```

Expected: exit 0.

### Step 7: Add stash state-machine tests

Create `tests/background.stash.test.ts`. Extend the VM export list only as
needed. Cover at least:

1. Incognito list returns no regular stash metadata.
2. Incognito resume rejects before creating/claiming.
3. Two concurrent resume messages create only one set of tabs; the second gets
   "already being resumed".
4. All tabs reopen and group/update succeeds: stash is deleted once.
5. One tab creation fails: already created tabs are rolled back and the full
   stash remains.
6. Group creation fails: created tabs are rolled back and stash remains.
7. Group metadata update fails: created tabs are rolled back and stash remains.
8. Storage deletion fails after group success: result is not ordinary success
   and stash/recovery metadata remains.
9. A recent persisted claim prevents duplicate resume after worker reload.
10. A stale claim reuses validated opened tab IDs instead of creating
    duplicates.
11. A stale claim from another live window returns an explicit error.
12. Stashing a group moved during snippet collection creates the safety tab in
    `freshGroup.windowId`.
13. Safety-tab creation failure leaves original tabs open and creates no stash.
14. Non-HTTP(S) group members are not stored or closed.

Use distinct URLs and tab IDs; assert exact storage state after every failure.

Create `tests/ui/StashPanel.test.tsx` covering:

1. First delete click calls no callback.
2. Cancel calls no callback and restores row actions.
3. Confirm calls delete once.
4. A resuming stash disables resume/delete and shows a useful state.
5. Worker delete failure becomes an error status in Popup.

**Verify**:

```sh
pnpm test -- tests/background.stash.test.ts tests/ui/StashPanel.test.tsx
```

Expected: nineteen or more tests pass.

### Step 8: Correct stash documentation

Replace "comes back exactly as it was" with accurate behavior:

- Focused stores and reopens saveable web URLs as a newly created Chrome group;
- browser history, page/form state, active state, and non-web tabs are not
  restored;
- stashing remains unavailable in incognito because storage is shared.

Keep the AI brief description, but do not describe URL reopening as full session
restoration.

**Verify**:

```sh
git grep -ni 'exactly as it was' -- README.md
```

Expected: exit 1 and no output.

### Step 9: Run the full gate

```sh
pnpm check
git diff --check
git status --short
```

Expected: all commands pass; only in-scope source/tests/docs plus Plan 005
status differ from the post-Plan-004 tree.

## Test plan

The state-machine test matrix in Step 7 is mandatory. Especially verify:

- storage content, not just response copy;
- no stash deletion on any partial Chrome/storage failure;
- no duplicate tabs from simultaneous or restarted attempts;
- exact target window for safety tabs;
- incognito list/resume isolation;
- deletion requires a separate confirmation action.

All tests must use fresh worker/storage state.

## Done criteria

- [ ] Resume claims are serialized through `mutateStashes`.
- [ ] Opened tab IDs are persisted during an attempt for restart recovery.
- [ ] Concurrent/recent duplicate resume is rejected.
- [ ] Any tab/group/storage failure retains recoverable stash data.
- [ ] Complete success is the only path that deletes a stash.
- [ ] Incognito cannot list or resume shared stashes.
- [ ] Safety tabs use the re-fetched window and are required before closing the
      last source tabs.
- [ ] Stash deletion needs explicit confirmation.
- [ ] README no longer promises exact session restoration.
- [ ] Nineteen or more focused tests pass.
- [ ] `pnpm check` and `git diff --check` exit 0.
- [ ] Plan 005 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- Implementing serialized claims would bypass `mutateStashes`.
- Exact recovery requires a new Chrome permission or external database.
- A failure path can delete a stash before every URL/group operation succeeds.
- A proposed retry strategy sends regular stash metadata into incognito.
- Existing persisted stash entries do not have the documented `tabs` array
  shape and need a larger migration.
- The worker cannot persist opened mappings without exposing them through
  `publicStash`.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Internal `resume` metadata is a recovery journal, not public product data.
  Keep it out of message responses.
- Every new stash mutation must use `mutateStashes` and honor the active token.
- All-or-nothing here means storage is never discarded on partial failure.
  Chrome can still terminate between an API call and journal write; recovery
  metadata narrows that window and must remain tested.
- Reviewers should inspect every `filter(item.id !== stashId)`-style deletion
  and confirm it is token-matched and reachable only after complete success.
