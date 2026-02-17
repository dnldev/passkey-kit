/**
 * @passkey-kit/server
 *
 * Server-side WebAuthn passkey verification with challenge-response pattern
 * and argon2 password hashing.
 *
 * @ai_context This is the core auth library used across all dnldev apps.
 * Challenge generation and verification MUST happen server-side.
 * Client never sees raw challenges — only attestation/assertion responses.
 */

export { PasskeyServer } from './passkey-server.js';
export { hashPassword, verifyPassword } from './password.js';
export {
  MemoryChallengeStore,
  MemoryCredentialStore,
  FileChallengeStore,
  FileCredentialStore,
} from './stores.js';
export type {
  PasskeyServerConfig,
  StoredCredential,
  StoredChallenge,
  ChallengeStore,
  CredentialStore,
  RegistrationResult,
  AuthenticationResult,
  UserInfo,
} from './types.js';
