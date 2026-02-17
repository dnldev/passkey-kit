/**
 * Ready-made Express routes for passkey registration and authentication.
 *
 * @ai_context This is a convenience wrapper. Apps that don't use Express
 * can use PasskeyServer directly. These routes implement the standard
 * challenge-response pattern with proper error handling.
 *
 * Usage:
 *   const routes = createExpressRoutes(passkeyServer, { getUserInfo });
 *   app.use('/api/auth/passkey', routes);
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { PasskeyServer } from './passkey-server.js';
import type { UserInfo } from './types.js';

export interface ExpressRoutesConfig {
  /**
   * Resolve a user ID to UserInfo. Called during registration to get
   * the user's name/displayName for the WebAuthn ceremony.
   * Return null if user not found.
   */
  getUserInfo: (userId: string) => Promise<UserInfo | null>;

  /**
   * Called after successful registration. Use this to update your user
   * record (e.g., mark as activated, store credential reference).
   */
  onRegistrationSuccess?: (userId: string, credentialId: string) => Promise<void>;

  /**
   * Called after successful authentication. Use this to create a session,
   * JWT, or whatever your app uses for auth state.
   * Return an object that will be merged into the response JSON.
   */
  onAuthenticationSuccess?: (userId: string, credentialId: string) => Promise<Record<string, unknown>>;
}

/**
 * Create Express router with passkey registration and authentication routes.
 *
 * Routes:
 *   POST /register/options   — Get registration challenge options
 *   POST /register/verify    — Verify registration response
 *   POST /authenticate/options — Get authentication challenge options
 *   POST /authenticate/verify  — Verify authentication response
 */
export function createExpressRoutes(
  server: PasskeyServer,
  config: ExpressRoutesConfig,
): Router {
  const router = Router();

  /**
   * POST /register/options
   * Body: { userId: string, authenticatorAttachment?: 'platform' | 'cross-platform' }
   */
  router.post('/register/options', async (req: Request, res: Response) => {
    try {
      const { userId, authenticatorAttachment, residentKey, userVerification } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const user = await config.getUserInfo(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const options = await server.generateRegistrationOptions(user, {
        authenticatorAttachment,
        residentKey,
        userVerification,
      });

      res.json(options);
    } catch (err) {
      console.error('[passkey-kit] Registration options error:', err);
      res.status(500).json({ error: 'Failed to generate registration options' });
    }
  });

  /**
   * POST /register/verify
   * Body: { userId: string, response: RegistrationResponseJSON, credentialName?: string }
   */
  router.post('/register/verify', async (req: Request, res: Response) => {
    try {
      const { userId, response, credentialName } = req.body;
      if (!userId || !response) {
        res.status(400).json({ error: 'userId and response are required' });
        return;
      }

      const result = await server.verifyRegistration(userId, response, credentialName);

      if (config.onRegistrationSuccess) {
        await config.onRegistrationSuccess(userId, result.credential.credentialId);
      }

      res.json({
        verified: result.verified,
        credentialId: result.credential.credentialId,
        credentialName: result.credential.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      console.error('[passkey-kit] Registration verify error:', err);
      res.status(400).json({ error: message });
    }
  });

  /**
   * POST /authenticate/options
   * Body: { userId?: string }
   * userId is optional — omit for discoverable credential (resident key) flow
   */
  router.post('/authenticate/options', async (req: Request, res: Response) => {
    try {
      const { userId, userVerification } = req.body;

      const { options, sessionKey } = await server.generateAuthenticationOptions(
        userId,
        { userVerification },
      );

      res.json({ options, sessionKey });
    } catch (err) {
      console.error('[passkey-kit] Authentication options error:', err);
      res.status(500).json({ error: 'Failed to generate authentication options' });
    }
  });

  /**
   * POST /authenticate/verify
   * Body: { sessionKey: string, response: AuthenticationResponseJSON }
   */
  router.post('/authenticate/verify', async (req: Request, res: Response) => {
    try {
      const { sessionKey, response } = req.body;
      if (!sessionKey || !response) {
        res.status(400).json({ error: 'sessionKey and response are required' });
        return;
      }

      const result = await server.verifyAuthentication(sessionKey, response);

      let extra: Record<string, unknown> = {};
      if (config.onAuthenticationSuccess) {
        extra = await config.onAuthenticationSuccess(result.userId, result.credentialId);
      }

      res.json({
        verified: result.verified,
        userId: result.userId,
        credentialId: result.credentialId,
        ...extra,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      console.error('[passkey-kit] Authentication verify error:', err);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
