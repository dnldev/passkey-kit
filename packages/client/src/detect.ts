/**
 * WebAuthn feature detection utilities.
 */

/** Check if the browser supports WebAuthn at all */
export function isWebAuthnAvailable(): boolean {
  return !!(globalThis.PublicKeyCredential && navigator.credentials);
}

/** Check if a platform authenticator (TouchID/FaceID/Windows Hello) is available */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
