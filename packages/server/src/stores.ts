/**
 * Built-in store implementations for common backends.
 *
 * For production with multiple server instances, implement the ChallengeStore
 * and CredentialStore interfaces with a shared backend (Redis, database, etc).
 */

import { readFile, writeFile } from 'fs/promises';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { ChallengeStore, CredentialStore, StoredChallenge, StoredCredential } from './types.js';

// ============================================================
// Async Mutex — serializes read-modify-write file operations
// ============================================================

/**
 * @ai_context Prevents async interleaving of read-modify-write file operations
 * without blocking the Node.js event loop.
 *
 * Each file store instance owns its own AsyncMutex. When a method acquires the
 * lock, all other callers queue behind it until the holder releases. This turns
 * concurrent `load() → mutate → persist()` sequences into a serial pipeline,
 * eliminating the lost-update race condition.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the lock directly to the next waiter (stays locked)
      next();
    } else {
      this.locked = false;
    }
  }
}

// ============================================================
// In-Memory Stores (good for development and single-process)
// ============================================================

export class MemoryChallengeStore implements ChallengeStore {
  private challenges = new Map<string, StoredChallenge>();

  async save(key: string, challenge: StoredChallenge): Promise<void> {
    this.challenges.set(key, challenge);
    // Auto-cleanup expired challenges
    setTimeout(() => this.challenges.delete(key), challenge.expiresAt - Date.now());
  }

  async consume(key: string): Promise<StoredChallenge | null> {
    const challenge = this.challenges.get(key);
    if (!challenge) return null;
    this.challenges.delete(key);
    if (Date.now() > challenge.expiresAt) return null;
    return challenge;
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private credentials: StoredCredential[] = [];

  async save(credential: StoredCredential): Promise<void> {
    this.credentials.push(credential);
  }

  async getByUserId(userId: string): Promise<StoredCredential[]> {
    return this.credentials.filter(c => c.userId === userId);
  }

  async getByCredentialId(credentialId: string): Promise<StoredCredential | null> {
    return this.credentials.find(c => c.credentialId === credentialId) ?? null;
  }

  async updateCounter(credentialId: string, newCounter: number): Promise<void> {
    const cred = this.credentials.find(c => c.credentialId === credentialId);
    if (cred) (cred as { counter: number }).counter = newCounter;
  }

  async delete(credentialId: string): Promise<void> {
    this.credentials = this.credentials.filter(c => c.credentialId !== credentialId);
  }
}

// ============================================================
// File-Based Stores (good for single-server, persistent)
// ============================================================

/**
 * File-based challenge store. Challenges are stored in a JSON file.
 * Auto-cleans expired challenges on every operation.
 *
 * Uses an internal async mutex to serialize concurrent read-modify-write
 * operations within the same process. Not suitable for multi-process servers.
 */
export class FileChallengeStore implements ChallengeStore {
  private filePath: string;
  private mutex = new AsyncMutex();

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private async load(): Promise<Record<string, StoredChallenge>> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err: any) {
      // File not yet created — valid initial state
      if (err?.code === 'ENOENT') return {};
      // Anything else (permission denied, corrupted JSON) must surface
      throw err;
    }
  }

  private async persist(data: Record<string, StoredChallenge>): Promise<void> {
    const now = Date.now();
    for (const [key, val] of Object.entries(data)) {
      if (now > val.expiresAt) delete data[key];
    }
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  async save(key: string, challenge: StoredChallenge): Promise<void> {
    await this.mutex.acquire();
    try {
      const data = await this.load();
      data[key] = challenge;
      await this.persist(data);
    } finally {
      this.mutex.release();
    }
  }

  async consume(key: string): Promise<StoredChallenge | null> {
    await this.mutex.acquire();
    try {
      const data = await this.load();
      const challenge = data[key];
      if (!challenge) return null;
      delete data[key];
      await this.persist(data);
      if (Date.now() > challenge.expiresAt) return null;
      return challenge;
    } finally {
      this.mutex.release();
    }
  }
}

/**
 * File-based credential store. Credentials stored in a JSON array file.
 *
 * Uses an internal async mutex to serialize concurrent read-modify-write
 * operations within the same process. Read-only operations (getByUserId,
 * getByCredentialId) also acquire the lock to prevent reading a
 * partially-written file from a concurrent persist().
 */
export class FileCredentialStore implements CredentialStore {
  private filePath: string;
  private mutex = new AsyncMutex();

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private async load(): Promise<StoredCredential[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  }

  private async persist(data: StoredCredential[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  async save(credential: StoredCredential): Promise<void> {
    await this.mutex.acquire();
    try {
      const data = await this.load();
      data.push(credential);
      await this.persist(data);
    } finally {
      this.mutex.release();
    }
  }

  async getByUserId(userId: string): Promise<StoredCredential[]> {
    await this.mutex.acquire();
    try {
      return (await this.load()).filter(c => c.userId === userId);
    } finally {
      this.mutex.release();
    }
  }

  async getByCredentialId(credentialId: string): Promise<StoredCredential | null> {
    await this.mutex.acquire();
    try {
      return (await this.load()).find(c => c.credentialId === credentialId) ?? null;
    } finally {
      this.mutex.release();
    }
  }

  async updateCounter(credentialId: string, newCounter: number): Promise<void> {
    await this.mutex.acquire();
    try {
      const data = await this.load();
      const cred = data.find(c => c.credentialId === credentialId);
      if (cred) {
        cred.counter = newCounter;
        await this.persist(data);
      }
    } finally {
      this.mutex.release();
    }
  }

  async delete(credentialId: string): Promise<void> {
    await this.mutex.acquire();
    try {
      const data = (await this.load()).filter(c => c.credentialId !== credentialId);
      await this.persist(data);
    } finally {
      this.mutex.release();
    }
  }
}
