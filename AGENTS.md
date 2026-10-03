# AGENTS.md

Notes for coding agents and contributors working in this checkout. Read this
before running checks: the local machine and the test suite have a few traps.

## Project overview

Hydra launcher fork (nayan8teen/hydra, upstream hydralauncher/hydra).

- Electron + React + TypeScript, bundled with `electron-vite`.
- `"type": "module"`, ESM everywhere; relative imports in main-process services
  use the `.js` extension on `.ts` files.
- Package manager is **yarn 1** (`engines` rejects npm). Workspaces map:
  `src/main` (main process), `src/renderer` (UI), `src/preload`,
  `src/big-picture`, plus `src/shared` (imported as `@shared`),
  `src/types` (`@types`), `src/main/level` (`@main/level`).
- LevelDB keys live in `src/main/level/sublevels/keys.ts` — add new keys there.
- Tests are colocated `*.test.ts` files run by Node's built-in test runner via
  `scripts/register-ts-node.mjs` (see `npm test`).
- Commits follow Conventional Commits (`feat(google-drive): …`, `fix(…)`,
  `ci(workflows): …`).

## Local tooling: there is no Node on PATH

This machine has **no Node.js, npm, yarn, or npx** installed and the Docker
daemon is usually not running. `node_modules` is present (Windows/x64), so use
a portable Node extracted into the temp directory. As of 2026-10-03 it is
already unpacked at `/tmp/node-v20.19.5-win-x64/` (Git Bash path for
`C:\Users\<user>\AppData\Local\Temp`). If it is missing:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v20.19.5/node-v20.19.5-win-x64.zip
powershell -NoProfile -Command "Expand-Archive -Force node-v20.19.5-win-x64.zip ."
```

(Do **not** extract with `tar -xf`; the Git Bash tar cannot read this zip.)

Node 20.x matches `@types/node ^20`. All commands below use the absolute path
`/tmp/node-v20.19.5-win-x64/node.exe` and must run from the project root.

### Typecheck

```bash
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
/tmp/node-v20.19.5-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false
```

### Tests

```bash
set -o pipefail
/tmp/node-v20.19.5-win-x64/node.exe --import ./scripts/register-ts-node.mjs --test $(find src -name "*.test.ts" | tr '\n' ' ')
```

- The `package.json` glob form (`--test "src/**/*.test.ts"`) does **not**
  expand under this setup; pass explicit file lists instead.
- When piping output (`| tail`, `| grep`), set `set -o pipefail` first, or the
  pipeline masks the test runner's exit code.
- For quick iteration, list only the test files you touched. Modules that
  `import { … } from "electron"` (e.g. `google-drive-auth.ts`,
  `google-drive-settings.ts`) cannot run under plain Node — their behavior is
  covered indirectly through modules that don't import Electron.

### Lint & format

```bash
/tmp/node-v20.19.5-win-x64/node.exe node_modules/prettier/bin/prettier.cjs --check <files>
/tmp/node-v20.19.5-win-x64/node.exe node_modules/eslint/bin/eslint.js <files>
```

Run both on the files you changed; CI enforces them (`format-check`, `lint`).

## Pre-existing environmental test failures

The full test suite currently reports ~26 failures that are **pre-existing
Windows environment issues, not code regressions**. Observed on 2026-10-03 at
commit `489d98328` and reproducible on later work; totals were 1085 pass /
26 fail / 12 skipped.

They fall into three buckets:

1. `EBUSY: resource busy or locked, unlink …` — Windows file locking during
   temp cleanup (e.g. `src/main/services/notifications/notification-icon.test.ts`).
2. `EPERM: operation not permitted, symlink …` — creating symlinks requires
   admin or Windows Developer Mode (RetroArch battery/save tests).
3. Native/binary helpers: real 7z/zip archive reading, RPCS3/RetroArch save
   layouts, Steam Proton prefix detection, `GameArtifact` downloads.

Before blaming your change for a failure:

- Check the failing test's `error:` string — `EBUSY`/`EPERM`/binary-missing
  means environment, not logic.
- Confirm the failing test does not import anything you modified.
- Run only the suites related to your change; they should be green.

Do not try to "fix" these tests as a side effect of unrelated work, and do not
skip or weaken them.

## Git & PRs

- `origin` is the fork `git@github.com:nayan8teen/hydra.git`; `upstream` is
  `hydralauncher/hydra`. Feature branches live on the fork and PRs target the
  fork's own `main` (`gh pr create --repo nayan8teen/hydra --base main`).
- `gh` CLI is installed and authenticated as `nayan8teen` (SSH protocol).
- Keep unrelated working-tree entries (e.g. `.freebuff/` agent state) out of
  commits; stage files explicitly.

## Domain conventions: Google Drive / cloud save

- Every authorization failure carries a stable `google_drive_*` marker
  prefixed to its error message (`src/main/services/google-drive/google-drive-oauth-error.ts`),
  which the renderer maps to translation keys in `src/shared/google-drive.ts`.
  When adding a failure path, add the marker, the mapping, and copy in **both**
  `src/locales/en` and `src/locales/pt-BR` (the only locales carrying these keys).
- Credentials (OAuth tokens, the optional client secret) are persisted
  encrypted with Electron `safeStorage`, each in its own LevelDB record with a
  `{ version, encrypted, value }` shape — never inside the plain settings JSON.
- The Google OAuth flow is PKCE over a loopback redirect (`127.0.0.1:<random
  port>`) opened in the system browser; the optional client secret is only
  needed for "Web application" client IDs, which Google rejects with
  `client_secret is missing.` otherwise.
