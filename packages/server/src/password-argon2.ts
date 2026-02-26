/**
 * Password hashing using argon2id (native C++ bindings).
 *
 * @ai_context This is an OPTIONAL subpath export for users who:
 * 1. Run on a platform with native module support (Node.js, not serverless edge)
 * 2. Want the absolute strongest password hash (argon2id > scrypt)
 *
 * Import: import { hashPassword, verifyPassword } from '@passkeykit/server/argon2'
 *
 * Most users should use the default scrypt export which works everywhere.
 */

import argon2 from 'argon2';

export async function hashPassword(
  password: string,
  options?: {
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
  },
): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: options?.memoryCost ?? 65_536,
    timeCost: options?.timeCost ?? 3,
    parallelism: options?.parallelism ?? 4,
  });
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(storedHash, password);
}

export function needsRehash(
  storedHash: string,
  options?: {
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
  },
): boolean {
  return argon2.needsRehash(storedHash, {
    memoryCost: options?.memoryCost ?? 65_536,
    timeCost: options?.timeCost ?? 3,
    parallelism: options?.parallelism ?? 4,
  });
}
