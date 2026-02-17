/**
 * PasskeyServer — core WebAuthn server-side logic.
 *
 * @ai_context All challenge generation and attestation/assertion verification
 * happens here. The client NEVER generates challenges — that's the key security
 * fix over the old insecure pattern.
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
  ChallengeStore,
  CredentialStore,
  RegistrationResult,
  AuthenticationResult,
  UserInfo,
} from './types';

const DEFAULT_CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

export class PasskeyServer {
  private rpName: string;
  private rpId: string;
  private allowedOrigins: string[];
  private challengeStore: ChallengeStore;
  private credentialStore: CredentialStore;
  private challengeTTL: number;

  constructor(config: PasskeyServerConfig) {
    this.rpName = config.rpName;
    this.rpId = config.rpId;
    this.allowedOrigins = config.allowedOrigins;
    this.challengeStore = config.challengeStore;
    this.credentialStore = config.credentialStore;
    this.challengeTTL = config.challengeTTL ?? DEFAULT_CHALLENGE_TTL;
  }

  /**
   * Step 1 of registration: Generate options for the client.
   * Returns PublicKeyCredentialCreationOptions (JSON-serializable).
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

    // Store challenge for verification
    await this.challengeStore.save(user.id, {
      challenge: options.challenge,
      userId: user.id,
      expiresAt: Date.now() + this.challengeTTL,
      type: 'registration',
    });

    return options;
  }

  /**
   * Step 2 of registration: Verify the client's attestation response.
   * Returns the stored credential on success.
   */
  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    credentialName?: string,
  ): Promise<RegistrationResult> {
    const storedChallenge = await this.challengeStore.consume(userId);
    if (!storedChallenge) {
      throw new Error('Challenge not found or expired');
    }
    if (storedChallenge.type !== 'registration') {
      throw new Error('Challenge type mismatch');
    }
    if (Date.now() > storedChallenge.expiresAt) {
      throw new Error('Challenge expired');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: this.allowedOrigins,
      expectedRPID: this.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Registration verification failed');
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

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

    // Use a session key — for auth, userId may be unknown so use challenge itself
    const sessionKey = userId ?? `auth:${options.challenge}`;
    await this.challengeStore.save(sessionKey, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + this.challengeTTL,
      type: 'authentication',
    });

    // Return sessionKey so client can pass it back during verification
    return { options, sessionKey };
  }

  /**
   * Step 2 of authentication: Verify the client's assertion response.
   */
  async verifyAuthentication(
    sessionKey: string,
    response: AuthenticationResponseJSON,
  ): Promise<AuthenticationResult> {
    const storedChallenge = await this.challengeStore.consume(sessionKey);
    if (!storedChallenge) {
      throw new Error('Challenge not found or expired');
    }
    if (storedChallenge.type !== 'authentication') {
      throw new Error('Challenge type mismatch');
    }
    if (Date.now() > storedChallenge.expiresAt) {
      throw new Error('Challenge expired');
    }

    const credentialId = response.id;
    const credential = await this.credentialStore.getByCredentialId(credentialId);
    if (!credential) {
      throw new Error('Credential not found');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
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
