import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileChallengeStore, FileCredentialStore } from '../src/stores';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StoredCredential, StoredChallenge } from '../src/types';

const TMP_DIR = join(__dirname, '.tmp-test');
const CHALLENGE_FILE = join(TMP_DIR, 'challenges.json');
const CREDENTIAL_FILE = join(TMP_DIR, 'credentials.json');

describe('FileChallengeStore', () => {
  let store: FileChallengeStore;

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    try { unlinkSync(CHALLENGE_FILE); } catch {}
    store = new FileChallengeStore(CHALLENGE_FILE);
  });

  afterEach(() => {
    try { unlinkSync(CHALLENGE_FILE); } catch {}
  });

  const challenge: StoredChallenge = {
    challenge: 'file-test-challenge',
    userId: 'user-file-1',
    expiresAt: Date.now() + 300_000,
    type: 'registration',
  };

  it('save and consume round-trips', async () => {
    await store.save('k1', challenge);
    const result = await store.consume('k1');
    expect(result).toEqual(challenge);
  });

  it('consume returns null for missing key', async () => {
    expect(await store.consume('nonexistent')).toBeNull();
  });

  it('consume deletes the challenge (one-time use)', async () => {
    await store.save('k1', challenge);
    await store.consume('k1');
    expect(await store.consume('k1')).toBeNull();
  });

  it('returns null for expired challenges', async () => {
    const expired: StoredChallenge = {
      ...challenge,
      expiresAt: Date.now() - 1000,
    };
    await store.save('k1', expired);
    expect(await store.consume('k1')).toBeNull();
  });

  it('handles multiple keys', async () => {
    await store.save('k1', challenge);
    const c2 = { ...challenge, challenge: 'second' };
    await store.save('k2', c2);
    expect((await store.consume('k1'))!.challenge).toBe('file-test-challenge');
    expect((await store.consume('k2'))!.challenge).toBe('second');
  });

  it('overwrites existing key', async () => {
    await store.save('k1', challenge);
    const updated = { ...challenge, challenge: 'updated' };
    await store.save('k1', updated);
    expect((await store.consume('k1'))!.challenge).toBe('updated');
  });

  it('creates parent directory if it does not exist', () => {
    const nestedPath = join(TMP_DIR, 'nested', 'deep', 'challenges.json');
    expect(() => new FileChallengeStore(nestedPath)).not.toThrow();
  });

  it('throws on corrupted JSON instead of silently resetting', async () => {
    const { writeFileSync } = await import('fs');
    writeFileSync(CHALLENGE_FILE, '{{not valid json!!!');
    await expect(store.save('k1', challenge)).rejects.toThrow();
  });
});

describe('FileCredentialStore', () => {
  let store: FileCredentialStore;

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    try { unlinkSync(CREDENTIAL_FILE); } catch {}
    store = new FileCredentialStore(CREDENTIAL_FILE);
  });

  afterEach(() => {
    try { unlinkSync(CREDENTIAL_FILE); } catch {}
  });

  const cred: StoredCredential = {
    credentialId: 'file-cred-1',
    publicKey: 'dGVzdC1rZXk',
    counter: 0,
    transports: [],
    name: 'Test Key',
    registeredAt: new Date().toISOString(),
    userId: 'user-file-1',
  };

  it('save and getByCredentialId', async () => {
    await store.save(cred);
    const result = await store.getByCredentialId('file-cred-1');
    expect(result).toEqual(cred);
  });

  it('getByCredentialId returns null for missing', async () => {
    expect(await store.getByCredentialId('nonexistent')).toBeNull();
  });

  it('getByUserId returns all credentials for user', async () => {
    await store.save(cred);
    await store.save({ ...cred, credentialId: 'file-cred-2', name: 'Key 2' });
    const results = await store.getByUserId('user-file-1');
    expect(results).toHaveLength(2);
  });

  it('getByUserId returns empty for unknown user', async () => {
    expect(await store.getByUserId('unknown')).toEqual([]);
  });

  it('updateCounter persists the new value', async () => {
    await store.save(cred);
    await store.updateCounter('file-cred-1', 99);
    const result = await store.getByCredentialId('file-cred-1');
    expect(result!.counter).toBe(99);
  });

  it('delete removes the credential', async () => {
    await store.save(cred);
    await store.delete('file-cred-1');
    expect(await store.getByCredentialId('file-cred-1')).toBeNull();
  });

  it('delete leaves other credentials intact', async () => {
    await store.save(cred);
    await store.save({ ...cred, credentialId: 'file-cred-2' });
    await store.delete('file-cred-1');
    expect(await store.getByCredentialId('file-cred-2')).not.toBeNull();
  });

  it('persists across store instances', async () => {
    await store.save(cred);
    const store2 = new FileCredentialStore(CREDENTIAL_FILE);
    const result = await store2.getByCredentialId('file-cred-1');
    expect(result).toEqual(cred);
  });

  it('throws on corrupted JSON instead of silently resetting', async () => {
    const { writeFileSync } = await import('fs');
    writeFileSync(CREDENTIAL_FILE, 'GARBAGE{{{{');
    await expect(store.getByUserId('user-file-1')).rejects.toThrow();
  });
});
