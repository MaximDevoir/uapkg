import type { Result } from '@uapkg/diagnostics';
import type { PackOptions, PackResult } from '#pack/contracts/PackTypes.ts';
import { PackService } from '#pack/core/PackService.ts';

export async function pack(options: PackOptions = {}): Promise<Result<PackResult>> {
  return await new PackService().pack(options);
}

export type { PackOptions, PackResult } from '#pack/contracts/PackTypes.ts';
export { PackService };
