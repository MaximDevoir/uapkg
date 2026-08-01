# dev-build tooling

This folder contains local development tooling executed directly with `tsx`.

## Commands

```json
{
  "build": "tsx tools/dev-build/runDevBuild.ts build",
  "build:link": "tsx tools/dev-build/runDevBuild.ts link",
  "build:watch": "tsx tools/dev-build/runDevBuild.ts watch",
  "build:unlink": "tsx tools/dev-build/runDevBuild.ts unlink",
  "build:status": "tsx tools/dev-build/runDevBuild.ts status",
  "build:clean": "tsx tools/dev-build/runDevBuild.ts clean",
  "clean:all": "tsx tools/dev-build/runDevBuild.ts cleanAll"
}
```

## Behavior

- `build`: build the monorepo in production mode by default. Pass `--development` or `--production` to select the mode explicitly.
- `build:link`: build `uapkg` in development mode, globally register only `packages/uapkg` as `@uapkg/cli`, and write global command shims in `pnpm bin --global` so `uapkg` works from any terminal.
- `build:watch`: immediately run `build:link`, then watch only `uapkg` with `--includeDependentProjects` and relink a development build on changes.
- `build:unlink`: remove the active global dev link and restore only safe previous state.
- `build:status`: inspect snapshot state, current global state, both config/cache profile roots, global-bin/path health, and binary resolution.
- `build:clean`: remove build artifacts (`dist`, `build`, `coverage`, Nx cache/workspace-data, `*.tsbuildinfo`) across root and workspace packages.
- `clean:all`: run unlink with force, then run `build:clean`, remove workspace `node_modules`, remove workspace `.pnpm-store` directories, and prune pnpm store metadata. User profile state is retained.

Snapshot file:

- `tools/dev-build/.state/global-uapkg-state.json`

## Force options

- `pnpm run build:link -- --force`
- `pnpm run build:unlink -- --force`

`--force` allows overriding conservative defaults, but external dev links are still never auto-restored.

## Build modes

- `pnpm run build` and `pnpm run build -- --production` produce production artifacts.
- `pnpm run build -- --development` produces a development-stamped CLI artifact.
- `--development` and `--production` are mutually exclusive.
- `build:link` and `build:watch` always use development mode and reject either build-mode flag.

The development banner is embedded in the built CLI rather than its global command shim. It is written to stderr so commands with machine-readable or `--json` stdout remain pipeable.

## Configuration and Registry Cache Profiles

The stamped CLI launcher selects a persistent profile before loading the CLI:

- Production builds use `~/.uapkg`.
- Development builds use `~/.uapkg-development`.

Only the global configuration file and local Git registry cache use the selected profile. Project-local and intermediary `.uapkg/config.json` files are resolved from the working directory in exactly the same way for both builds. Authentication metadata, authentication locks, and OS credentials remain shared through the production `~/.uapkg` location.

The development profile is created only when a command first needs to write configuration or cache state. Linking never copies or renames production state, and link, unlink, watch, force, build cleanup, and `clean:all` never delete or move either user profile.

## Running from Anywhere

After `build:link`, `uapkg` is expected to resolve from the pnpm global bin directory, not from the monorepo root.

Quick checks:

```powershell
pnpm run build:link
pnpm run build:status
pnpm bin --global
where.exe uapkg
```

If `build:status` shows `Global Bin In PATH: no`, add the printed global bin directory to your user `PATH` and open a new terminal.
With pnpm 11, `pnpm setup` performs that PATH update; close and reopen CMD.exe afterward.
If `where.exe uapkg` lists another package manager's shim first, move the pnpm global bin directory earlier in `PATH`.

## Do Not

- Do not globally link `@uapkg/config`, `@uapkg/pack`, `@uapkg/diagnostics`, or any other internal packages.
- Do not use repo-local `.pnpm-global`; use real pnpm global state.
- Do not overwrite the restore snapshot on repeated `build:link` unless `--force` is explicitly passed.
- Do not use `pnpm link --global`; pnpm 11 replaced it with `pnpm add --global .`.
- Do not use `pnpm unlink --global`; use `pnpm remove --global`.
- Do not manually maintain package lists that Nx can derive.

## CI Rule

CI must use normal install/build/typecheck/test flows only.

CI must not run:

- `build:link`
- `build:watch`
- `build:unlink`
- `clean:all`

## Acceptance Tests

- `pnpm run build:link` globally registers `@uapkg/cli` from `packages/uapkg`.
- `pnpm list -g --depth 0` shows `@uapkg/cli` sourced from `<workspace>/packages/uapkg`.
- `where.exe uapkg` resolves from `pnpm bin --global` after linking.
- Running `build:link` twice does not overwrite the original snapshot.
- `build:status` prints both `~/.uapkg` and `~/.uapkg-development` profile roots.
- `pnpm run build:unlink` restores published `@uapkg/cli@<version>` if that was the prior state.
- If prior state was another dev link, unlink removes current link but does not restore the external link.
- `pnpm run build:watch` does not contain a manually maintained project list.
- `pnpm run build:watch` performs an initial development link before waiting for changes.
- `pnpm run build:clean` removes build outputs and leaves install state untouched.
- `pnpm run clean:all` removes install/build state from root and workspace packages while retaining both user profiles.
- CI typecheck still passes without global links.
