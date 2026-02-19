/**
 * Stateless challenge token using AES-256-GCM (Web Crypto API).
 *
 * @ai_context This is the core innovation for serverless deployments.
 * Instead of storing challenges in a database/memory, we encrypt the
 * challenge payload into an opaque token. The server can verify it later
 * without any state — just the secret key.
 *
 * Uses the standard Web Crypto API (`crypto.subtle`) so it runs natively
 * in Node 18+, Deno, Bun, Cloudflare Workers, and Vercel Edge Runtime.
 *
 * Token format: base64url(iv + ciphertext + authTag)
 * Payload: JSON { challenge, userId?, type, exp }
 *
 * Security properties:
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity)
 * - HKDF-SHA256 derives the encryption key from the secret (domain separation)
 * - The challenge value is hidden from the client (they only see the opaque token)
 * - Expiry is baked into the token — no cleanup needed
 * - Each token has a unique IV — replay is prevented by single-use consumption
 *
 * Key rotation: accepts multiple keys. Always encrypts with the first key.
 * Decryption tries each key in order until one succeeds.
 */

const IV_LEN = 12;
const HKDF_INFO = new TextEncoder().encode('passkey-kit-challenge-key');

export interface ChallengeTokenPayload {
  /** The WebAuthn challenge string (base64url from @simplewebauthn) */
  challenge: string;
  /** User ID (present during registration, optional during auth) */
  userId?: string;
  /** 'registration' or 'authentication' */
  type: 'registration' | 'authentication';
  /** Expiry timestamp (ms since epoch) */
  exp: number;
}

/**
 * Derive a 256-bit AES-GCM CryptoKey from a secret string using HKDF.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: HKDF_INFO },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- Base64url helpers (no Buffer dependency) ---

function toBase64Url(buf: Uint8Array): string {
  const binStr = Array.from(buf, b => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (str.length % 4)) % 4);
  const binStr = atob(padded);
  return Uint8Array.from(binStr, c => c.charCodeAt(0));
}

/**
 * Encrypt a challenge payload into an opaque base64url token.
 */
export async function sealChallengeToken(
  payload: ChallengeTokenPayload,
  secret: string,
): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  // AES-GCM encrypt (returns ciphertext + 16-byte auth tag appended)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );

  // Combine: iv (12) + ciphertext+tag (variable)
  const combined = new Uint8Array(IV_LEN + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, IV_LEN);

  return toBase64Url(combined);
}

/**
 * Decrypt and verify a challenge token with a single key.
 * Returns null if invalid/expired.
 */
async function openWithKey(
  buf: Uint8Array,
  secret: string,
): Promise<ChallengeTokenPayload | null> {
  try {
    const key = await deriveKey(secret);
    const iv = buf.slice(0, IV_LEN);
    const ciphertextWithTag = buf.slice(IV_LEN);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertextWithTag,
    );

    const payload: ChallengeTokenPayload = JSON.parse(
      new TextDecoder().decode(decrypted),
    );

    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Decrypt and verify a challenge token. Supports key rotation —
 * if `secret` is an array, tries each key in order until one works.
 * Returns null if all keys fail or the token is expired.
 */
export async function openChallengeToken(
  token: string,
  secret: string | string[],
): Promise<ChallengeTokenPayload | null> {
  try {
    const buf = fromBase64Url(token);
    // AES-GCM tag is 16 bytes, so minimum length is IV + 1 byte ciphertext + 16 tag
    if (buf.length < IV_LEN + 17) return null;

    const secrets = Array.isArray(secret) ? secret : [secret];
    for (const s of secrets) {
      const result = await openWithKey(buf, s);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}
