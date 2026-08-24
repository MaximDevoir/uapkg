import { z } from 'zod';
import type { Brand } from '../brand/Brand.ts';

/**
 * Branded type for a registry git URL.
 */
export type RegistryURL = Brand<string, 'RegistryURL'>;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

export const RegistryURLSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    if (value.trim().length === 0) {
      context.addIssue({ code: 'custom', message: 'Must not be empty' });
      return;
    }

    if (hasControlCharacter(value)) {
      context.addIssue({ code: 'custom', message: 'Must not contain control characters' });
      return;
    }

    // Git accepts more than WHATWG URLs (for example `git@host:path` and
    // local paths), so only apply URL-specific secret checks to HTTP(S).
    if (!/^https?:/iu.test(value)) return;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid HTTP(S) registry URL' });
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'Must be a valid HTTP(S) registry URL' });
      return;
    }

    if (parsed.username.length > 0 || parsed.password.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'HTTP(S) registry URLs must not include credentials; configure authentication through Git',
      });
    }

    if (parsed.search.length > 0 || parsed.hash.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'HTTP(S) registry URLs must not include query strings or fragments',
      });
    }
  })
  .brand('RegistryURL');
