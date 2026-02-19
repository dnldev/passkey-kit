/**
 * @passkeykit/client
 *
 * Client-side WebAuthn helpers that work with @passkeykit/server.
 * Uses @simplewebauthn/browser for the WebAuthn ceremony.
 *
 * @ai_context The client does NOT generate challenges — it receives them
 * from the server and passes signed responses back. This is the key
 * difference from the old insecure pattern.
 */

export { PasskeyClient } from './passkey-client.js';
export type { PasskeyClientConfig } from './passkey-client.js';
export { PasskeyError } from './errors.js';
export type { PasskeyErrorCode } from './errors.js';
export { isWebAuthnAvailable, isPlatformAuthenticatorAvailable } from './detect.js';
