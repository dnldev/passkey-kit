/**
 * Ambient Web Crypto API types for non-DOM environments (Node.js, Deno, Workers).
 * These are available at runtime in Node 18+ via globalThis.crypto.
 */

/* eslint-disable no-var */
declare var crypto: Crypto;

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}

interface SubtleCrypto {
  encrypt(algorithm: string | AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: string | AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  importKey(
    format: 'raw',
    keyData: BufferSource,
    algorithm: string | HkdfParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  deriveKey(
    algorithm: HkdfParams,
    baseKey: CryptoKey,
    derivedKeyType: AesKeyGenParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
}

interface CryptoKey {
  readonly algorithm: KeyAlgorithm;
  readonly extractable: boolean;
  readonly type: string;
  readonly usages: KeyUsage[];
}

interface KeyAlgorithm {
  name: string;
}

interface AesGcmParams {
  name: 'AES-GCM';
  iv: BufferSource;
  additionalData?: BufferSource;
  tagLength?: number;
}

interface AesKeyGenParams {
  name: string;
  length: number;
}

interface HkdfParams {
  name: 'HKDF';
  hash: string;
  salt: BufferSource;
  info: BufferSource;
}

type KeyUsage = 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits' | 'wrapKey' | 'unwrapKey';
type BufferSource = ArrayBufferView | ArrayBuffer;
