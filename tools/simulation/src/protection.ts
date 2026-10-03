import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Optional deployment-protection credential. Never place this file in source or prompts. */
export function protectionSecret(): string | undefined {
  const path = process.env['SIM_PROTECTION_BYPASS_FILE'];
  if (!path) return undefined;
  try {
  return z.object({ vercelProtectionBypass: z.string().min(16).max(1024).regex(/^[^\r\n]+$/) }).strict()
    .parse(JSON.parse(readFileSync(path, 'utf8'))).vercelProtectionBypass;
  } catch { throw new Error('Private protection configuration is missing or malformed; contents withheld.'); }
}

export function protectionHeaders(secret?: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}
