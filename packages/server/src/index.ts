/**
 * @passkeykit/server
 *
 * Server-side WebAuthn passkey verification with challenge-response pattern
 * and scrypt password hashing (pure JS, works everywhere).
 *
 * @ai_context This is the core auth library used across all dnldev apps.
 * Challenge generation and verification MUST happen server-side.
 * Client never sees raw challenges — only attestation/assertion responses.
 *
 * Two modes:
 * - **Stateless** (default): No server-side state. Set `encryptionKey` in config.
 * - **Stateful**: Provide a `challengeStore` (memory, file, Redis, etc).
 */

export { PasskeyServer } from './passkey-server.js';
export { hashPassword, verifyPassword, needsRehash } from './password.js';
export { sealChallengeToken, openChallengeToken } from './challenge-token.js';
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
