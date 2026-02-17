/**
 * Password hashing using argon2id.
 *
 * @ai_context Replaces the old PBKDF2 (10K iterations) pattern used across
 * all dnldev apps. argon2id is the recommended algorithm for password hashing
 * as of 2024 (OWASP recommendation).
 *
 * The hash() output includes algorithm params, salt, and hash in PHC format
 * so it's self-describing and upgradeable.
 */

import argon2 from 'argon2';

/**
 * Hash a password/passphrase using argon2id.
 * Returns a PHC-format string that includes the salt and parameters.
 *
 * @param password - The plaintext password to hash
 * @param options - Optional argon2 options (memoryCost, timeCost, parallelism)
 */
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
    memoryCost: options?.memoryCost ?? 65536, // 64 MB
    timeCost: options?.timeCost ?? 3,
    parallelism: options?.parallelism ?? 4,
  });
}

/**
 * Verify a password against a stored argon2 hash.
 *
 * @param hash - The stored PHC-format hash string
 * @param password - The plaintext password to verify
 * @returns true if the password matches
 */
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

/**
 * Check if a hash needs rehashing (e.g. after parameter upgrades).
 * Uses argon2's built-in needsRehash detection.
 */
export async function needsRehash(
  hash: string,
  options?: {
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
  },
): Promise<boolean> {
  return argon2.needsRehash(hash, {
    memoryCost: options?.memoryCost ?? 65536,
    timeCost: options?.timeCost ?? 3,
    parallelism: options?.parallelism ?? 4,
  });
}
