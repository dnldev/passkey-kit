import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PasskeyServer } from '../src/passkey-server';
import { MemoryChallengeStore, MemoryCredentialStore } from '../src/stores';
import type { StoredCredential } from '../src/types';

// Mock @simplewebauthn/server
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-reg-challenge-base64url',
    rp: { name: 'TestApp', id: 'localhost' },
    user: { id: 'dXNlci0x', name: 'testuser', displayName: 'Test User' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: {},
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'new-cred-id',
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-auth-challenge-base64url',
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials: [],
    userVerification: 'preferred',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
      credentialID: 'cred-1',
      userVerified: true,
    },
  }),
}));

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    fromBuffer: (buf: Uint8Array) => Buffer.from(buf).toString('base64url'),
    toBuffer: (str: string) => Buffer.from(str, 'base64url'),
  },
}));

describe('PasskeyServer', () => {
  describe('stateful mode (with ChallengeStore)', () => {
    let server: PasskeyServer;
    let challengeStore: MemoryChallengeStore;
    let credentialStore: MemoryCredentialStore;

    beforeEach(() => {
      challengeStore = new MemoryChallengeStore();
      credentialStore = new MemoryCredentialStore();
      server = new PasskeyServer({
        rpName: 'TestApp',
        rpId: 'localhost',
        allowedOrigins: ['http://localhost:3000'],
        challengeStore,
        credentialStore,
      });
    });

    it('generates registration options', async () => {
      const options = await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
        displayName: 'Test User',
      });

      expect(options).toHaveProperty('challenge');
      expect(options).toHaveProperty('rp');
      expect(options.challengeToken).toBeUndefined();
    });

    it('verifies registration', async () => {
      await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
      });

      const result = await server.verifyRegistration(
        'user-1',
        { id: 'new-cred-id', rawId: 'new-cred-id', type: 'public-key', response: { clientDataJSON: '', attestationObject: '' }, clientExtensionResults: {}, authenticatorAttachment: 'platform' } as any,
        'My Phone',
      );

      expect(result.verified).toBe(true);
      expect(result.credential.userId).toBe('user-1');
      expect(result.credential.name).toBe('My Phone');
    });

    it('rejects registration with no stored challenge', async () => {
      await expect(
        server.verifyRegistration('user-1', {} as any),
      ).rejects.toThrow('Challenge not found');
    });

    it('generates authentication options with sessionKey', async () => {
      const { options, sessionKey, challengeToken } = await server.generateAuthenticationOptions('user-1');

      expect(options).toHaveProperty('challenge');
      expect(sessionKey).toBeTruthy();
      expect(challengeToken).toBeUndefined();
    });

    it('verifies authentication', async () => {
      // Seed a credential in the store
      const credential: StoredCredential = {
        credentialId: 'cred-1',
        publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        counter: 0,
        transports: [],
        name: 'Test Key',
        registeredAt: new Date().toISOString(),
        userId: 'user-1',
      };
      await credentialStore.save(credential);

      const { sessionKey } = await server.generateAuthenticationOptions('user-1');

      const result = await server.verifyAuthentication(
        sessionKey,
        { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: '', authenticatorData: '', signature: '' }, clientExtensionResults: {} } as any,
      );

      expect(result.verified).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.newCounter).toBe(1);
    });

    it('rejects authentication with consumed challenge', async () => {
      const credential: StoredCredential = {
        credentialId: 'cred-1',
        publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        counter: 0,
        transports: [],
        name: 'Test Key',
        registeredAt: new Date().toISOString(),
        userId: 'user-1',
      };
      await credentialStore.save(credential);

      const { sessionKey } = await server.generateAuthenticationOptions('user-1');

      // First verify consumes the challenge
      await server.verifyAuthentication(sessionKey, {
        id: 'cred-1', rawId: 'cred-1', type: 'public-key',
        response: { clientDataJSON: '', authenticatorData: '', signature: '' },
        clientExtensionResults: {},
      } as any);

      // Second verify should fail — challenge consumed
      await expect(
        server.verifyAuthentication(sessionKey, {
          id: 'cred-1', rawId: 'cred-1', type: 'public-key',
          response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          clientExtensionResults: {},
        } as any),
      ).rejects.toThrow('Challenge not found');
    });
  });

  describe('stateless mode (with encryptionKey)', () => {
    let server: PasskeyServer;
    let credentialStore: MemoryCredentialStore;
    const ENCRYPTION_KEY = 'test-encryption-key-must-be-long-enough!!';

    beforeEach(() => {
      credentialStore = new MemoryCredentialStore();
      server = new PasskeyServer({
        rpName: 'TestApp',
        rpId: 'localhost',
        allowedOrigins: ['http://localhost:3000'],
        encryptionKey: ENCRYPTION_KEY,
        credentialStore,
      });
    });

    it('generates registration options with challengeToken', async () => {
      const options = await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
      });

      expect(options.challengeToken).toBeTruthy();
      expect(typeof options.challengeToken).toBe('string');
    });

    it('verifies registration with challengeToken', async () => {
      const options = await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
      });

      const result = await server.verifyRegistration(
        'user-1',
        { id: 'new-cred-id', rawId: 'new-cred-id', type: 'public-key', response: { clientDataJSON: '', attestationObject: '' }, clientExtensionResults: {}, authenticatorAttachment: 'platform' } as any,
        'My Phone',
        options.challengeToken,
      );

      expect(result.verified).toBe(true);
    });

    it('rejects registration without challengeToken', async () => {
      await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
      });

      await expect(
        server.verifyRegistration('user-1', {} as any),
      ).rejects.toThrow('challengeToken is required');
    });

    it('rejects registration with wrong userId in token', async () => {
      const options = await server.generateRegistrationOptions({
        id: 'user-1',
        name: 'testuser',
      });

      await expect(
        server.verifyRegistration('user-2', {} as any, undefined, options.challengeToken),
      ).rejects.toThrow('userId mismatch');
    });

    it('generates authentication options with challengeToken as sessionKey', async () => {
      const { sessionKey, challengeToken } = await server.generateAuthenticationOptions('user-1');

      expect(sessionKey).toBeTruthy();
      expect(challengeToken).toBeTruthy();
      // In stateless mode, sessionKey IS the challengeToken
      expect(sessionKey).toBe(challengeToken);
    });

    it('verifies authentication with token sessionKey', async () => {
      const credential: StoredCredential = {
        credentialId: 'cred-1',
        publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        counter: 0,
        transports: [],
        name: 'Test Key',
        registeredAt: new Date().toISOString(),
        userId: 'user-1',
      };
      await credentialStore.save(credential);

      const { sessionKey } = await server.generateAuthenticationOptions('user-1');

      const result = await server.verifyAuthentication(
        sessionKey,
        { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: '', authenticatorData: '', signature: '' }, clientExtensionResults: {} } as any,
      );

      expect(result.verified).toBe(true);
      expect(result.userId).toBe('user-1');
    });
  });

  describe('constructor validation', () => {
    it('throws when neither challengeStore nor encryptionKey provided', () => {
      expect(() => new PasskeyServer({
        rpName: 'Test',
        rpId: 'localhost',
        allowedOrigins: ['http://localhost'],
        credentialStore: new MemoryCredentialStore(),
      })).toThrow('Provide either');
    });

    it('accepts challengeStore without encryptionKey', () => {
      expect(() => new PasskeyServer({
        rpName: 'Test',
        rpId: 'localhost',
        allowedOrigins: ['http://localhost'],
        challengeStore: new MemoryChallengeStore(),
        credentialStore: new MemoryCredentialStore(),
      })).not.toThrow();
    });

    it('accepts encryptionKey without challengeStore', () => {
      expect(() => new PasskeyServer({
        rpName: 'Test',
        rpId: 'localhost',
        allowedOrigins: ['http://localhost'],
        encryptionKey: 'a-long-secret-key-for-testing!!!!',
        credentialStore: new MemoryCredentialStore(),
      })).not.toThrow();
    });
  });
});
