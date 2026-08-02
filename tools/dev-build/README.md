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
- `build:status`: inspect snapshot state, current global state, both persistent profile roots, global-bin/path health, and binary resolution.
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

The generated launcher also stamps the built-in `default` registry before it
imports the CLI:

- Production, unstamped, and unrecognized modes use branch `main` at
  `https://github.com/uapkg/registry`.
- Development mode uses branch `main` at the private
  `https://github.com/uapkg/registry-dev-tmp` repository.

The launcher overrides inherited internal build-mode and profile-root values
before loading the CLI. The build-mode stamp is only the lowest-precedence
registry default, so normal global and project configuration can replace that
registry selection.

The same immutable build metadata pins authenticated control-plane traffic to
one environment-specific endpoint pair:

- Production and source execution use issuer `https://account.uapkg.dev/oauth`
  and API origin `https://api.uapkg.dev`.
- Development builds use issuer `https://account-dev.uapkg.dev/oauth` and API
  origin `https://api-dev.uapkg.dev`.

Global, project, and registry metadata cannot override these authentication
endpoints. Registry OAuth audiences are derived from the pinned API origin, so
a development CLI cannot reuse a production grant or send one to development.
Authentication metadata and filesystem locks follow the selected persistent
profile. Secrets remain in the protected operating-system credential store;
their opaque references include the issuer, so production and development
credentials remain logically isolated.

## Persistent Profiles

The stamped CLI launcher selects a persistent profile before loading the CLI:

- Production builds use `~/.uapkg`.
- Development builds use `~/.uapkg-development`.

All global file-backed state uses the selected profile. This includes the global
configuration file, local Git registry cache, `auth.json`, `auth-locks`, and
their transient sibling files. Project-local and intermediary
`.uapkg/config.json` files are resolved from the working directory in exactly
the same way for both builds. OS credentials are not profile files and remain
in the protected credential store with issuer-scoped references.

The development profile is created only when a command first needs to write
persistent state. Linking never copies or renames production state, and link,
unlink, watch, force, build cleanup, and `clean:all` never delete or move either
user profile. There is no cross-profile authentication migration or fallback;
developers with an older development grant in `~/.uapkg/auth.json` must log in
once with the development CLI again.

Registry clones are also lazy: build, installation, linking, and CLI startup do
not access the network. The first package operation that needs registry content
clones the selected repository, while `uapkg registry refresh [alias]` forces a
clone/fetch regardless of TTL.

Both built-in repositories are private during development; the production
repository is temporary bootstrap state that will later be reset and linked
through the UAPKG website. Run `uapkg registry auth [alias]` on an attended
workstation to let system Git verify or obtain access. UAPKG stores no Git
credential. Headless jobs must provision Git independently through
`GIT_ASKPASS`, SSH/deploy keys, or another non-interactive credential helper.
`uapkg login` remains exclusively for the UAPKG control plane.

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
