import { describe, it, expect } from 'vitest';
import { sealChallengeToken, openChallengeToken } from '../src/challenge-token';
import type { ChallengeTokenPayload } from '../src/challenge-token';

const SECRET = 'test-secret-key-must-be-long-enough-32chars!!';

describe('challenge-token', () => {
  const basePayload: ChallengeTokenPayload = {
    challenge: 'dGVzdC1jaGFsbGVuZ2U',
    userId: 'user-123',
    type: 'registration',
    exp: Date.now() + 300_000, // 5 min from now
  };

  describe('sealChallengeToken', () => {
    it('returns a non-empty base64url string', () => {
      const token = sealChallengeToken(basePayload, SECRET);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // base64url chars only
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces different tokens for the same payload (unique IV)', () => {
      const t1 = sealChallengeToken(basePayload, SECRET);
      const t2 = sealChallengeToken(basePayload, SECRET);
      expect(t1).not.toBe(t2);
    });
  });

  describe('openChallengeToken', () => {
    it('round-trips a valid payload', () => {
      const token = sealChallengeToken(basePayload, SECRET);
      const result = openChallengeToken(token, SECRET);
      expect(result).toEqual(basePayload);
    });

    it('returns null for wrong secret', () => {
      const token = sealChallengeToken(basePayload, SECRET);
      const result = openChallengeToken(token, 'wrong-secret-key-also-32chars!!!!');
      expect(result).toBeNull();
    });

    it('returns null for expired token', () => {
      const expiredPayload = { ...basePayload, exp: Date.now() - 1000 };
      const token = sealChallengeToken(expiredPayload, SECRET);
      const result = openChallengeToken(token, SECRET);
      expect(result).toBeNull();
    });

    it('returns null for tampered token', () => {
      const token = sealChallengeToken(basePayload, SECRET);
      // Flip a character in the middle
      const chars = token.split('');
      const mid = Math.floor(chars.length / 2);
      chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
      const tampered = chars.join('');
      const result = openChallengeToken(tampered, SECRET);
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(openChallengeToken('', SECRET)).toBeNull();
    });

    it('returns null for garbage input', () => {
      expect(openChallengeToken('not-a-real-token', SECRET)).toBeNull();
    });

    it('preserves optional userId as undefined', () => {
      const noUser = { ...basePayload, userId: undefined };
      const token = sealChallengeToken(noUser, SECRET);
      const result = openChallengeToken(token, SECRET);
      expect(result).not.toBeNull();
      expect(result!.userId).toBeUndefined();
    });

    it('preserves type field accurately', () => {
      const authPayload = { ...basePayload, type: 'authentication' as const };
      const token = sealChallengeToken(authPayload, SECRET);
      const result = openChallengeToken(token, SECRET);
      expect(result!.type).toBe('authentication');
    });
  });
});
