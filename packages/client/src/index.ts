/**
 * @passkey-kit/client
 *
 * Client-side WebAuthn helpers that work with @passkey-kit/server.
 * Uses @simplewebauthn/browser for the WebAuthn ceremony.
 *
 * @ai_context The client does NOT generate challenges — it receives them
 * from the server and passes signed responses back. This is the key
 * difference from the old insecure pattern.
 */

export { PasskeyClient } from './passkey-client';
export type { PasskeyClientConfig } from './passkey-client';
export { isWebAuthnAvailable, isPlatformAuthenticatorAvailable } from './detect';
