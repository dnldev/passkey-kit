import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpressRoutes } from '../src/express-routes';
import { PasskeyServer } from '../src/passkey-server';
import { MemoryChallengeStore, MemoryCredentialStore } from '../src/stores';
import type { Request, Response } from 'express';
import type { StoredCredential } from '../src/types';

// Mock @simplewebauthn/server
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

async function callRoute(
  router: any,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let statusCode = 200;
  let jsonBody: Record<string, unknown> = {};

  const req = { method: method.toUpperCase(), url: path, body } as Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(data: Record<string, unknown>) { jsonBody = data; },
  } as unknown as Response;

  const layer = router.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods[method.toLowerCase()],
  );
  if (!layer) throw new Error(`No route found: ${method} ${path}`);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await handler(req, res);
  return { status: statusCode, json: jsonBody };
}

describe('Express routes — full registration + authentication flow', () => {
  let router: any;
  let credentialStore: MemoryCredentialStore;
  let onRegSuccess: ReturnType<typeof vi.fn>;
  let onAuthSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    credentialStore = new MemoryCredentialStore();
    onRegSuccess = vi.fn();
    onAuthSuccess = vi.fn().mockResolvedValue({ token: 'jwt-abc' });

    const server = new PasskeyServer({
      rpName: 'Test',
      rpId: 'localhost',
      allowedOrigins: ['http://localhost:3000'],
      challengeStore: new MemoryChallengeStore(),
      credentialStore,
    });

    router = createExpressRoutes(server, {
      getUserInfo: async (userId: string) => {
        if (userId === 'user-1') return { id: 'user-1', name: 'testuser', displayName: 'Test User' };
        return null;
      },
      onRegistrationSuccess: onRegSuccess,
      onAuthenticationSuccess: onAuthSuccess,
    });
  });

  it('full registration flow calls onRegistrationSuccess', async () => {
    // Step 1: Get options
    const { status: s1, json: opts } = await callRoute(router, 'POST', '/register/options', {
      userId: 'user-1',
    });
    expect(s1).toBe(200);
    expect(opts.challenge).toBeTruthy();

    // Step 2: Verify
    const { status: s2, json: result } = await callRoute(router, 'POST', '/register/verify', {
      userId: 'user-1',
      response: {
        id: 'cred-1', rawId: 'cred-1', type: 'public-key',
        response: { clientDataJSON: '', attestationObject: '' },
        clientExtensionResults: {},
      },
      credentialName: 'My Phone',
    });

    expect(s2).toBe(200);
    expect(result.verified).toBe(true);
    expect(onRegSuccess).toHaveBeenCalledWith('user-1', 'cred-1');
  });

  it('full authentication flow calls onAuthenticationSuccess and merges result', async () => {
    // Seed a credential
    await credentialStore.save({
      credentialId: 'cred-1',
      publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
      counter: 0,
      transports: [],
      name: 'Test Key',
      registeredAt: new Date().toISOString(),
      userId: 'user-1',
    });

    // Step 1: Options
    const { json: opts } = await callRoute(router, 'POST', '/authenticate/options', { userId: 'user-1' });
    expect(opts.sessionKey).toBeTruthy();

    // Step 2: Verify
    const { status, json: result } = await callRoute(router, 'POST', '/authenticate/verify', {
      sessionKey: opts.sessionKey as string,
      response: {
        id: 'cred-1', rawId: 'cred-1', type: 'public-key',
        response: { clientDataJSON: '', authenticatorData: '', signature: '' },
        clientExtensionResults: {},
      },
    });

    expect(status).toBe(200);
    expect(result.verified).toBe(true);
    expect(result.token).toBe('jwt-abc');
    expect(onAuthSuccess).toHaveBeenCalledWith('user-1', 'cred-1');
  });

  it('register/options with authenticatorAttachment passes through', async () => {
    const { status, json } = await callRoute(router, 'POST', '/register/options', {
      userId: 'user-1',
      authenticatorAttachment: 'platform',
    });
    expect(status).toBe(200);
  });

  it('authenticate/options works without userId (discoverable flow)', async () => {
    const { status, json } = await callRoute(router, 'POST', '/authenticate/options', {});
    expect(status).toBe(200);
    expect(json.sessionKey).toBeTruthy();
  });
});
