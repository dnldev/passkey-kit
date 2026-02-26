/**
 * Password hashing using scrypt (pure JavaScript via @noble/hashes).
 *
 * @ai_context Replaces the native argon2 module as the default.
 * @noble/hashes is audited by Trail of Bits and works on every runtime:
 * Node.js, Deno, Bun, Cloudflare Workers, Vercel Edge, browser.
 *
 * Uses Web Crypto API for random salt generation — no node:crypto dependency.
 *
 * For users who want argon2id (requires native bindings), see the
 * `@passkeykit/server/argon2` subpath export.
 *
 * Output format is PHC-like:
 *   $scrypt$ln=17,r=8,p=1$<base64salt>$<base64hash>
 */

import { scrypt as scryptSync } from '@noble/hashes/scrypt';

/** Default scrypt parameters (OWASP recommendations for interactive login) */
const DEFAULTS = {
  N: 2 ** 17,  // 131072 — CPU/memory cost
  r: 8,        // Block size
  p: 1,        // Parallelism
  dkLen: 32,   // Output key length
  saltLen: 16, // Salt length
} as const;

export interface ScryptOptions {
  /** CPU/memory cost parameter (power of 2). Default: 2^17 */
  N?: number;
  /** Block size. Default: 8 */
  r?: number;
  /** Parallelism. Default: 1 */
  p?: number;
}

// --- Base64 helpers (no Buffer dependency) ---

function uint8ToBase64(buf: Uint8Array): string {
  const binStr = Array.from(buf, b => String.fromCodePoint(b)).join('');
  return btoa(binStr);
}

function base64ToUint8(str: string): Uint8Array {
  const binStr = atob(str);
  return Uint8Array.from(binStr, c => c.codePointAt(0)!);
}

/**
 * Constant-time comparison — prevents timing attacks on hash verification.
 * Works on all runtimes (no node:crypto dependency).
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (const [index, byteValue] of a.entries()) {
    result |= byteValue ^ b[index]!;
  }
  return result === 0;
}

/**
 * Hash a password using scrypt.
 * Returns a PHC-format string: $scrypt$ln=<log2N>,r=<r>,p=<p>$<salt>$<hash>
 */
export async function hashPassword(
  password: string,
  options?: ScryptOptions,
): Promise<string> {
  const N = options?.N ?? DEFAULTS.N;
  const r = options?.r ?? DEFAULTS.r;
  const p = options?.p ?? DEFAULTS.p;
  const salt = crypto.getRandomValues(new Uint8Array(DEFAULTS.saltLen));

  const hash = scryptSync(password, salt, { N, r, p, dkLen: DEFAULTS.dkLen });

  const ln = Math.log2(N);
  const saltB64 = uint8ToBase64(salt);
  const hashB64 = uint8ToBase64(hash);
  return `$scrypt$ln=${ln},r=${r},p=${p}$${saltB64}$${hashB64}`;
}

/**
 * Verify a password against a stored scrypt hash.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  const parsed = parsePhc(storedHash);
  if (!parsed) return false;

  const { N, r, p, salt, hash } = parsed;
  const derived = scryptSync(password, salt, { N, r, p, dkLen: hash.length });

  return constantTimeEqual(new Uint8Array(derived), hash);
}

/**
 * Check if a hash needs rehashing (params differ from current defaults).
 */
export function needsRehash(
  storedHash: string,
  options?: ScryptOptions,
): boolean {
  const parsed = parsePhc(storedHash);
  if (!parsed) return true;

  const N = options?.N ?? DEFAULTS.N;
  const r = options?.r ?? DEFAULTS.r;
  const p = options?.p ?? DEFAULTS.p;

  return parsed.N !== N || parsed.r !== r || parsed.p !== p;
}

// --- Internal helpers ---

function parsePhc(phc: string): { N: number; r: number; p: number; salt: Uint8Array; hash: Uint8Array } | null {
  // $scrypt$ln=17,r=8,p=1$<salt>$<hash>
  const match = phc.match(/^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/);
  if (!match) return null;

  return {
    N: 2 ** Number.parseInt(match[1], 10),
    r: Number.parseInt(match[2], 10),
    p: Number.parseInt(match[3], 10),
    salt: base64ToUint8(match[4]),
    hash: base64ToUint8(match[5]),
  };
}
