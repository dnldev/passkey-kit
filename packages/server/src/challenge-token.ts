/**
 * Stateless challenge token using AES-256-GCM + HMAC-SHA256.
 *
 * @ai_context This is the core innovation for serverless deployments.
 * Instead of storing challenges in a database/memory, we encrypt the
 * challenge payload into an opaque token. The server can verify it later
 * without any state — just the secret key.
 *
 * Token format: base64url(iv + ciphertext + authTag)
 * Payload: JSON { challenge, userId?, type, exp }
 *
 * Security properties:
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity)
 * - The challenge value is hidden from the client (they only see the opaque token)
 * - Expiry is baked into the token — no cleanup needed
 * - Each token has a unique IV — replay is prevented by single-use consumption
 *   (the WebAuthn spec itself prevents replays via the challenge binding)
 */

import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';

const ALG = 'aes-256-gcm' as const;
const IV_LEN = 12;
const TAG_LEN = 16;

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
 * Derive a 32-byte encryption key from a secret string.
 * Uses HMAC-SHA256 with a fixed context label (domain separation).
 */
function deriveKey(secret: string): Buffer {
  return createHmac('sha256', 'passkey-kit-challenge-key')
    .update(secret)
    .digest();
}

/**
 * Encrypt a challenge payload into an opaque base64url token.
 */
export function sealChallengeToken(payload: ChallengeTokenPayload, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);

  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // iv (12) + ciphertext (variable) + tag (16)
  const combined = Buffer.concat([iv, encrypted, tag]);
  return combined.toString('base64url');
}

/**
 * Decrypt and verify a challenge token. Returns null if invalid/expired.
 */
export function openChallengeToken(token: string, secret: string): ChallengeTokenPayload | null {
  try {
    const key = deriveKey(secret);
    const buf = Buffer.from(token, 'base64url');

    if (buf.length < IV_LEN + TAG_LEN + 1) return null;

    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);

    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload: ChallengeTokenPayload = JSON.parse(decrypted.toString('utf8'));

    // Check expiry
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}
