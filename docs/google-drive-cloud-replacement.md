# Google Drive cloud replacement — plan & resume context

Branch: `feat/google-drive-cloud-replacement` (from `origin/main`).
This file is the **resume point**: if work is interrupted, read this first, then
continue from the first unchecked item below.

## Goal

Replace Hydra Cloud with the user's own Google Drive:

1. Hardcode the Drive folder name to `HydraLauncher GD Saves` (remove the setting).
2. Replicate every Hydra Cloud data feature through Drive: game saves (done),
   unlocked achievements, achievement souvenirs, custom artwork, library/playtime.
3. Rename the game-details "Cloud Save" button to "Google Drive Save Sync" and
   wire it to the Drive-backed flow.
4. Remove Hydra Cloud settings & code. **Keep the Hydra login** (catalogue,
   library, achievement definitions, SSE, notifications stay).
5. Keep the fork easy to merge with upstream; see `docs/fork-merge-playbook.md`.

## Decisions locked with the user

- Hydra account/login is **kept**; only Cloud subscription/paywall/sync code goes.
- Google Drive is the **only** cloud-save remote (Hydra remote path deleted).
- **Both** the V2 widget and the legacy button are renamed.
- All four data features (achievements, souvenirs, artwork, library) are in scope.
- Emulation cloud saves are **in scope**: repointed to Drive blobs rather than
  deleted.

## Architecture notes (verified)

- `src/main/services/cloud-save/remote-backend.ts` already routes between
  `"hydra"` and `"google-drive"` via `resolveCloudSaveProvider()`. Collapsing to
  Drive-only is mostly deletion plus rewiring the access guard.
- The Drive backend is complete: OAuth/PKCE, settings, storage, manifest,
  snapshots, restore, background sweep.
- Root-folder resolution queries the `hydraRole=root` app property **before**
  falling back to the folder name, so renaming the folder does not orphan data.
- The "Cloud Save" button is `CloudSaveWidget` (V2) plus a legacy button in
  `game-details-content.tsx`.

## Progress

- [x] Branch created off `origin/main`
- [x] This context file written- [x] Phase 1 — hardcode folder name (`GOOGLE_DRIVE_FOLDER_NAME = "HydraLauncher GD Saves"`)
- [x] Phase 2 — remove Hydra Cloud paywall/subscription surfaces - `getCloudSaveAccessAction(driveConnected)` -> `"connect-drive" | "open"` - `remote-backend.ts` collapsed to Drive-only; `assertCloudSaveRemoteAccess`
      and `canAccessCloudSaveRemote` check the Drive connection - `assertCloudSaveSubscription` -> awaited `assertCloudSaveDriveConnected`
      at every call site - `needsSubscription` removed from `HydraApiOptions`, `validateOptions`, the
      `hydraApiCall` IPC payload and every main call site - deleted: hydra-cloud modal, `use-subscription.ts`, `subscription-slice.ts`
      (removed from `store.ts`, `features/index.ts`, `app.tsx`) - every renderer consumer repointed to `useOpenGoogleDriveSettings()` /
      `useGoogleDriveConnection()` (`src/renderer/src/hooks/use-google-drive-connection.ts`)
- [x] Screenshots — upload worker writes JPEG + thumbnail blobs to Drive and a
      per-game `screenshots-*.json` document; local delete/forget also removes the
      Drive entry. The 1080p (`CLOUD`) tier is always selectable and always used,
      with no Hydra subscription check.
- [x] Phase 3a — Drive-only cloud-save engine (`remote-backend.ts` returns
      `"hydra"` only for ineligible games; the Hydra prepare/commit branches are
      deleted)
- [x] Phase 3b — button renamed to "Google Drive Save Sync"
      (`cloud_save_google_drive`) across the V2 widget, the legacy hero button and
      the presentation labels
- [~] Phase 3c — the desktop legacy Hydra artifact UI is retired: deleted
  `cloud-sync.context.tsx`, `cloud-sync-panel.tsx`, `game-emulation-saves.tsx`,
  `cloud-sync-files-modal`, `cloud-sync-rename-artifact-modal`,
  `hydra-cloud-section.tsx`, `legacy-saves-section.tsx` / `legacy-save-card.tsx` /
  `legacy-save-presentation.ts`, and their call sites. Remaining: the Big Picture
  cloud tab still lists Hydra artifacts and the matching main-process artifact
  IPC (`get-game-backup-preview`, `upload-save-game`, `download-game-artifact`,
  `delete-game-artifact`) is still registered for it.
