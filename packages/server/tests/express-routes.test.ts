import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpressRoutes } from '../src/express-routes';
import { PasskeyServer } from '../src/passkey-server';
import { MemoryChallengeStore, MemoryCredentialStore } from '../src/stores';
import type { Request, Response } from 'express';

// Mock @simplewebauthn/server (same as passkey-server tests)
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-challenge',
    rp: { name: 'Test', id: 'localhost' },
    user: { id: 'dXNlci0x', name: 'test', displayName: 'Test' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-auth-challenge',
    rpId: 'localhost',
    allowCredentials: [],
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    fromBuffer: (buf: Uint8Array) => Buffer.from(buf).toString('base64url'),
    toBuffer: (str: string) => Buffer.from(str, 'base64url'),
  },
}));

/**
 * Helper to invoke an Express route handler directly (without starting a server).
 * Finds the matching route on the router's internal stack and calls it.
 */
async function callRoute(
  router: any,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let statusCode = 200;
  let jsonBody: Record<string, unknown> = {};

  const req = {
    method: method.toUpperCase(),
    url: path,
    body,
  } as Request;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      jsonBody = data;
    },
  } as unknown as Response;

  // Find the matching route handler in the router stack
  const layer = router.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods[method.toLowerCase()],
  );

  if (!layer) throw new Error(`No route found: ${method} ${path}`);

  // Call the handler (last in the stack)
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await handler(req, res);

  return { status: statusCode, json: jsonBody };
}

describe('createExpressRoutes', () => {
  let router: any;
  let credentialStore: MemoryCredentialStore;

  beforeEach(() => {
    credentialStore = new MemoryCredentialStore();
    const server = new PasskeyServer({
      rpName: 'Test',
      rpId: 'localhost',
      allowedOrigins: ['http://localhost:3000'],
      challengeStore: new MemoryChallengeStore(),
      credentialStore,
    });

    router = createExpressRoutes(server, {
      getUserInfo: async (userId: string) => {
        if (userId === 'user-1') {
          return { id: 'user-1', name: 'testuser', displayName: 'Test User' };
        }
        return null;
      },
      onAuthenticationSuccess: async (userId, credentialId) => ({
        token: 'jwt-token-here',
      }),
    });
  });

  describe('POST /register/options', () => {
    it('returns options for valid user', async () => {
      const { status, json } = await callRoute(router, 'POST', '/register/options', {
        userId: 'user-1',
      });
      expect(status).toBe(200);
      expect(json).toHaveProperty('challenge');
    });

    it('returns 400 when userId missing', async () => {
      const { status, json } = await callRoute(router, 'POST', '/register/options', {});
      expect(status).toBe(400);
      expect(json).toHaveProperty('error');
    });

    it('returns 404 for unknown user', async () => {
      const { status, json } = await callRoute(router, 'POST', '/register/options', {
        userId: 'unknown',
      });
      expect(status).toBe(404);
    });
  });

  describe('POST /register/verify', () => {
    it('returns 400 when userId or response missing', async () => {
      const { status } = await callRoute(router, 'POST', '/register/verify', {});
      expect(status).toBe(400);
    });
  });

  describe('POST /authenticate/options', () => {
    it('returns options and sessionKey', async () => {
      const { status, json } = await callRoute(router, 'POST', '/authenticate/options', {});
      expect(status).toBe(200);
      expect(json).toHaveProperty('options');
      expect(json).toHaveProperty('sessionKey');
    });
  });

  describe('POST /authenticate/verify', () => {
    it('returns 400 when sessionKey or response missing', async () => {
      const { status } = await callRoute(router, 'POST', '/authenticate/verify', {});
      expect(status).toBe(400);
    });
  });
});
