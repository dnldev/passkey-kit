import { describe, it, expect } from 'vitest';
import { sealChallengeToken, openChallengeToken } from '../src/challenge-token';
import type { ChallengeTokenPayload } from '../src/challenge-token';

const SECRET = 'test-secret-key-must-be-long-enough-32chars!!';
const SECRET2 = 'rotated-key-that-is-also-long-enough-32chars!!';

describe('challenge-token', () => {
  const basePayload: ChallengeTokenPayload = {
    challenge: 'dGVzdC1jaGFsbGVuZ2U',
    userId: 'user-123',
    type: 'registration',
    exp: Date.now() + 300_000, // 5 min from now
  };

  describe('sealChallengeToken', () => {
    it('returns a non-empty base64url string', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // base64url chars only
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces different tokens for the same payload (unique IV)', async () => {
      const t1 = await sealChallengeToken(basePayload, SECRET);
      const t2 = await sealChallengeToken(basePayload, SECRET);
      expect(t1).not.toBe(t2);
    });
  });

  describe('openChallengeToken', () => {
    it('round-trips a valid payload', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result).toEqual(basePayload);
    });

    it('returns null for wrong secret', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      const result = await openChallengeToken(token, 'wrong-secret-key-also-32chars!!!!');
      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      const expiredPayload = { ...basePayload, exp: Date.now() - 1000 };
      const token = await sealChallengeToken(expiredPayload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result).toBeNull();
    });

    it('returns null for tampered token', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      // Flip a character in the middle
      const chars = token.split('');
      const mid = Math.floor(chars.length / 2);
      chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
      const tampered = chars.join('');
      const result = await openChallengeToken(tampered, SECRET);
      expect(result).toBeNull();
    });

    it('returns null for empty string', async () => {
      expect(await openChallengeToken('', SECRET)).toBeNull();
    });

    it('returns null for garbage input', async () => {
      expect(await openChallengeToken('not-a-real-token', SECRET)).toBeNull();
    });

    it('preserves optional userId as undefined', async () => {
      const noUser = { ...basePayload, userId: undefined };
      const token = await sealChallengeToken(noUser, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result).not.toBeNull();
      expect(result!.userId).toBeUndefined();
    });

    it('preserves type field accurately', async () => {
      const authPayload = { ...basePayload, type: 'authentication' as const };
      const token = await sealChallengeToken(authPayload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result!.type).toBe('authentication');
    });
  });

  describe('key rotation', () => {
    it('decrypts with the current key (first in array)', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      const result = await openChallengeToken(token, [SECRET, SECRET2]);
      expect(result).toEqual(basePayload);
    });

    it('decrypts with a rotated key (second in array)', async () => {
      // Token was sealed with old key
      const token = await sealChallengeToken(basePayload, SECRET2);
      // New primary key is SECRET, but SECRET2 is still accepted
      const result = await openChallengeToken(token, [SECRET, SECRET2]);
      expect(result).toEqual(basePayload);
    });

    it('returns null if no key matches', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      const result = await openChallengeToken(token, ['wrong-key-1-long-enough!!!!!!!!!!', 'wrong-key-2-long-enough!!!!!!!!!!']);
      expect(result).toBeNull();
    });

    it('single string key still works', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result).toEqual(basePayload);
    });
  });

  describe('edge cases', () => {
    it('handles very long challenge strings', async () => {
      const longChallenge = 'a'.repeat(10000);
      const payload = { ...basePayload, challenge: longChallenge };
      const token = await sealChallengeToken(payload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result!.challenge).toBe(longChallenge);
    });

    it('handles unicode in userId', async () => {
      const payload = { ...basePayload, userId: '用户-ñoño-🔑' };
      const token = await sealChallengeToken(payload, SECRET);
      const result = await openChallengeToken(token, SECRET);
      expect(result!.userId).toBe('用户-ñoño-🔑');
    });

    it('returns null for truncated token', async () => {
      const token = await sealChallengeToken(basePayload, SECRET);
      expect(await openChallengeToken(token.slice(0, 10), SECRET)).toBeNull();
    });

    it('handles expiry at exact boundary', async () => {
      const payload = { ...basePayload, exp: Date.now() + 50 };
      const token = await sealChallengeToken(payload, SECRET);
      // Should still be valid right away
      expect(await openChallengeToken(token, SECRET)).not.toBeNull();
    });

    it('works with minimum-length secret', async () => {
      const shortSecret = 'a';
      const token = await sealChallengeToken(basePayload, shortSecret);
      expect(await openChallengeToken(token, shortSecret)).toEqual(basePayload);
    });
  });
});
