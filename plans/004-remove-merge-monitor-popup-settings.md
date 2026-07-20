# Plan 004: Remove merge, monitor, and duplicate popup settings

> **Executor instructions**: Execute this plan only after Plan 003 passes its
> full gate. Follow each step and preserve the consent/undo changes already
> landed. Stop rather than retaining half of a removed feature. Update the Plan
> 004 row in `plans/README.md` when complete unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat d347e53..HEAD -- public/manifest.json public/background.js src/popup/Popup.tsx src/options/Options.tsx src/types.ts src/components/ui/slider.tsx package.json pnpm-lock.yaml README.md tests`
>
> Plans 001–003 intentionally change several paths. Confirm that the named
> merge/monitor/basic-settings symbols from "Current state" still exist before
> removing them. Do not revert versioned undo or nullable consent state.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-enforce-consent-and-isolate-undo.md`
- **Category**: direction | tech-debt | bug
- **Planned at**: commit `d347e53`, 2026-07-19

## Why this matters

Window merging is irreversible, is available as a one-click action, and runs
before classification when enabled. A provider failure or rejected review can
therefore collapse multiple windows even though organization reports failure,
and the single-window undo snapshot cannot restore the original layout.

The tab monitor is default-off product scope that adds a required notification
permission, event listeners, badges, shared alert state, and popup/options UI.
Its refresh runs across every normal window and tab even while disabled. The
popup also duplicates settings already owned by the Options page, allowing
stale open pages to overwrite one another. The selected cleanup removes these
features completely and keeps a smaller popup: Command, Organize, Ungroup,
Close duplicates, Undo, and Stashes.

## Current state

- `public/manifest.json:6` requires `notifications`.
- `public/background.js:12` defines monitor notification state.
- `public/background.js:21-32` includes `mergeOnOrganize`, `auto`, and
  `autoThreshold` defaults.
- `public/background.js:354-376` exposes `mergeWindows`, `windowCount`, and
  `monitorState` messages.
- `public/background.js:406-425` clears monitor state and merges windows before
  classification.
- `public/background.js:1411-1435` incrementally moves every same-profile
  window with no rollback.
- `public/background.js:1465-1542` implements the monitor scheduler, whole-
  browser refresh, badge/notification work, and listeners.
- `src/popup/Popup.tsx:42-51` stores window count, merge, monitor, threshold,
  popup-settings, and prompt state.
- `src/popup/Popup.tsx:427-442` renders the monitor prompt.
- `src/popup/Popup.tsx:454-524` renders Merge plus the duplicate Basic settings
  accordion.
- `src/options/Options.tsx:337-375` renders merge and monitor settings.
- `src/types.ts:74-90` includes their fields in `Settings` and
  `src/types.ts:92-113` repeats their defaults.
- `src/components/ui/slider.tsx` and `@radix-ui/react-slider` are used only by
  the popup Basic settings accordion.

Conventions:

- Settings defaults are currently duplicated in `src/types.ts` and
  `public/background.js`; both must change together.
- Removed stored fields should be cleaned idempotently on extension update.
- Expected user-state failures return result objects. Removal should delete
  handlers rather than leave "feature unavailable" stubs.
- Keep the existing Options page as the single settings owner.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Remove unused UI dependency | `pnpm remove @radix-ui/react-slider` | exit 0; manifest/lock updated |
| Cleanup tests | `pnpm test -- tests/background.surface-cleanup.test.ts tests/ui/SurfaceCleanup.test.tsx` | all pass |
| Full gate | `pnpm check` | exit 0 |
| Worker syntax | `node --check public/background.js` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `public/manifest.json`
- `public/background.js`
- `src/popup/Popup.tsx`
- `src/options/Options.tsx`
- `src/types.ts`
- Delete `src/components/ui/slider.tsx`
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- Create `tests/background.surface-cleanup.test.ts`
- Create `tests/ui/SurfaceCleanup.test.tsx`
- Extend existing test helpers only if required by removed APIs

**Out of scope**:

- Removing or redesigning CommandBar, Stashes, review mode, dedupe, undo,
  import/export, page snippets, or provider support.
- Implementing multi-window undo as an alternative to feature removal.
- Replacing notifications with alarms, side panels, or another monitor.
- Changing minimum-group or dedupe settings in Options.
- Partial undo/stash correctness; Plans 005–006 own those paths.
- Centralizing all settings defaults.

## Git workflow

- Stay on the operator-assigned branch; do not rename it.
- If commits are requested, suggested subject:
  `refactor: remove merge and tab monitor features`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Remove merge and monitor from the public data model

In `src/types.ts`:

