# Fork merge playbook

How to merge `upstream/main` (hydralauncher/hydra) into this fork
(nayan8teen/hydra) while keeping the fork's Google Drive additions and its
removal of Hydra Cloud intact.

This doc is written to be followed by a coding agent with no prior context.

## 1. What this fork changes

The fork has two kinds of change:

**Fork-owned files (safe — upstream never touches these, so they never conflict):**

- `src/main/services/google-drive/**` — OAuth, settings, storage, manifest,
  the `google-drive-documents` JSON store and the `google-drive-achievements`
  store.
- `src/main/services/cloud-save/create-google-drive-snapshot.ts`,
  `download-google-drive-snapshot-to-temp.ts`, `google-drive-snapshot-policy.ts`.
- `src/renderer/src/hooks/use-google-drive-connection.ts`.
- `src/renderer/src/pages/settings/settings-google-drive*.{ts,tsx,scss}`.
- `docs/google-drive-cloud-replacement.md`, `docs/fork-merge-playbook.md`.

**Fork-touched upstream files (conflict risk — resolve carefully):**

Every file listed by `git diff --name-only origin/main` that is _not_ in the
list above. As of the current branch these are concentrated in:

- `src/main/services/cloud-save/remote-backend.ts`,
  `cloud-save-access.ts`, `list-remote-game-snapshots.ts`,
  `download-remote-snapshot-to-temp.ts`, `delete-game-cloud-save-data.ts`,
  `create-remote-snapshot-from-local-state.ts`,
  `resolve-remote-snapshot-targets.ts`, `untrack-cloud-save-custom-path.ts`,
  `automatic-sync-settings.ts`, `bind-rpcs3-cloud-save-profile.ts`.
- `src/main/services/hydra-api.ts` (subscription gate removed).
- The `assertCloudSaveDriveConnected` call sites under
  `src/main/events/cloud-save/**`.
- `src/main/services/achievements/merge-achievements.ts` and
  `get-achievement-souvenirs.ts` (achievement sync repointed to Drive).
- `src/main/services/emulators/emulation-cloud-saves.ts` (emulation saves
  repointed to Drive).
- `src/renderer/src/store.ts`, `src/renderer/src/app.tsx`,
  `src/renderer/src/features/index.ts` (subscription slice / paywall modal removed).
- The renderer consumers of `useSubscription` / `showHydraCloudModal`.
- `src/locales/{en,pt-BR}/translation.json`.

## 2. The `FORK:` marker convention

Every fork edit to an upstream file should carry a comment containing the
literal token `FORK:`. Use it on the smallest possible hunk so a merge run can
find every fork delta:

```bash
grep -rn "FORK:" src --include="*.ts" --include="*.tsx"
```

When upstream refactors a function a fork hunk sits in, the marker tells you
where the fork behaviour must be re-applied.

## 3. Merge runbook

```bash
# 0. Never merge on a feature branch with uncommitted work.
git fetch upstream
git status                     # must be clean
git checkout -b chore/merge-upstream-YYYYMMDD origin/main

# 1. Merge, expecting conflicts in the files from section 1.
git merge upstream/main

# 2. Generate the resolution checklist.
grep -rn "FORK:" src --include="*.ts" --include="*.tsx"
git diff --name-only --diff-filter=U

# 3. Resolve each conflict using section 4.
# 4. Re-run the fork-behaviour checklist (section 5).
# 5. Validate (section 6), then open a PR against the fork's main.
```

## 4. Resolution patterns per upstream churn hotspot

### 4.1 `src/main/services/hydra-api.ts`

Upstream may re-add subscription handling or change `validateOptions`.
**Fork rule:** keep `validateOptions` free of any `needsSubscription` gate. The
fork deliberately removed `HydraApiOptions.needsSubscription`. If upstream
re-adds it, keep the option in the type but do **not** re-introduce the gate in
`validateOptions` (or keep it behind an explicit `FORK:` comment explaining it
is unused).

### 4.2 `src/main/services/cloud-save/remote-backend.ts`

Upstream's version resolves a provider and checks a Hydra subscription.
**Fork rule:** `resolveCloudSaveProvider` must only ever return
`"google-drive"` for eligible games, and `assertCloudSaveRemoteAccess` must
assert the Drive connection via `assertCloudSaveDriveConnected`, never a
subscription. Re-apply after every merge.

### 4.3 The renderer paywall (`useSubscription`, `subscription-slice`, cloud modal)

Upstream may re-add `useSubscription` or the `CloudSubscriptionModal`.
**Fork rule:** these are deleted. Any new upstream component that imports them
must be repointed to `useOpenGoogleDriveSettings()` /
`useGoogleDriveConnection()` from
`src/renderer/src/hooks/use-google-drive-connection.ts`.

