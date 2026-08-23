# uapkg

A plugin manager for Unreal Engine plugins.

## Prerequisites

- [Git](https://git-scm.com/)
- [Vite+ (`vp`)](https://viteplus.dev/guide/) installed globally

Node.js and pnpm do not need separate global installations. During the initial
`vp install --frozen-lockfile`, global `vp` reads `.node-version` and
`packageManager`, provisions Node.js 26.7.0 and pnpm 11.22.0, and performs the
install. After that, `vp` automatically uses the repository's local Vite+
toolchain.

## Setup

```sh
git clone https://github.com/MaximDevoir/uapkg.git
cd uapkg
vp install --frozen-lockfile
vp hooks status
```

The install lifecycle configures the committed Vite+ hooks. If hooks were
disabled locally, restore them with `vp hooks enable --hooks-dir .vite-hooks`.

Use `vp env doctor` to diagnose runtime declarations and `vp toolchain` to see
the selected local tool versions.

## Validation

```sh
vp check
vp test run
```

`vp check` runs Oxfmt, Oxlint, and type-aware TypeScript checks. The pre-commit
hook runs `vp staged`, limiting fixable checks to staged files.

## Builds

The root build preserves UAPKG's generated CLI launcher, build metadata,
executable permissions, and artifact verification while using `vp pack`
underneath for package compilation. It defaults to a development-stamped build:

```sh
vp run build
vp run build -- --production
```

The development workflow is available through the root tasks:

```sh
vp run build:link
vp run build:watch
vp run build:status
vp run build:unlink
vp run build:clean
```

See [the development-build tooling guide](tools/dev-build/README.md) for build
modes, global linking, profiles, cleanup, and verification behavior. See
[the consumer-bundle guide](tools/consumer-bundle/README.md) when another
repository needs unreleased UAPKG workspace packages.
