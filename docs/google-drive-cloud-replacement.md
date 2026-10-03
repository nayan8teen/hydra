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
- [x] Phase 3a — Drive-only cloud-save engine (`remote-backend.ts` returns
      `"hydra"` only for ineligible games; the Hydra prepare/commit branches are
      deleted)
- [x] Phase 3b — button renamed to "Google Drive Save Sync"
      (`cloud_save_google_drive`) across the V2 widget, the legacy hero button and
      the presentation labels
- [~] Phase 3c — the legacy Hydra artifact UI (`cloud-sync.context.tsx`,
  `cloud-sync-panel.tsx`, `game-emulation-saves.tsx`, `get-game-backup-preview`,
  `upload-save-game`, `download-game-artifact`, `delete-game-artifact`) still
  exists. It is independent of the Drive engine now that emulation saves are
  Drive-backed, so it can be retired, but the delete is a multi-file renderer
  refactor and was left for a focused pass.
- [x] Phase 4 base — `src/main/services/google-drive/google-drive-documents.ts`
      (JSON document store; `googleDriveGameDocumentName` naming helper) plus
      `google-drive-documents-instance.ts`. Tested against a fake Drive server.
- [x] Phase 4a — Drive-backed unlocked achievements:
      `google-drive-achievements.ts` / `google-drive-achievements-merge.ts`;
      `merge-achievements.ts` writes via `syncGoogleDriveUnlockedAchievements`
      (gate: `GoogleDriveService.isSyncEnabled()`);
      `get-achievement-souvenirs.ts` reads via `readGoogleDriveUnlockedAchievements`.
      The souvenir image keys ride along on the unlock records; URL resolution is
      still the pending 4b item.
- [x] Phase 4d (emulation) — `emulation-cloud-saves.ts` is Drive-backed:
      an `emulation-saves.json` document plus content-addressed blobs. Public
      signatures unchanged, so every caller keeps working.
- [ ] Phase 4b — souvenirs: the grouped-souvenir worker and
      `achievement-image-service.ts` still upload via Hydra presigned URLs and the
      renderer still needs a Drive image resolver. NOT DONE.
- [ ] Phase 4c — custom artwork: `game-artwork-cloud.ts` still uses Hydra
      presigned URLs; it is coupled to the library sync. NOT DONE.
- [ ] Phase 4d (library/playtime) — `library-sync/merge-with-remote-games.ts`
      and `upload-games-batch.ts` still fetch/write Hydra profile games. NOT DONE.
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