### 4.4 `src/shared/cloud-save-access.ts`

Upstream's version is `(isAuthenticated, hasActiveSubscription) =>
"sign-in" | "paywall" | "open"`. **Fork rule:** it is
`(driveConnected: boolean) => "connect-drive" | "open"`. Every caller must pass
the Drive connection flag. Re-apply the signature after every merge and fix all
callers listed by the compiler.

### 4.5 `src/main/services/achievements/**`

Upstream keeps unlocking achievements through
`HydraApi.put("/profile/games/achievements")` and reads them from
`/users/:id/games/achievements`. **Fork rule:** unlocks replicate through
`syncGoogleDriveUnlockedAchievements` / `readGoogleDriveUnlockedAchievements`
(`src/main/services/google-drive/google-drive-achievements.ts`), gated on
`GoogleDriveService.isSyncEnabled().` The merge is by achievement name with the
later unlock time winning. The grouped-souvenir worker still talks to Hydra
(see section 4.7), so do not delete `HydraApi` from `merge-achievements.ts`
until then.

### 4.6 `src/main/services/emulators/emulation-cloud-saves.ts`

Upstream writes emulation saves through `/profile/emulation-saves` presigned
URLs. **Fork rule:** the same public functions are backed by an
`emulation-saves.json` document plus content-addressed blobs
(`GoogleDriveStorage.uploadBlob`/`downloadBlob`). Keep the function signatures;
`saveId` is now an opaque UUID and artifacts are keyed by sha256.

### 4.7 Souvenirs and library (not yet migrated)

The grouped achievement souvenirs (`achievement-image-service.ts`,
`grouped-souvenir-worker.ts`) and the library/playtime sync
(`library-sync/merge-with-remote-games.ts`, `upload-games-batch.ts`) still use
the Hydra API. They are the remaining Phase 4 work; when upstream touches them,
keep the Hydra behaviour until the Drive migration lands, then switch to the
`google-drive-documents` store.

### 4.8 Locales

The fork removed the `google_drive_folder_*` keys and added
`cloud_save_google_drive`. The `hydra_cloud` namespace is still referenced by
the legacy artifact UI (`cloud-sync-panel.tsx`, `game-emulation-saves.tsx`)
until that UI is retired, so keep the namespace keys. Upstream locale changes
land wholesale; re-apply the fork's key additions on top.
`cloud_save_google_drive` must exist in `en` and `pt-BR`.

## 5. Fork-behaviour checklist (re-run after every merge)

- [ ] Google Drive settings card has **no** folder-name field.
- [ ] The Drive folder is named `HydraLauncher GD Saves` (constant
      `GOOGLE_DRIVE_FOLDER_NAME`) and documents live in its `documents` child.
- [ ] `getCloudSaveAccessAction` takes a single `driveConnected` boolean.
- [ ] `grep -rn "needsSubscription" src` returns nothing.
- [ ] `grep -rn "showHydraCloudModal\|useSubscription\|CloudSubscriptionModal" src` returns nothing.
- [ ] Achievement unlocks round-trip through
      `syncGoogleDriveUnlockedAchievements` / `readGoogleDriveUnlockedAchievements`,
      not `/profile/games/achievements`.
- [ ] `emulation-cloud-saves.ts` has no `HydraApi`/`presigned` calls; it uses
      `emulation-saves.json` + blobs.
- [ ] The game-details cloud button reads "Google Drive Save Sync"
      (`cloud_save_google_drive`).
- [ ] `grep -rn "FORK:" src` lists exactly the intended fork deltas.
- [ ] `docs/google-drive-cloud-replacement.md` progress section still matches reality.

## 6. Verification (must be green before opening the merge PR)

```bash
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false

set -o pipefail
/tmp/node-v20.19.5-win-x64/node.exe --import ./scripts/register-ts-node.mjs --test $(find src -name "*.test.ts" | tr '\n' ' ')

# lint/format on changed files
/tmp/node-v20.19.5-win-x64/node.exe node_modules/prettier/bin/prettier.cjs --check <files>
/tmp/node-v20.19.5-win-x64/node.exe node_modules/eslint/bin/eslint.js <files>
```

The ~26 pre-existing Windows environment failures documented in `AGENTS.md`
(EBUSY/EPERM/binary-missing) are not regressions. Do not skip or weaken tests.

## 7. Known hazards

- **Never** branch or merge from another feature branch; always from
  `origin/main` (see `AGENTS.md`).
- Upstream advances the cloud-save engine regularly; the largest conflict
  surface is `src/main/services/cloud-save/**`. Prefer re-applying the fork's
  Drive-only provider branch rather than accepting upstream's Hydra branch.
- `.freebuff/` is local agent state and must stay out of commits.
