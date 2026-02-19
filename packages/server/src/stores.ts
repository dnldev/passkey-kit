/**
 * Built-in store implementations for common backends.
 *
 * For production with multiple server instances, implement the ChallengeStore
 * and CredentialStore interfaces with a shared backend (Redis, database, etc).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { ChallengeStore, CredentialStore, StoredChallenge, StoredCredential } from './types.js';

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
 * Not suitable for multi-process servers (race conditions on file writes).
 */
export class FileChallengeStore implements ChallengeStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private load(): Record<string, StoredChallenge> {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private persist(data: Record<string, StoredChallenge>): void {
    // Clean expired
    const now = Date.now();
    for (const [key, val] of Object.entries(data)) {
      if (now > val.expiresAt) delete data[key];
    }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  async save(key: string, challenge: StoredChallenge): Promise<void> {
    const data = this.load();
    data[key] = challenge;
    this.persist(data);
  }

  async consume(key: string): Promise<StoredChallenge | null> {
    const data = this.load();
    const challenge = data[key];
    if (!challenge) return null;
    delete data[key];
    this.persist(data);
    if (Date.now() > challenge.expiresAt) return null;
    return challenge;
  }
}

/**
 * File-based credential store. Credentials stored in a JSON array file.
 */
export class FileCredentialStore implements CredentialStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private load(): StoredCredential[] {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private persist(data: StoredCredential[]): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  async save(credential: StoredCredential): Promise<void> {
    const data = this.load();
    data.push(credential);
    this.persist(data);
  }

  async getByUserId(userId: string): Promise<StoredCredential[]> {
    return this.load().filter(c => c.userId === userId);
  }

  async getByCredentialId(credentialId: string): Promise<StoredCredential | null> {
    return this.load().find(c => c.credentialId === credentialId) ?? null;
  }

  async updateCounter(credentialId: string, newCounter: number): Promise<void> {
    const data = this.load();
    const cred = data.find(c => c.credentialId === credentialId);
    if (cred) {
      cred.counter = newCounter;
      this.persist(data);
    }
  }

  async delete(credentialId: string): Promise<void> {
    const data = this.load().filter(c => c.credentialId !== credentialId);
    this.persist(data);
  }
}
