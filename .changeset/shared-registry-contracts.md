---
'@uapkg/common-schema': patch
'@uapkg/config': patch
'@uapkg/package-claims': minor
'@uapkg/package-manifest-schema': minor
'@uapkg/registry-schema': minor
'@uapkg/registry-core': patch
'@uapkg/package-manifest': patch
'@uapkg/installer': patch
'@uapkg/cli': patch
---

Publish normalized package-claims schemas and the versioned registry metadata contract, with a shared context-aware package-registry manifest validator for public and private registries.

Share compatible Zod instances through peer dependencies, permit private registry records and lock entries without Git trees, and fail closed on missing or unsupported registry metadata and public records missing required Git provenance.

Represent common-schema brands with JSON Schema-compatible type-only branding, expose package-name constraints on claims record keys, and reject non-canonical prefixed package versions.
