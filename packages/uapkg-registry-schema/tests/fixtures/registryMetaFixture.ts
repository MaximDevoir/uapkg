export type RegistryMetaFixtureFormat = 'reduced' | 'rich';

/** Independent fixtures for the retained v1 core and the former richer file. */
export function registryMetaFixture({
  format = 'reduced',
  schemaVersion = 1,
  registryType = 'public',
  name = 'Official',
}: {
  readonly format?: RegistryMetaFixtureFormat;
  readonly schemaVersion?: number;
  readonly registryType?: 'public' | 'private';
  readonly name?: string;
} = {}) {
  const core = {
    schemaVersion,
    registry: {
      id: '00000000-0000-4000-a000-000000000020',
      name,
      registryType,
    },
  };
  if (format === 'reduced') return core;
  return {
    ...core,
    registry: {
      ...core.registry,
      normalizedName: 'official',
      createdAt: 1_700_000_000,
    },
    owner: {
      kind: 'organization',
      id: '00000000-0000-4000-a000-000000000021',
      name: 'UAPKG',
      normalizedName: 'uapkg',
    },
    sourceOfTruth: { type: 'uapkg-service', apiBaseUrl: 'https://untrusted.example.invalid' },
    generated: { generatedAt: 1_700_000_001, generatedBy: 'uapkg-registry-app' },
  };
}
