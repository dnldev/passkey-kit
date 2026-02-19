/**
 * Typed error class for passkey operations.
 *
 * @ai_context Enables consumers to handle different error scenarios:
 * - USER_CANCELLED: User closed the WebAuthn prompt
 * - SERVER_ERROR: Server returned a non-2xx response
 * - NETWORK_ERROR: Fetch failed (offline, DNS, etc.)
 * - INVALID_RESPONSE: Server returned unexpected data
 * - NOT_SUPPORTED: Browser doesn't support WebAuthn
 * - UNKNOWN: Unexpected errors
 */

export type PasskeyErrorCode =
  | 'USER_CANCELLED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'NOT_SUPPORTED'
  | 'UNKNOWN';

export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;
  readonly statusCode?: number;

  constructor(code: PasskeyErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
    this.statusCode = statusCode;
  }

  /** Check if this is a user cancellation (not a real error) */
  get isCancelled(): boolean {
    return this.code === 'USER_CANCELLED';
  }

  /**
   * Convert a WebAuthn error (from @simplewebauthn/browser) to a PasskeyError.
   * NotAllowedError = user cancelled the prompt.
   */
  static fromWebAuthnError(err: unknown): PasskeyError {
    if (err instanceof Error) {
      if (err.name === 'NotAllowedError') {
        return new PasskeyError('USER_CANCELLED', 'User cancelled the WebAuthn prompt');
      }
      if (err.name === 'NotSupportedError' || err.name === 'SecurityError') {
        return new PasskeyError('NOT_SUPPORTED', err.message);
      }
      return new PasskeyError('UNKNOWN', err.message);
    }
    return new PasskeyError('UNKNOWN', String(err));
  }
}
