import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryChallengeStore, MemoryCredentialStore } from '../src/stores';
import type { StoredCredential, StoredChallenge } from '../src/types';

describe('MemoryChallengeStore', () => {
  let store: MemoryChallengeStore;

  beforeEach(() => {
    store = new MemoryChallengeStore();
  });

  const challenge: StoredChallenge = {
    challenge: 'test-challenge',
    userId: 'user-1',
    expiresAt: Date.now() + 300_000,
    type: 'registration',
  };

  it('save and consume returns the challenge', async () => {
    await store.save('key1', challenge);
    const result = await store.consume('key1');
    expect(result).toEqual(challenge);
  });

  it('consume returns null for missing key', async () => {
    const result = await store.consume('nonexistent');
    expect(result).toBeNull();
  });

  it('consume deletes the challenge (one-time use)', async () => {
    await store.save('key1', challenge);
    await store.consume('key1');
    const second = await store.consume('key1');
    expect(second).toBeNull();
  });

  it('overwrite existing key', async () => {
    await store.save('key1', challenge);
    const newChallenge = { ...challenge, challenge: 'updated' };
    await store.save('key1', newChallenge);
    const result = await store.consume('key1');
    expect(result!.challenge).toBe('updated');
  });
  it('expired challenge returns null on consume', async () => {
    const expired: StoredChallenge = {
      ...challenge,
      expiresAt: Date.now() - 1000,
    };
    await store.save('key-exp', expired);
    const result = await store.consume('key-exp');
    expect(result).toBeNull();
  });
});

describe('MemoryCredentialStore', () => {
  let store: MemoryCredentialStore;

  beforeEach(() => {
    store = new MemoryCredentialStore();
  });

  const cred: StoredCredential = {
    credentialId: 'cred-1',
    publicKey: 'dGVzdC1rZXk',
    counter: 0,
    transports: [],
    name: 'Test Key',
    registeredAt: new Date().toISOString(),
    userId: 'user-1',
  };

  it('save and getByCredentialId', async () => {
    await store.save(cred);
    const result = await store.getByCredentialId('cred-1');
    expect(result).toEqual(cred);
  });

  it('getByCredentialId returns null for missing', async () => {
    const result = await store.getByCredentialId('nonexistent');
    expect(result).toBeNull();
  });

  it('getByUserId returns all credentials for a user', async () => {
    await store.save(cred);
    const cred2 = { ...cred, credentialId: 'cred-2', name: 'Key 2' };
    await store.save(cred2);
    const results = await store.getByUserId('user-1');
    expect(results).toHaveLength(2);
  });

  it('getByUserId returns empty array for unknown user', async () => {
    const results = await store.getByUserId('unknown');
    expect(results).toEqual([]);
  });

  it('updateCounter updates the credential counter', async () => {
    await store.save(cred);
    await store.updateCounter('cred-1', 42);
    const result = await store.getByCredentialId('cred-1');
    expect(result!.counter).toBe(42);
  });

  it('delete removes the credential', async () => {
    await store.save(cred);
    await store.delete('cred-1');
    const result = await store.getByCredentialId('cred-1');
    expect(result).toBeNull();
  });

  it('delete only removes the targeted credential', async () => {
    await store.save(cred);
    const cred2 = { ...cred, credentialId: 'cred-2' };
    await store.save(cred2);
    await store.delete('cred-1');
    expect(await store.getByCredentialId('cred-2')).not.toBeNull();
    expect(await store.getByUserId('user-1')).toHaveLength(1);
  });

  it('updateCounter does nothing for missing credential', async () => {
    await store.updateCounter('nonexistent', 99);
    // No error thrown
  });

  it('getByUserId isolates users', async () => {
    await store.save(cred);
    const cred2 = { ...cred, credentialId: 'cred-2', userId: 'user-2' };
    await store.save(cred2);
    expect(await store.getByUserId('user-1')).toHaveLength(1);
    expect(await store.getByUserId('user-2')).toHaveLength(1);
  });
});
