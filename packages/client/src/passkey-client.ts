/**
 * PasskeyClient — browser-side WebAuthn ceremony handler.
 *
 * @ai_context Wraps @simplewebauthn/browser and handles communication with
 * the server endpoints. The client fetches challenge options from the server,
 * runs the WebAuthn ceremony (browser prompt), and sends the result back
 * for server-side verification.
 *
 * Usage:
 *   const client = new PasskeyClient({ serverUrl: '/api/auth/passkey' });
 *   await client.register(userId, 'My Phone');
 *   await client.authenticate();
 */

import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';

export interface PasskeyClientConfig {
  /**
   * Base URL of the passkey server routes.
   * E.g. '/api/auth/passkey' or 'https://api.example.com/auth/passkey'
   */
  serverUrl: string;

  /**
   * Optional fetch function (e.g. if you need to add auth headers).
   * Defaults to globalThis.fetch.
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Optional headers to include in every request (e.g. Bearer token).
   */
  headers?: Record<string, string>;

  /**
   * Optional extra fields to include in every request body.
   * Useful for multi-app servers that need rpId/rpName per request.
   */
  extraBody?: Record<string, unknown>;
}

export class PasskeyClient {
  private serverUrl: string;
  private fetchFn: typeof globalThis.fetch;
  private headers: Record<string, string>;
  private extraBody: Record<string, unknown>;

  constructor(config: PasskeyClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = config.headers ?? {};
    this.extraBody = config.extraBody ?? {};
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const mergedBody = { ...this.extraBody, ...(body as Record<string, unknown>) };
    const res = await this.fetchFn(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(mergedBody),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Register a new passkey for a user.
   *
   * @param userId - The user ID to register the passkey for
   * @param credentialName - Human-readable name for this credential
   * @param opts - Optional WebAuthn options
   * @returns Registration result from the server
   */
  async register(
    userId: string,
    credentialName?: string,
    opts?: {
      authenticatorAttachment?: 'platform' | 'cross-platform';
      residentKey?: 'required' | 'preferred' | 'discouraged';
      userVerification?: 'required' | 'preferred' | 'discouraged';
    },
  ): Promise<{ verified: boolean; credentialId: string; credentialName: string }> {
    // Step 1: Get registration options from server
    const options = (await this.post('/register/options', {
      userId,
      ...opts,
    })) as Parameters<typeof startRegistration>[0];

    // Step 2: Run WebAuthn ceremony (browser prompt)
    const attestationResponse = await startRegistration(options);

    // Step 3: Send attestation to server for verification
    const result = await this.post('/register/verify', {
      userId,
      response: attestationResponse,
      credentialName,
    });

    return result as { verified: boolean; credentialId: string; credentialName: string };
  }

  /**
   * Authenticate with a passkey.
   *
   * @param userId - Optional user ID (omit for discoverable credential flow)
   * @param opts - Optional WebAuthn options
   * @returns Authentication result from server (includes userId, credentialId, and any extras from onAuthenticationSuccess)
   */
  async authenticate(
    userId?: string,
    opts?: {
      userVerification?: 'required' | 'preferred' | 'discouraged';
    },
  ): Promise<{ verified: boolean; userId: string; credentialId: string; [key: string]: unknown }> {
    // Step 1: Get authentication options from server
    const { options, sessionKey } = (await this.post('/authenticate/options', {
      userId,
      ...opts,
    })) as { options: Parameters<typeof startAuthentication>[0]; sessionKey: string };

    // Step 2: Run WebAuthn ceremony (browser prompt)
    const assertionResponse = await startAuthentication(options);

    // Step 3: Send assertion to server for verification
    const result = await this.post('/authenticate/verify', {
      sessionKey,
      response: assertionResponse,
    });

    return result as { verified: boolean; userId: string; credentialId: string; [key: string]: unknown };
  }
}
