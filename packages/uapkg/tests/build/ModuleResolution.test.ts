import { describe, expect, it } from 'vite-plus/test';
import { ControlPlaneError as ScopedControlPlaneError } from '#cli/control-plane/ControlPlaneTypes.ts';
import { ControlPlaneError } from '../../src/control-plane/ControlPlaneTypes.ts';

describe('source module resolution', () => {
  it('uses the same module instance for source aliases and colocated test imports', () => {
    expect(ScopedControlPlaneError).toBe(ControlPlaneError);
  });
});