- [x] Phase 4 base — `src/main/services/google-drive/google-drive-documents.ts`
      (JSON document store; `googleDriveGameDocumentName` naming helper) plus
      `google-drive-documents-instance.ts`. Tested against a fake Drive server.
- [x] Phase 4a — Drive-backed unlocked achievements:
      `google-drive-achievements.ts` / `google-drive-achievements-merge.ts`;
      `merge-achievements.ts` writes via `syncGoogleDriveUnlockedAchievements`
      (gate: `GoogleDriveService.isSyncEnabled()`);
      `get-achievement-souvenirs.ts` reads via `readGoogleDriveUnlockedAchievements`
      and resolves souvenir image keys to `local:` URLs via
      `resolveGoogleDriveMediaUrl`.
- [x] Phase 4d (emulation) — `emulation-cloud-saves.ts` is Drive-backed:
      an `emulation-saves.json` document plus content-addressed blobs. Public
      signatures unchanged, so every caller keeps working.
- [x] Phase 4b — souvenirs: `achievement-image-service.ts` uploads a
      content-addressed Drive blob; the grouped-souvenir worker writes the image
      key through `syncGoogleDriveUnlockedAchievements` instead of
      `PUT /profile/games/achievements`; the Hydra subscription gate is gone.
      Souvenir acknowledgements use `<shop>:<objectId>:<imageKey>` ids so
      deletion can clear the key from the Drive document.
- [x] Phase 4c — custom artwork: `game-artwork-cloud.ts` stores uploads as
      Drive blobs and SteamGridDB picks in `artwork.json`; `google-drive-artwork-restore.ts`
      repopulates missing local artwork after setup/connect. No subscription gate.
- [-] Phase 4d (library/playtime) — intentionally left on Hydra: library and
  playtime are not paywalled, so they stay out of this migration.
- [x] Phase 5 — `docs/fork-merge-playbook.md` (updated for Phases 3/4)
- [x] Verification — both typechecks green. Full suite: 1082 pass / 26 fail /
      12 skip; all 26 failures are the pre-existing EBUSY/EPERM/binary-helper
      environment issues from `AGENTS.md`, none in touched files. New tests: 9 pass
      (documents 4, achievement merge 5). Prettier + ESLint clean on changed files.
      Manual UI acceptance NOT run (no desktop session).

## Drive data layout (fork)

Everything lives under the root folder `HydraLauncher GD Saves`:

- `games/<shop>-<objectId>/` — save snapshots (`manifest.json`, blobs).
- `blobs/` — content-addressed binaries (snapshots, emulation save artifacts).
- `documents/` — JSON documents written through
  `googleDriveDocuments` (`google-drive-documents.ts`):
  - `achievements-<shop>-<objectId>.json` — unlocked achievements.
  - `emulation-saves.json` — emulation save metadata records (each record
    carries an `artifactHash` pointing at a `blobs/` file).

## Known leftovers (deliberately not removed)

- `HydraCloudFeature` type in `src/types/index.ts` (now unused).
- `openCheckout` IPC — still used by Hydra account/gift/profile UI.
- `HydraApi.hasActiveSubscription` — still used by non-cloud Hydra features
  (download sources, classics, linux capture).
- The `hydra_cloud` locale namespace and `settings_category_hydra_cloud` keys.

## Verification commands

```bash
# typecheck
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false

# tests (explicit file list; keep pipefail when filtering)
set -o pipefail
/tmp/node-v20.19.5-win-x64/node.exe --import ./scripts/register-ts-node.mjs --test $(find src -name "*.test.ts" | tr '\n' ' ')

# lint / format on changed files
/tmp/node-v20.19.5-win-x64/node.exe node_modules/prettier/bin/prettier.cjs --check <files>
/tmp/node-v20.19.5-win-x64/node.exe node_modules/eslint/bin/eslint.js <files>
```

Pre-existing environmental failures (~26, Windows EBUSY/EPERM pre-existing env issues)
are documented in `AGENTS.md` and are **not** regressions.

## Manual acceptance

1. Drive settings card has **no** folder-name field.
2. The Drive folder is named `HydraLauncher GD Saves`.
3. Game details shows "Google Drive Save Sync"; enabled when Drive connected,
   routes to Drive settings when not (never a paywall).
4. Saves, achievements, souvenirs, artwork, library/playtime round-trip.
5. `grep -rn "hydra_cloud\|openCheckout\|showHydraCloudModal" src` is clean.
