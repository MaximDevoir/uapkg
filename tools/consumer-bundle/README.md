# UAPKG consumer bundles

This tool builds and packs the complete internal runtime dependency closure required by an npm consumer. It is intended
for local and pinned development environments that need unreleased UAPKG schemas while leaving the consumer's production
`package.json` and lockfile on published npm versions.

```sh
vp run consumer:bundle -- \
  --consumer ../registry-infra/package.json \
  --output ../registry-infra/.uapkg-deps \
  --requested-ref local
```

Use `--root @uapkg/package-name` to select a subset of the consumer's declared runtime roots. Without `--root`, every
`@uapkg/*` entry in the consumer's `dependencies` and `optionalDependencies` is included. Development trees may be dirty
or unpushed. CI must pass both `--ci` and `--expected-commit <40-character-sha>`; this rejects a dirty or unexpected tree.

The command builds the selected workspace dependency closure through Vite Task and delegates package tarball creation to
the repository's Vite+-managed pnpm, so `workspace:` ranges receive their publish-time rewrite. It canonicalizes the
packed `package.json` key order and writes content-addressed tarballs plus `uapkg-bundle.json`. The manifest has no
timestamp and is deterministic for the same consumer manifest, source identity, requested ref, and package contents.

`bundleDigest` is lowercase SHA-256 over the canonical JSON representation of every manifest member except
`bundleDigest`. Canonical JSON recursively sorts object keys lexicographically, preserves array order, and contains no
insignificant whitespace. `roots` and `packages` are name-sorted. Consumers can therefore independently validate both
the aggregate identity and every tarball's `sha256` before installation.
