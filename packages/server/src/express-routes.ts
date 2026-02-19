/**
 * Ready-made Express routes for passkey registration and authentication.
 *
 * @ai_context This is a convenience wrapper. Apps that don't use Express
 * can use PasskeyServer directly. These routes implement the standard
 * challenge-response pattern with proper error handling and Zod validation.
 *
 * Usage:
 *   const routes = createExpressRoutes(passkeyServer, { getUserInfo });
 *   app.use('/api/auth/passkey', routes);
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PasskeyServer } from './passkey-server.js';
import type { UserInfo } from './types.js';

// ============================================================
// Zod Schemas — strict input validation for every route
// ============================================================

const registerOptionsSchema = z.object({
  userId: z.string().min(1),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  residentKey: z.enum(['required', 'preferred', 'discouraged']).optional(),
  userVerification: z.enum(['required', 'preferred', 'discouraged']).optional(),
}).strict();

const registerVerifySchema = z.object({
  userId: z.string().min(1),
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.record(z.string(), z.unknown()),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    authenticatorAttachment: z.string().optional(),
  }).passthrough(),
  credentialName: z.string().optional(),
  challengeToken: z.string().optional(),
}).strict();

const authenticateOptionsSchema = z.object({
  userId: z.string().min(1).optional(),
  userVerification: z.enum(['required', 'preferred', 'discouraged']).optional(),
}).strict();

const authenticateVerifySchema = z.object({
  sessionKey: z.string().min(1),
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.record(z.string(), z.unknown()),
    clientExtensionResults: z.record(z.string(), z.unknown()),
  }).passthrough(),
}).strict();

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

  router.post('/register/options', async (req: Request, res: Response) => {
    try {
      const parsed = registerOptionsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { userId, authenticatorAttachment, residentKey, userVerification } = parsed.data;

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

  router.post('/register/verify', async (req: Request, res: Response) => {
    try {
      const parsed = registerVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { userId, response, credentialName, challengeToken } = parsed.data;

      const result = await server.verifyRegistration(userId, response as any, credentialName, challengeToken);

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

  router.post('/authenticate/options', async (req: Request, res: Response) => {
    try {
      const parsed = authenticateOptionsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { userId, userVerification } = parsed.data;

      const { options, sessionKey, challengeToken } = await server.generateAuthenticationOptions(
        userId,
        { userVerification },
      );

      res.json({ options, sessionKey, challengeToken });
    } catch (err) {
      console.error('[passkey-kit] Authentication options error:', err);
      res.status(500).json({ error: 'Failed to generate authentication options' });
    }
  });

  router.post('/authenticate/verify', async (req: Request, res: Response) => {
    try {
      const parsed = authenticateVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
        return;
      }
      const { sessionKey, response } = parsed.data;

      const result = await server.verifyAuthentication(sessionKey, response as any);

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
