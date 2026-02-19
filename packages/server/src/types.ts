/**
 * Type definitions for @passkeykit/server
 *
 * These types define the storage interface abstraction.
 * Apps provide their own ChallengeStore and CredentialStore implementations
 * so the library works with any backend (Firestore, file JSON, SQLite, Redis, etc).
 */

import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

/** Configuration for PasskeyServer */
export interface PasskeyServerConfig {
  /** Relying Party name shown to users (e.g. "My App") */
  rpName: string;
  /** Relying Party ID — must be a valid domain (e.g. "auth.example.com") */
  rpId: string;
  /** Allowed origins for WebAuthn (e.g. ["https://example.com"]) */
  allowedOrigins: string[];
  /**
   * Challenge store implementation (stateful mode).
   * If omitted, stateless mode is used instead (requires `encryptionKey`).
   */
  challengeStore?: ChallengeStore;
  /** Credential store implementation */
  credentialStore: CredentialStore;
  /** Challenge TTL in ms (default: 5 minutes) */
  challengeTTL?: number;
  /**
   * Secret key for stateless challenge tokens (AES-256-GCM).
   * Required when `challengeStore` is not provided.
   * Must be at least 32 characters. Derive from env: process.env.PASSKEY_SECRET
   */
  encryptionKey?: string;
}

/** A stored WebAuthn credential (persisted per-user) */
export interface StoredCredential {
  /** Base64URL-encoded credential ID */
  credentialId: string;
  /** Base64URL-encoded public key */
  publicKey: string;
  /** Signature counter for replay protection */
  counter: number;
  /** Credential transports (for allowCredentials hints) */
  transports?: AuthenticatorTransportFuture[];
  /** Human-readable name for this credential */
  name?: string;
  /** ISO timestamp of registration */
  registeredAt: string;
  /** User ID this credential belongs to */
  userId: string;
}

/** A stored challenge (short-lived, for verification) */
export interface StoredChallenge {
  /** The challenge string */
  challenge: string;
  /** User ID (if applicable, e.g. during registration) */
  userId?: string;
  /** Expiry timestamp (ms since epoch) */
  expiresAt: number;
  /** 'registration' or 'authentication' */
  type: 'registration' | 'authentication';
}

/** User info passed during registration */
export interface UserInfo {
  id: string;
  name: string;
  displayName?: string;
}

/** Result of successful registration */
export interface RegistrationResult {
  credential: StoredCredential;
  verified: boolean;
}

/** Result of successful authentication */
export interface AuthenticationResult {
  credentialId: string;
  userId: string;
  verified: boolean;
  newCounter: number;
}

/**
 * Challenge store abstraction — apps implement this for their storage backend.
 * Challenges are short-lived (5 min default) and must be cleaned up.
 */
export interface ChallengeStore {
  /** Save a challenge. Key can be any unique string (userId or random token). */
  save(key: string, challenge: StoredChallenge): Promise<void>;
  /** Retrieve and delete a challenge (one-time use). Returns null if expired/missing. */
  consume(key: string): Promise<StoredChallenge | null>;
}

/**
 * Credential store abstraction — apps implement this for their storage backend.
 */
export interface CredentialStore {
  /** Save a new credential */
  save(credential: StoredCredential): Promise<void>;
  /** Get all credentials for a user */
  getByUserId(userId: string): Promise<StoredCredential[]>;
  /** Get a credential by its ID */
  getByCredentialId(credentialId: string): Promise<StoredCredential | null>;
  /** Update counter after successful authentication */
  updateCounter(credentialId: string, newCounter: number): Promise<void>;
  /** Delete a credential */
  delete(credentialId: string): Promise<void>;
}
