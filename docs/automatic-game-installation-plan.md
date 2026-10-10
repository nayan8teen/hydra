# Automatic game extraction and installation

**Status:** Phases 1–3 implemented on branch `feat/fitgirl-auto-install`; Phase 4 (packaged UI smoke
test, real-world installer verification) is still open. See "Implementation status" at the end.
**Scope:** extensible per-download-source pipeline, with FitGirl as the first supported installer.
**Research snapshot:** CarrotRub/Fit-Launcher `master` at `fd1e8a0308dc9c51155805167f16053f0658ccac` (reviewed 2026-10-09).

## Goal

When a user opts in, Hydra should take a completed download from a recognized source through any required archive extraction and then through that source's installer workflow. Persist enough state to show progress, recover safely after restart, retry failures, and avoid damaging downloads, existing installs, or user data. Source-specific behavior must be replaceable so later providers do not accumulate as conditionals in `DownloadManager`.

FitGirl is the first adapter. The first release should automate the Windows FitGirl installer flow only; on other hosts, preserve normal download/extraction behavior and offer a safe manual-install fallback rather than pretending UI automation is portable.

## Current Hydra building blocks

- `GameRepack` already includes `downloadSourceId`; `DownloadSource` has stable `id`, `name`, and `url` fields. The selected source identity is not currently copied into the download request/record.
- `StartGameDownloadPayload` and the download dialog carry the user's per-download `automaticallyExtract` choice. Downloads are persisted in LevelDB through `downloadsSublevel`; user preferences are persisted under `levelKeys.userPreferences`.
- `DownloadManager.handleDownloadCompletion()` updates download/seeding state and dispatches the optional extraction workflow. `GameFilesManager` owns existing extraction progress/failure/complete notifications, recursive archive extraction, archive deletion prompts, executable discovery, and installed-size bookkeeping.
- Hydra bundles 7-Zip for Windows, macOS, and Linux. Existing extraction supports `.rar`, `.zip`, and `.7z`; directory extraction avoids re-extracting later RAR volumes. It is a useful shared primitive, but FitGirl's multipart archive layouts and installer inputs need dedicated tests before assuming full compatibility.
- The Downloads settings already expose “extract files by default” and “delete archives after extraction”; download settings also let a user override extraction for a specific download. Put the new controls beside these settings, and keep the separate existing Linux `enableAutoInstall` preference distinct (it is not this feature).

Relevant local files to revisit during implementation:

- `src/types/index.ts` (`GameRepack`, `DownloadSource`, `StartGameDownloadPayload`)
- `src/types/level.types.ts` (`Download`, `UserPreferences`, `Game`)
- `src/main/level/sublevels/keys.ts` and `src/main/level/sublevels/downloads.ts`
- `src/renderer/src/pages/settings/settings-context-downloads.tsx`
- `src/renderer/src/pages/game-details/modals/download-settings-modal.tsx` and `repacks-modal.tsx`
- `src/main/events/torrenting/start-game-download.ts` and `add-game-to-queue.ts`
- `src/main/services/download/download-manager.ts` and `src/main/services/game-files-manager.ts`
- `src/preload/index.ts` / renderer declarations, only if new IPC operations/events are needed

## Fit-Launcher findings and what to reuse conceptually

Fit-Launcher is a Tauri/Rust/SolidJS application. Its installer is more than archive extraction:

