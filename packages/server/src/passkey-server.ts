/**
 * PasskeyServer — core WebAuthn server-side logic.
 *
 * @ai_context All challenge generation and attestation/assertion verification
 * happens here. The client NEVER generates challenges — that's the key security
 * fix over the old insecure pattern.
 *
 * Supports two challenge persistence modes:
 * 1. **Stateless** (default): Challenge is encrypted into a signed token returned
 *    to the client. No server-side state required — works on Vercel, Cloudflare, etc.
 * 2. **Stateful**: Challenge is stored in a ChallengeStore (memory, file, Redis, etc).
 *    Use this when you need server-side challenge revocation.
 *
 * The mode is selected automatically: if `challengeStore` is provided in config,
 * stateful mode is used. Otherwise, `encryptionKey` must be provided for stateless.
 *
 * Flow:
 *   Registration: generateRegistrationOptions → client signs → verifyRegistration
 *   Authentication: generateAuthenticationOptions → client signs → verifyAuthentication
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

import type {
  PasskeyServerConfig,
  StoredCredential,
  RegistrationResult,
  AuthenticationResult,
  UserInfo,
} from './types.js';
import { sealChallengeToken, openChallengeToken } from './challenge-token.js';

const DEFAULT_CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

export class PasskeyServer {
  private rpName: string;
  private rpId: string;
  private allowedOrigins: string[];
  private challengeStore?: PasskeyServerConfig['challengeStore'];
  private credentialStore: PasskeyServerConfig['credentialStore'];
  private challengeTTL: number;
  private encryptionKey?: string;

  constructor(config: PasskeyServerConfig) {
    this.rpName = config.rpName;
    this.rpId = config.rpId;
    this.allowedOrigins = config.allowedOrigins;
    this.challengeStore = config.challengeStore;
    this.credentialStore = config.credentialStore;
    this.challengeTTL = config.challengeTTL ?? DEFAULT_CHALLENGE_TTL;
    this.encryptionKey = config.encryptionKey;

    if (!this.challengeStore && !this.encryptionKey) {
      throw new Error(
        'passkey-kit: Provide either `challengeStore` (stateful) or `encryptionKey` (stateless). ' +
        'For serverless, set encryptionKey to a random 32+ character secret.'
      );
    }
  }

  /**
   * Step 1 of registration: Generate options for the client.
   * Returns PublicKeyCredentialCreationOptions (JSON-serializable)
   * plus a `challengeToken` for stateless verification.
   */
  async generateRegistrationOptions(user: UserInfo, opts?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'required' | 'preferred' | 'discouraged';
    userVerification?: 'required' | 'preferred' | 'discouraged';
  }) {
    const existingCredentials = await this.credentialStore.getByUserId(user.id);

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.name,
      userDisplayName: user.displayName ?? user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existingCredentials.map(c => ({
        id: c.credentialId,
        transports: c.transports,
      })),
      authenticatorSelection: {
        authenticatorAttachment: opts?.authenticatorAttachment,
        residentKey: opts?.residentKey ?? 'preferred',
        userVerification: opts?.userVerification ?? 'preferred',
      },
    });

    let challengeToken: string | undefined;

    if (this.challengeStore) {
      // Stateful: persist challenge in store
      await this.challengeStore.save(user.id, {
        challenge: options.challenge,
        userId: user.id,
        expiresAt: Date.now() + this.challengeTTL,
        type: 'registration',
      });
    } else {
      // Stateless: encrypt challenge into token
      challengeToken = sealChallengeToken({
        challenge: options.challenge,
        userId: user.id,
        type: 'registration',
        exp: Date.now() + this.challengeTTL,
      }, this.encryptionKey!);
    }

    return { ...options, challengeToken };
  }

  /**
   * Step 2 of registration: Verify the client's attestation response.
   *
   * @param userId - User ID
   * @param response - WebAuthn attestation response from the browser
   * @param credentialName - Human-readable name for this credential
   * @param challengeToken - The opaque token from step 1 (stateless mode)
   */
  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    credentialName?: string,
    challengeToken?: string,
  ): Promise<RegistrationResult> {
    let expectedChallenge: string;

    if (this.challengeStore) {
      const storedChallenge = await this.challengeStore.consume(userId);
      if (!storedChallenge) throw new Error('Challenge not found or expired');
      if (storedChallenge.type !== 'registration') throw new Error('Challenge type mismatch');
      if (Date.now() > storedChallenge.expiresAt) throw new Error('Challenge expired');
      expectedChallenge = storedChallenge.challenge;
    } else {
      if (!challengeToken) throw new Error('challengeToken is required in stateless mode');
      const payload = openChallengeToken(challengeToken, this.encryptionKey!);
      if (!payload) throw new Error('Invalid or expired challenge token');
      if (payload.type !== 'registration') throw new Error('Challenge type mismatch');
      if (payload.userId !== userId) throw new Error('Challenge userId mismatch');
      expectedChallenge = payload.challenge;
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.allowedOrigins,
      expectedRPID: this.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Registration verification failed');
    }

    const { credential } = verification.registrationInfo;

    const storedCredential: StoredCredential = {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: (response.response.transports as AuthenticatorTransportFuture[]) ?? [],
      name: credentialName ?? 'Passkey',
      registeredAt: new Date().toISOString(),
      userId,
    };

    await this.credentialStore.save(storedCredential);

    return { credential: storedCredential, verified: true };
  }

  /**
   * Step 1 of authentication: Generate options for the client.
   * If userId is provided, only that user's credentials are allowed.
   * If not provided, uses discoverable credentials (resident keys).
   */
  async generateAuthenticationOptions(userId?: string, opts?: {
    userVerification?: 'required' | 'preferred' | 'discouraged';
  }) {
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

    if (userId) {
      const credentials = await this.credentialStore.getByUserId(userId);
      allowCredentials = credentials.map(c => ({
        id: c.credentialId,
        transports: c.transports,
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials,
      userVerification: opts?.userVerification ?? 'preferred',
    });

    let sessionKey: string;
    let challengeToken: string | undefined;

    if (this.challengeStore) {
      // Stateful: persist challenge
      sessionKey = userId ?? `auth:${options.challenge}`;
      await this.challengeStore.save(sessionKey, {
        challenge: options.challenge,
        userId,
        expiresAt: Date.now() + this.challengeTTL,
        type: 'authentication',
      });
    } else {
      // Stateless: encrypt into token (sessionKey IS the token)
      challengeToken = sealChallengeToken({
        challenge: options.challenge,
        userId,
        type: 'authentication',
        exp: Date.now() + this.challengeTTL,
      }, this.encryptionKey!);
      sessionKey = challengeToken;
    }

    return { options, sessionKey, challengeToken };
  }

  /**
   * Step 2 of authentication: Verify the client's assertion response.
   */
  async verifyAuthentication(
    sessionKey: string,
    response: AuthenticationResponseJSON,
  ): Promise<AuthenticationResult> {
    let expectedChallenge: string;

    if (this.challengeStore) {
      const storedChallenge = await this.challengeStore.consume(sessionKey);
      if (!storedChallenge) throw new Error('Challenge not found or expired');
      if (storedChallenge.type !== 'authentication') throw new Error('Challenge type mismatch');
      if (Date.now() > storedChallenge.expiresAt) throw new Error('Challenge expired');
      expectedChallenge = storedChallenge.challenge;
    } else {
      // In stateless mode, sessionKey IS the challengeToken
      const payload = openChallengeToken(sessionKey, this.encryptionKey!);
      if (!payload) throw new Error('Invalid or expired challenge token');
      if (payload.type !== 'authentication') throw new Error('Challenge type mismatch');
      expectedChallenge = payload.challenge;
    }

    const credentialId = response.id;
    const credential = await this.credentialStore.getByCredentialId(credentialId);
    if (!credential) {
      throw new Error('Credential not found');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.allowedOrigins,
      expectedRPID: this.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: isoBase64URL.toBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    });

    if (!verification.verified) {
      throw new Error('Authentication verification failed');
    }

    const newCounter = verification.authenticationInfo.newCounter;
    await this.credentialStore.updateCounter(credentialId, newCounter);

    return {
      credentialId,
      userId: credential.userId,
      verified: true,
      newCounter,
    };
  }
}
