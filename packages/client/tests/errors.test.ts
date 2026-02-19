import { describe, it, expect } from 'vitest';
import { PasskeyError } from '../src/errors';

describe('PasskeyError', () => {
  it('has the correct name', () => {
    const err = new PasskeyError('SERVER_ERROR', 'Something failed', 500);
    expect(err.name).toBe('PasskeyError');
  });

  it('stores code, message, and statusCode', () => {
    const err = new PasskeyError('SERVER_ERROR', 'Not found', 404);
    expect(err.code).toBe('SERVER_ERROR');
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
  });

  it('is an instanceof Error', () => {
    const err = new PasskeyError('UNKNOWN', 'test');
    expect(err).toBeInstanceOf(Error);
  });

  describe('isCancelled', () => {
    it('returns true for USER_CANCELLED', () => {
      const err = new PasskeyError('USER_CANCELLED', 'User closed prompt');
      expect(err.isCancelled).toBe(true);
    });

    it('returns false for other codes', () => {
      expect(new PasskeyError('SERVER_ERROR', 'fail').isCancelled).toBe(false);
      expect(new PasskeyError('NETWORK_ERROR', 'fail').isCancelled).toBe(false);
      expect(new PasskeyError('UNKNOWN', 'fail').isCancelled).toBe(false);
    });
  });

  describe('fromWebAuthnError', () => {
    it('maps NotAllowedError to USER_CANCELLED', () => {
      const domError = new DOMException('Operation cancelled', 'NotAllowedError');
      const err = PasskeyError.fromWebAuthnError(domError);
      expect(err.code).toBe('USER_CANCELLED');
      expect(err.isCancelled).toBe(true);
    });

    it('maps NotSupportedError to NOT_SUPPORTED', () => {
      const domError = new DOMException('Not supported', 'NotSupportedError');
      const err = PasskeyError.fromWebAuthnError(domError);
      expect(err.code).toBe('NOT_SUPPORTED');
    });

    it('maps SecurityError to NOT_SUPPORTED', () => {
      const domError = new DOMException('Security error', 'SecurityError');
      const err = PasskeyError.fromWebAuthnError(domError);
      expect(err.code).toBe('NOT_SUPPORTED');
    });

    it('maps generic Error to UNKNOWN', () => {
      const err = PasskeyError.fromWebAuthnError(new Error('Random error'));
      expect(err.code).toBe('UNKNOWN');
      expect(err.message).toBe('Random error');
    });

    it('handles non-Error values', () => {
      const err = PasskeyError.fromWebAuthnError('string error');
      expect(err.code).toBe('UNKNOWN');
      expect(err.message).toBe('string error');
    });
  });
});
