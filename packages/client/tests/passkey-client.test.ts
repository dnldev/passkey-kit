import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PasskeyClient } from '../src/passkey-client';

// Mock @simplewebauthn/browser
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn().mockResolvedValue({
    id: 'new-cred-id',
    rawId: 'new-cred-id',
    type: 'public-key',
    response: {
      clientDataJSON: 'mock-cdj',
      attestationObject: 'mock-ao',
      transports: ['internal'],
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  }),
  startAuthentication: vi.fn().mockResolvedValue({
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: {
      clientDataJSON: 'mock-cdj',
      authenticatorData: 'mock-ad',
      signature: 'mock-sig',
    },
    clientExtensionResults: {},
  }),
}));

describe('PasskeyClient', () => {
  let client: PasskeyClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new PasskeyClient({
      serverUrl: 'https://api.example.com/auth/passkey',
      fetch: mockFetch as any,
    });
  });

  describe('register', () => {
    it('calls register/options then register/verify', async () => {
      // Mock register/options response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge: 'mock-challenge',
            rp: { name: 'Test', id: 'localhost' },
            user: { id: 'uid', name: 'test' },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          }),
        })
        // Mock register/verify response
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verified: true,
            credentialId: 'new-cred-id',
            credentialName: 'My Phone',
          }),
        });

      const result = await client.register('user-1', 'My Phone');

      expect(result.verified).toBe(true);
      expect(result.credentialId).toBe('new-cred-id');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first call was to /register/options
      const [url1] = mockFetch.mock.calls[0];
      expect(url1).toBe('https://api.example.com/auth/passkey/register/options');

      // Verify second call was to /register/verify
      const [url2] = mockFetch.mock.calls[1];
      expect(url2).toBe('https://api.example.com/auth/passkey/register/verify');
    });

    it('passes challengeToken from options to verify', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge: 'mock-challenge',
            challengeToken: 'encrypted-token-abc',
            rp: { name: 'Test', id: 'localhost' },
            user: { id: 'uid', name: 'test' },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ verified: true, credentialId: 'cred-1', credentialName: 'Key' }),
        });

      await client.register('user-1');

      // Verify the challengeToken was sent in the verify body
      const [, verifyInit] = mockFetch.mock.calls[1];
      const verifyBody = JSON.parse(verifyInit.body);
      expect(verifyBody.challengeToken).toBe('encrypted-token-abc');
    });
  });

  describe('authenticate', () => {
    it('calls authenticate/options then authenticate/verify', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            options: {
              challenge: 'mock-auth-challenge',
              rpId: 'localhost',
              allowCredentials: [],
            },
            sessionKey: 'session-key-123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            verified: true,
            userId: 'user-1',
            credentialId: 'cred-1',
            token: 'jwt',
          }),
        });

      const result = await client.authenticate('user-1');

      expect(result.verified).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.token).toBe('jwt');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sends sessionKey in verify body', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            options: { challenge: 'c', rpId: 'localhost', allowCredentials: [] },
            sessionKey: 'my-session-key',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ verified: true, userId: 'u', credentialId: 'c' }),
        });

      await client.authenticate();

      const [, verifyInit] = mockFetch.mock.calls[1];
      const verifyBody = JSON.parse(verifyInit.body);
      expect(verifyBody.sessionKey).toBe('my-session-key');
    });
  });

  describe('error handling', () => {
    it('throws on HTTP error with server error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'User not found' }),
      });

      await expect(client.register('bad-user')).rejects.toThrow('User not found');
    });

    it('throws with HTTP status when no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(client.register('bad-user')).rejects.toThrow('HTTP 500');
    });
  });

  describe('extraBody', () => {
    it('merges extraBody into every request', async () => {
      const clientWithExtra = new PasskeyClient({
        serverUrl: 'https://api.example.com/auth',
        fetch: mockFetch as any,
        extraBody: { rpId: 'myapp.com', rpName: 'My App' },
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge: 'c', rp: { name: 'T', id: 'l' },
            user: { id: 'u', name: 't' }, pubKeyCredParams: [],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ verified: true, credentialId: 'c', credentialName: 'K' }),
        });

      await clientWithExtra.register('user-1');

      // Check that rpId was in the options request body
      const [, optionsInit] = mockFetch.mock.calls[0];
      const optionsBody = JSON.parse(optionsInit.body);
      expect(optionsBody.rpId).toBe('myapp.com');
      expect(optionsBody.rpName).toBe('My App');
    });
  });

  describe('custom headers', () => {
    it('includes custom headers in every request', async () => {
      const clientWithHeaders = new PasskeyClient({
        serverUrl: 'https://api.example.com/auth',
        fetch: mockFetch as any,
        headers: { Authorization: 'Bearer my-token' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'c', rp: { name: 'T', id: 'l' },
          user: { id: 'u', name: 't' }, pubKeyCredParams: [],
        }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verified: true, credentialId: 'c', credentialName: 'K' }),
      });

      await clientWithHeaders.register('user-1');

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer my-token');
    });
  });
});