1. Its extraction helper uses `unrar` and `Archive::as_first_part()` to extract a multipart RAR set once into the archive's parent directory: [extraction/functions.rs](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/src/extraction/functions.rs).
2. Its installer runner validates and launches the repack's `setup.exe`, copies it to a temporary executable name, and sets the original repack folder as the working directory so adjacent `.bin` data files remain discoverable. It chooses an install path, clicks through a known sequence of installer dialogs, monitors phases/progress, and reports success/failure: [installer/runner.rs](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-installer-controller/src/installer/runner.rs).
3. The controller has a serialized install queue and a separate Windows helper process connected over named-pipe IPC: [controller_manager.rs](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/src/controller_manager.rs), [controller service](https://github.com/CarrotRub/Fit-Launcher/tree/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-installer-controller).
4. The implementation is specifically tied to FitGirl/Inno-style dialogs. It uses UI automation, monitors installer windows, and can request elevation. It is not a generic installer protocol and its fixed click sequence is brittle across repack/installer versions. Its package declares `unrar`, `inno`, Windows UI Automation, and Windows API dependencies: [automation crate manifest](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/Cargo.toml).

**Takeaway:** reuse the separation of source preparation, install job/queue, and progress reporting—not Fit-Launcher's Rust/Tauri code or its blind UI-click sequence. Hydra already has a bundled extraction tool and download/extraction event infrastructure. Implement provider-aware package preparation and a narrowly scoped installer runner behind those existing services. Prefer verified unattended installer arguments where a supported package/version permits them; otherwise present a visible, user-assisted installer instead of silently guessing at dialogs.

## Proposed design

### 1. Carry trustworthy source provenance end-to-end

Add an optional stable installer/provider identifier to source metadata (for example `installerProvider: "fitgirl"`) and propagate the selected repack's `downloadSourceId` through `StartGameDownloadPayload` into the persisted `Download`. Resolve the provider from the source record/explicit trusted metadata, not from a filename, arbitrary URL substring, or game title. Keep existing downloads with no provenance on today's behavior.

Use an adapter registry keyed by provider ID. Unknown or unsupported sources return “no automatic installer”; they must never be treated as FitGirl just because an archive happens to contain a `setup.exe`. Keep recognition data explicit and testable; if Hydra's source catalog cannot yet supply a provider ID, add a deliberately reviewed mapping at the source integration boundary rather than embedding heuristics in the download manager.

Suggested seams (names are illustrative):

```ts
type InstallerProviderId = "fitgirl"; // extend as adapters are added

interface InstallPreparationContext {
  title: string;
  providerId: InstallerProviderId;
  sourceId: string;
  downloadDirectory: string;
  installBaseDirectory: string;
}

interface PreparedInstall {
  setupExecutable: string;
  workingDirectory: string;
  installDirectory: string;
  // Provider-owned, validated installer options; never arbitrary shell text.
  options: Record<string, boolean | number | string>;
}

interface DownloadInstallerAdapter {
  readonly providerId: InstallerProviderId;
  prepare(context: InstallPreparationContext): Promise<PreparedInstall>;
  install(
    plan: PreparedInstall,
    onProgress: (event: InstallProgressEvent) => void,
    signal: AbortSignal
  ): Promise<void>;
}
```

Keep filesystem extraction separate from provider-specific installer automation. `prepare()` may identify/extract a known package layout and return a validated setup/workdir/destination; `install()` delegates to an OS-specific runner. This lets future sources reuse common archive tools while implementing different package formats or installer flows.

### 2. Settings and download-level choices

Add a compact, version-tolerant preference shape rather than a separate hard-coded boolean for every future source. For example:

```ts
automaticInstallation?: {
  baseDirectory?: string | null;
  providers?: Record<string, {
    enabled: boolean;
    installDirectory?: string | null; // optional provider override
    options?: Record<string, boolean | number | string>;
  }>;
};
```

The exact schema should follow the current `UserPreferences` conventions and be backward-compatible when absent. Settings requirements:

- **FitGirl auto-install toggle**, off by default until explicitly enabled.
- **Default installation base directory**, selected using the existing native `showOpenDialog({ properties: ["openDirectory"] })` path-picker pattern.
- Optional per-provider enable/path override so later sources can have different behavior and install roots. A provider override falls back to the global base path.
- FitGirl-only options only after verified/implemented (for example optional bundled redistributables); defaults must not silently install unrelated software.
- A per-download “install automatically when ready” override in the existing download settings flow. It is available only when source provenance resolves to a supported adapter. Persist the user's choice on `Download` so queued downloads keep the intended behavior.
- Reuse `automaticallyExtract`/`extractFilesByDefault`; automatic install must not silently switch archive extraction on. If installation requires extraction and extraction was opted out, ask for confirmation or stop at a clearly actionable “extraction required” state.

Place global/provider controls in Downloads behavior settings near extraction and archive-retention controls. Display effective path and explain that the source's installer will run. Changing a global path should affect future jobs only; it must not move or rewrite completed installs.

### 3. Durable, serialized install jobs

Represent install lifecycle separately from download `status` and extraction flags. Recommended: a small LevelDB `install-jobs` sublevel (add its key in `src/main/level/sublevels/keys.ts`) keyed by stable job ID, with the game key/download key as an indexed field. Persist provider/source, package root, chosen target path, phase, progress, timestamps, attempt count, and a safe error code/message. Link the download to its install job or persist an equivalent unambiguous state.

Suggested phases: `queued → preparing → extracting (if needed) → awaiting-user (when automation can't safely continue) → installing → succeeded | failed | cancelled`. Persist phase changes before/after side effects so startup recovery can distinguish a safe retry from an interrupted installer. On restart, never launch a second installer blindly: mark interrupted jobs as recoverable/needs-review unless the runner can prove the prior process exited and the operation is idempotent.

Start with concurrency **one** for FitGirl installer jobs because UI automation/dialogs and disk I/O are not safely parallel. Keep the queue separate from Hydra's download queue but schedule work through a single manager. Add cancel/retry operations, with cancellation terminating only the process tree owned by the current job and leaving source files intact. Queue state and per-game install phase/progress should be visible in Downloads and recoverable after app restart.

Do not overload `Download.status = "extracting"` for installation. Keep the existing extracting flag/events for extraction and define explicit installation events/types for queued, phase/progress, completed, failed, and cancelled. Throttle progress updates as the extraction manager already does.

### 4. FitGirl adapter behavior (first implementation)

1. Accept only downloads explicitly marked with the FitGirl provider.
2. Inspect the completed download tree, group multipart RAR volumes correctly, and extract the first volume once using Hydra's bundled 7-Zip if representative FitGirl fixtures verify this works; otherwise add a narrowly scoped multipart-RAR implementation/dependency after evaluating packaging and platform support. Do not extract every part as an independent archive. Reject malformed/missing volume sets with a recoverable error.
3. Identify the expected setup executable and its companion data files from the prepared tree. Validate that the setup executable and all resolved files remain inside the selected package root; reject path traversal, unexpected links, ambiguous multiple setups, missing files, and unsupported layout rather than choosing the first arbitrary `.exe`.
4. Default the install destination to `<effective base directory>/<sanitized game title>`; let the user review/change the final target before the first run. Normalize and validate the path, prevent title/path traversal, detect collisions, and require explicit confirmation before overwriting a non-empty directory or existing Hydra install.
5. Launch with the package directory as the working directory (FitGirl setup may need adjacent `.bin` files). Use argument arrays/process APIs, not a shell command string. Use only provider- and version-verified unattended arguments. If the installer needs GUI interaction, keep it visible and user-controlled or use a separately testable Windows UI Automation adapter with explicit checkpoints; do not assume a fixed sequence always means “install”.
6. Report phase/progress and a final process/installer result. Process exit status alone may not prove success: confirm expected files/known completion signals, then run Hydra's existing executable discovery and update installed-size/game metadata without overwriting a user's pre-existing executable choice.
7. Keep the source download and all companion files until installation succeeds and the user-configured retention policy permits cleanup. Preserve existing archive-deletion preference semantics, and never delete a torrent's seeding files while seeding or while a queued/failed install may need a retry.

**Platform boundary:** ship FitGirl archive preparation wherever Hydra's bundled extractor is supported and tested. For the first milestone, automatic Windows setup execution is Windows-only. Other platforms should show extracted files and a manual next step; a future Wine/Proton runner must have explicit prefix selection, visibility, cancellation/process-tree handling, and independent tests before being enabled.

### 5. Error and safety behavior

- Distinguish unsupported provider/layout, missing archive parts/setup files, no space/permission, target conflict, unsupported host, user cancellation, process launch failure, installer-reported failure, and interrupted/unknown outcome. Keep messages actionable; preserve a retryable job record and never convert an install failure into download success-with-install.
- Check free space for extraction and estimated installation before starting, then handle disk-full errors. Do not reserve space based only on compressed download size; estimates may be unknown.
- Extract/install into a per-job staging area where practical. Do not expose partial output as installed. Promote/record the final directory only after success; cleanup only paths created by the job, with containment checks and an explicit user-safe retry path.
- Never run with administrator privileges automatically, disable antivirus/Defender, add exclusions, or hide installer windows. If a package requests elevation, let the operating system's normal consent UI decide; if an elevated helper is ever proposed, require a separate security review and user confirmation.
- Treat archives and installer files as untrusted. Validate paths, avoid shell interpolation, bound log/event payloads, do not log secrets, and prevent stale/cross-game IPC events from changing another job's state.

## Implementation phases / session checklist

### Phase 0 — confirm contracts and fixtures

- [x] Source provider ID: the source catalogue cannot supply one, so Settings maps a download
      source to a provider explicitly (`setDownloadSourceInstallerProvider`); anything unmapped has no
      installer, and unknown values clear the mapping.
- [ ] Fixtures: grouping and adversarial layouts are covered by synthetic manifests; a real
      multipart RAR set has not been extracted end to end (see "Implementation status").
- [x] Platform scope (Windows-only execution, elsewhere extraction + manual install), target
      collision policy (non-empty destination fails a first attempt; a retry may reuse leftovers),
      and the single optional component exposed (`unattended` silent switches).
- [ ] Bundled 7-Zip multipart support still needs a real archive to be proven.

### Phase 1 — provenance, settings, and contracts

- [x] Optional provider metadata plus `downloadSourceId` propagation through repack selection →
      IPC payload → persisted download; old records stay valid.
- [x] Preference types (`UserPreferences.automaticInstallation`), provider toggle, global install
      directory picker, and per-provider directory override (with unattended as the provider option),
      written to both locales.
- [x] Per-download auto-install choice, persisted in both start-now and enqueue paths.
- [x] Typed install job/phase/error contracts plus narrowly scoped IPC/preload/renderer declarations.

### Phase 2 — provider-neutral job engine

- [x] Adapter registry, durable `install-jobs` sublevel, single-worker queue, restart reconciliation,
      cancel/retry, structured error codes, throttled events, pid tracking with ordered writes.
- [x] Manager tests: ordering, single installer at a time, duplicate completion events, running-job
      protection, unknown provider, cancellation and process-tree kill, retry/attempt counting,
      retry refusal for finished jobs, progress throttling, restart reconciliation, settings
      precedence for the destination, provider options, and the extraction sub-phase.
- [x] Downloads page shows queued/preparing/extracting/installing progress, awaiting-user,
      success, failure with a translated reason, and cancel/retry, without touching existing
      download/extraction state.

### Phase 3 — FitGirl preparation and Windows install

- [x] Explicit FitGirl detection, multipart RAR grouping (modern `.partNN` and old-style `.rNN`),
      package-root validation, setup/workdir/destination planning, and manifest-backed tests
      including traversal and incomplete-volume cases.
- [x] Windows-only runner using an argument array (`/DIR=` by default, silent switches only when the
      user opts in), no elevation, visible window, process-tree termination, and a destination check
      before reporting success.
- [ ] End-to-end run against a harmless synthetic Inno installer (target, companions, progress,
      cancel, restart, executable discovery).- [x] Linux/macOS keep extraction plus manual install. There the adapter reports
      `supportsAutomaticInstall = false`, so the job stops in `awaiting-user` rather than faking a
      Windows run.

### Phase 4 — release hardening

- [ ] Test actual UI in a packaged Windows build, including paths with spaces/non-ASCII, no admin
      rights, low disk space, an existing destination, cancellation, app quit/relaunch, torrent
      seeding, and a failed/retryable install.
- [ ] Verify binaries/dependencies are packaged and signed/scanned as appropriate; review
      license/attribution for any added RAR library or UI automation component (none added).
- [x] Translations added for `en` and `pt-BR` (the two locales this feature documents).
- [ ] Enable the FitGirl auto-install toggle only after the full success/failure/recovery flow is
      verified; it is off by default today, and the Windows limitation is shown in the UI.

## Acceptance criteria

- A user can turn FitGirl auto-install on/off, set a default install base directory, optionally override it for FitGirl, and select a per-download override.
- Download source/provider provenance survives queueing, app restart, and old records without accidentally classifying unknown sources.
- A supported FitGirl download is prepared once, installed to the reviewed safe destination, and produces accurate queued/progress/success/failure/cancel UI states.
- Restart, repeated completion events, retry, and cancellation cannot launch duplicate installers or delete source data needed by seeding/recovery.
- Unsupported providers/layouts and non-Windows installer execution fall back clearly and safely; existing non-FitGirl downloads and manual extraction continue to behave as before.
- Typechecks, focused unit/integration tests, format/lint, and a packaged UI smoke test pass; representative fixture coverage includes successful and adversarial archive layouts.

## Research/source links

- [CarrotRub/Fit-Launcher README](https://github.com/CarrotRub/Fit-Launcher/tree/fd1e8a0308dc9c51155805167f16053f0658ccac)
- [Multipart RAR extraction helper](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/src/extraction/functions.rs)
- [Installer runner and setup working-directory behavior](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-installer-controller/src/installer/runner.rs)
- [Serialized controller queue and helper-process lifecycle](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/src/controller_manager.rs)
- [Fit-Launcher extraction/UI automation dependencies](https://github.com/CarrotRub/Fit-Launcher/blob/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-ui-automation/Cargo.toml)
- [Fit-Launcher installer-controller process/IPC architecture](https://github.com/CarrotRub/Fit-Launcher/tree/fd1e8a0308dc9c51155805167f16053f0658ccac/src-tauri/local-crates/fit-launcher-installer-controller)

## Implementation status (branch `feat/fitgirl-auto-install`)

Code layout, all new files under `src/main/services/game-installation/` unless noted:

- `install-paths.ts`, `installation-preferences.ts`, `package-files.ts`, `fitgirl/fitgirl-package.ts`
  — pure helpers (sanitization, destination resolution, package listing, layout planning).
- `install-adapter.ts` — provider contract, `InstallError` with stable codes, provider list.
- `install-job-manager.ts` / `install-job-store.ts` — durable, single-worker job queue.
- `fitgirl/fitgirl-provider.ts`, `fitgirl/fitgirl-windows-installer.ts` — preparation and the
  Windows setup runner.
- `index.ts` — adapter registry, manager wiring, notifications, post-install executable/size
  binding, and `enqueueAutomaticInstallation()`.
- `src/main/events/game-installation/*`, `src/main/events/download-sources/set-download-source-installer-provider.ts`
  — IPC surface; `src/preload/index.ts` and `src/renderer/src/declaration.d.ts` mirror it.
- Renderer: `settings-context-downloads.tsx` (paths, toggle, silent-switch option),
  `settings-download-sources.tsx` (provider mapping), `download-settings-modal.tsx` (per-download
  opt-in), `hooks/use-install-jobs.ts`, `pages/downloads/download-install-status.tsx`.
- `Download.automaticallyInstall` / `Download.downloadSourceId` are written by both
  `start-game-download.ts` and `add-game-to-queue.ts`; `DownloadManager` queues installation after
  extraction completes; `main.ts` reconciles interrupted jobs at startup.

Verified so far: `tsc` for `tsconfig.node.json`, `tsconfig.web.json` and `tsconfig.test.json`;
39 focused tests (paths, preferences, FitGirl planning, package listing, job manager) green;
prettier clean on every touched file; eslint reports no errors. The full suite runs 1162 tests with
19 failures, all in the documented environmental buckets (EBUSY temp cleanup, Windows-only
RetroArch/RPCS3 layouts, Steam Proton prefix detection, real zip/7z reads, cloud-save custom-path
tests that assert Linux path semantics on Windows) — none in the modules this feature touches.

Known gaps and honest limitations:

- **No real installer has been run.** Success is decided by exit code 0 plus a non-empty destination,
  and the visible `setup.exe` path is assumed to accept Inno Setup's `/DIR=`. That assumption needs a
  real FitGirl package before the feature is advertised; the silent switches stay opt-in for the same
  reason.
- **No packaged UI smoke test.** The renderer changes typecheck and lint, but have not been clicked
  through in a running app.
- **Extraction is not interruptible.** `SevenZip.extractFile` takes no abort signal, so cancelling
  during the `extracting` phase stops the job at the next boundary rather than killing 7-Zip.
- **Multipart archives are grouped correctly but not proven extracted** with a real RAR set.
- Installation is Windows-only; macOS/Linux keep extraction plus the existing manual installer flow.
