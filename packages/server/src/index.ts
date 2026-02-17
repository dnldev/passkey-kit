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

export { PasskeyServer } from './passkey-server';
export { createExpressRoutes } from './express-routes';
export { hashPassword, verifyPassword } from './password';
export {
  MemoryChallengeStore,
  MemoryCredentialStore,
  FileChallengeStore,
  FileCredentialStore,
} from './stores';
export type {
  PasskeyServerConfig,
  StoredCredential,
  StoredChallenge,
  ChallengeStore,
  CredentialStore,
  RegistrationResult,
  AuthenticationResult,
  UserInfo,
} from './types';