- delete `MergeResponse`;
- delete `mergeOnOrganize`, `auto`, and `autoThreshold` from `Settings`;
- delete their entries from `DEFAULT_SETTINGS`.

In `public/background.js`:

- delete those same default preference fields;
- delete `MONITOR_NOTIFICATION_PREFIX`.

Do not remove `dedupeOnOrganize` or `minGroupSize`.

**Verify**:

```sh
git grep -nE 'MergeResponse|mergeOnOrganize|autoThreshold|MONITOR_NOTIFICATION_PREFIX' -- src/types.ts public/background.js
```

Expected: exit 1 and no output.

### Step 2: Remove merge behavior and its message surface

In `public/background.js`:

1. Delete the `mergeWindows`, `windowCount`, and `monitorState` handlers.
2. Delete `windowCount`, `getMonitorState`, and `mergeWindows` functions.
3. Remove the pre-classification `settings.mergeOnOrganize` branch.
4. Since no automatic organizer caller exists, simplify `organize` by removing
   its `automatic` option, the `automatic` job field, automatic-specific
   return branches, and automatic review/notification conditions. Preserve
   `windowId` and all Plan 003 consent checks.
5. Do not add replacement messages returning errors; unknown removed messages
   should follow the dispatcher's normal `false` path.

**Verify**:

```sh
git grep -nE 'mergeWindows|windowCount|automatic' -- public/background.js
node --check public/background.js
```

Expected: `git grep` exits 1 with no output; syntax exits 0.

### Step 3: Remove the complete monitor implementation

Delete from `public/background.js`:

- monitor alert lookup/notification clearing at organize start;
- `notifyAutoFiled`;
- every `scheduleAutoCheck()` call;
- `scheduleAutoCheck`, `refreshAutoState`, `countOrganizableTabs`, and
  `openMonitorPrompt`;
- notification click/button listeners;
- tab/runtime/storage listeners whose only purpose is monitor refresh;
- all `chrome.notifications` calls and `monitorAlertedWindows` reads/writes.

Add one narrow `runtime.onInstalled` listener for storage cleanup:

```js
chrome.runtime.onInstalled.addListener(() => {
  Promise.all([
    chrome.storage.sync.remove(["mergeOnOrganize", "auto", "autoThreshold"]),
    chrome.storage.local.remove("monitorAlertedWindows")
  ]).catch(() => undefined);
});
```

This migration may coexist with Plan 003's window-removal listener. It must not
call notification APIs after the permission is removed.

**Verify**:

```sh
git grep -nE 'scheduleAutoCheck|refreshAutoState|countOrganizableTabs|monitorAlertedWindows|chrome[.]notifications|notifyAutoFiled' -- public/background.js
node --check public/background.js
```

Expected: `git grep` exits 1 with no output; syntax exits 0.

### Step 4: Remove notification permission

Delete `notifications` from `public/manifest.json` and leave all other required
and optional permissions unchanged.

**Verify**:

```sh
node -e 'const m=require("./public/manifest.json"); if (m.permissions.includes("notifications")) process.exit(1)'
```

Expected: exit 0.

### Step 5: Simplify the popup to one action surface

In `src/popup/Popup.tsx`:

- remove `BellRing`, `Combine`, `ChevronDown` (if no longer used), Checkbox,
  Slider, and `MergeResponse` imports that become unused;
- remove window-count, merge, monitor, threshold, basic-settings-open, and
  monitor-prompt-dismissed state;
- remove `refreshCounts` and all calls to it;
- remove sync reads used only to populate popup settings/monitor;
- remove notification clearing and old `auto === "auto"` migration;
- remove the `merge` handler;
- remove the monitor prompt;
- remove the Merge quick action;
- remove the complete Basic settings accordion and `BasicCheckbox` helper;
- remove `clamp` if no remaining popup code uses it.

Render the remaining quick actions—Ungroup, Close duplicates, Undo—in a
three-column grid. Keep their existing handlers, labels, icons, disabled
behavior, and Plan 003 window-scoped undo messages.

The popup must no longer write behavior preferences directly. Options remains
the single settings surface.

**Verify**:

```sh
git grep -nE 'Basic settings|Merge windows|tab monitor|monitorPrompt|refreshCounts|BasicCheckbox|@/components/ui/slider' -- src/popup/Popup.tsx
pnpm exec tsc --noEmit
```

Expected: no grep matches and typecheck exits 0.

### Step 6: Remove merge and monitor settings from Options

In `src/options/Options.tsx`:

- remove the "Merge windows when organizing" checkbox;
- remove the Tab monitor Select and threshold Input;
- remove `autoThreshold` normalization from `save`;
- preserve Review, Group every tab, Minimum tabs, Custom instructions, Dedupe,
  Budget, and Data sections unchanged.

