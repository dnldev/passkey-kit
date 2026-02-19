import { describe, it, expect } from 'vitest';

// These functions run in browser context but we can test their logic
// by importing them directly (they use globalThis checks)
describe('detect (feature detection)', () => {
  it('exports isWebAuthnAvailable', async () => {
    const mod = await import('../src/detect');
    expect(typeof mod.isWebAuthnAvailable).toBe('function');
  });

  it('isWebAuthnAvailable returns false in Node.js (no PublicKeyCredential)', async () => {
    const { isWebAuthnAvailable } = await import('../src/detect');
    expect(isWebAuthnAvailable()).toBe(false);
  });

  it('isPlatformAuthenticatorAvailable returns false in Node.js', async () => {
    const { isPlatformAuthenticatorAvailable } = await import('../src/detect');
    expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  });
});
