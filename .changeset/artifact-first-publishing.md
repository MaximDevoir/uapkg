---
'@uapkg/cli': minor
'@uapkg/common-schema': minor
'@uapkg/installer': minor
'@uapkg/package-claims': minor
'@uapkg/package-manifest': minor
'@uapkg/package-manifest-schema': minor
'@uapkg/registry-core': minor
'@uapkg/registry-schema': minor
'@uapkg/registry-tools': minor
---

Move publishing and installation to the artifact-first v1 model.

`uapkg publish` now observes the exact release artifact (fresh download or `--asset-path`), reads the packaged `uapkg.json` claims from it, and submits the observed integrity and normalized claims to the dedicated `POST /v1/registry-requests/publish` route with a persisted idempotency key, polling the new `queued → checking → accepted → ready` status vocabulary (`--manifest-path` and client-side kind selection are removed). New `uapkg yank`, `unyank`, `unpublish`, `deprecate`, and `undeprecate` commands submit the route-derived lifecycle operations.

The new `@uapkg/package-claims` package provides the shared packaged-manifest reader, canonical-JSON claims normalization, and comparison used by both publish preflight and the installer. Installation is now verification-gated: every package must pass exact size, SHA-256, and packaged-claims comparison before activation, dependency edges are only trusted from verified parents, and installs report installed/failed/skipped outcomes instead of failing open.

Schemas adopt the v1 contracts: scoped package names (`@scope/name`) with a shared registry path layout, exact `sha256:`-prefixed asset hashes, a normalized `private` flag on registry version records with tolerant parsing of unknown members, inherited registries expressed by omission, and a fail-closed lockfile version.