Loading old sync objects may encounter removed keys until the update migration
runs; ignore unknown keys and never write them back through the typed Settings
object.

**Verify**:

```sh
git grep -nE 'merge-on-organize|Merge windows|Tab monitor|autoThreshold' -- src/options/Options.tsx
pnpm exec tsc --noEmit
```

Expected: no matches; typecheck exits 0.

### Step 7: Delete the now-unused slider component and dependency

First prove there are no remaining imports:

```sh
git grep -n '@/components/ui/slider' -- src
```

Expected: exit 1 and no output.

Then delete `src/components/ui/slider.tsx` and run:

```sh
pnpm remove @radix-ui/react-slider
```

Do not remove Checkbox, Select, Switch, or their dependencies.

**Verify**:

```sh
test ! -e src/components/ui/slider.tsx
node -e 'const p=require("./package.json"); if (p.dependencies["@radix-ui/react-slider"]) process.exit(1)'
```

Expected: both commands exit 0.

### Step 8: Make documentation describe only retained behavior

In `README.md`:

- remove "Tab monitor";
- remove "Merge while organizing";
- revise "Quick actions" to list only ungroup, close duplicates, and undo;
- keep "Duplicate protection" because automatic dedupe during organize remains;
- do not change stash fidelity copy yet; Plan 005 does that.

**Verify**:

```sh
git grep -niE 'merge windows|merge while|tab monitor|notification when loose' -- README.md
```

Expected: exit 1 and no output.

### Step 9: Add removal regression tests

Create `tests/background.surface-cleanup.test.ts`:

- parse `public/manifest.json` and assert `notifications` is absent;
- load the worker and send `mergeWindows`, `windowCount`, and `monitorState`
  messages; assert each is unhandled by the dispatcher;
- seed removed sync/local keys, emit `runtime.onInstalled`, flush promises, and
  assert those keys are removed;
- assert worker evaluation registers no notification/tab-monitor listeners
  beyond generic fakes unused by production.

Create `tests/ui/SurfaceCleanup.test.tsx`:

- render Popup and assert no Merge, Basic settings, or monitor text;
- assert Ungroup, Close duplicates, and Undo remain;
- render Options and assert merge/monitor controls are absent while Dedupe,
  Minimum tabs, and Review remain.

Use Testing Library role/name queries and the shared Chrome fake.

**Verify**:

```sh
pnpm test -- tests/background.surface-cleanup.test.ts tests/ui/SurfaceCleanup.test.tsx
```

Expected: all tests pass.

### Step 10: Run the full cleanup gate

```sh
pnpm check
git diff --check
git grep -nE 'mergeWindows|mergeOnOrganize|monitorState|autoThreshold|chrome[.]notifications|Basic settings' -- public src README.md package.json
```

Expected: `pnpm check` and `git diff --check` exit 0; final grep exits 1 with
no output.

## Test plan

Required tests:

- removed messages are no longer dispatched;
- removed storage keys are cleaned on update;
- manifest no longer requests notifications;
- Popup retains only the three intended quick actions;
- Options retains core behavior controls but no merge/monitor controls;
- production build contains no stale imports or removed dependency.

## Done criteria

- [ ] No merge function, setting, message, type, or UI remains.
- [ ] No monitor scheduler, state, notification API, setting, type, or UI
      remains.
- [ ] Manifest no longer requests `notifications`.
- [ ] Popup Basic settings accordion and its storage writes are gone.
- [ ] Options is the sole behavior-settings surface.
- [ ] Slider component and Radix slider dependency are removed.
- [ ] Removed persisted keys are cleaned idempotently on update.
- [ ] README lists only retained functionality.
- [ ] Removal regression tests pass.
- [ ] `pnpm check` and `git diff --check` exit 0.
- [ ] Plan 004 is marked DONE in `plans/README.md`.

## STOP conditions

Stop and report if:

- A current caller of `organize(..., { automatic: true })` is discovered.
- Any non-monitor feature requires `notifications`.
- Slider has another production import.
- The operator requires merge or monitor to remain available.
- Removing old settings requires deleting unrelated sync/local data.
- A change would revert Plan 003 consent or browsing-context undo isolation.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Do not reintroduce popup settings without a storage synchronization/conflict
  design. Options is intentionally authoritative.
- A future multi-window feature needs a complete topology snapshot and rollback
  before it can be exposed.
- A future monitor should request notification permission only when enabled and
  must short-circuit while off; that is a new product plan, not a restoration
  of deleted code.
- Reviewers should search both default sources (`src/types.ts` and worker) for
  removed fields and confirm the lockfile no longer contains the slider package.
