import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from '../src/password';

describe('password (scrypt)', () => {
  describe('hashPassword', () => {
    it('produces a PHC-format string', async () => {
      const hash = await hashPassword('test-password');
      expect(hash).toMatch(/^\$scrypt\$ln=\d+,r=\d+,p=\d+\$/);
    });

    it('produces different hashes for the same password (unique salt)', async () => {
      const h1 = await hashPassword('same-password');
      const h2 = await hashPassword('same-password');
      expect(h1).not.toBe(h2);
    });

    it('respects custom parameters', async () => {
      const hash = await hashPassword('test', { N: 2 ** 14, r: 8, p: 1 });
      expect(hash).toContain('ln=14');
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      const hash = await hashPassword('correct-password');
      const result = await verifyPassword(hash, 'correct-password');
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await hashPassword('correct-password');
      const result = await verifyPassword(hash, 'wrong-password');
      expect(result).toBe(false);
    });

    it('returns false for invalid hash format', async () => {
      const result = await verifyPassword('not-a-valid-hash', 'password');
      expect(result).toBe(false);
    });

    it('returns false for empty hash', async () => {
      const result = await verifyPassword('', 'password');
      expect(result).toBe(false);
    });
  });

  describe('needsRehash', () => {
    it('returns false when params match defaults', async () => {
      const hash = await hashPassword('test');
      expect(needsRehash(hash)).toBe(false);
    });

    it('returns true when params differ from current', async () => {
      const hash = await hashPassword('test', { N: 2 ** 14 });
      // Default is 2^17, so this hash with 2^14 should need rehash
      expect(needsRehash(hash)).toBe(true);
    });

    it('returns true for invalid hash', () => {
      expect(needsRehash('garbage')).toBe(true);
    });

    it('returns false when custom target params match', async () => {
      const hash = await hashPassword('test', { N: 2 ** 14 });
      expect(needsRehash(hash, { N: 2 ** 14 })).toBe(false);
    });
  });
});
