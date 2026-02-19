# @passkeykit/server

Server-side WebAuthn passkey verification — **stateless by default**. Works on Vercel, Cloudflare Workers, and traditional servers. Zero native dependencies.

Handles challenge generation, attestation/assertion verification, and includes scrypt password hashing (pure JS). Optional argon2 support via subpath export.

[![npm](https://img.shields.io/npm/v/@passkeykit/server)](https://www.npmjs.com/package/@passkeykit/server)
[![license](https://img.shields.io/npm/l/@passkeykit/server)](https://github.com/dnldev/passkey-kit/blob/main/LICENSE)

## Install

```bash
npm install @passkeykit/server @simplewebauthn/server
```

> `@simplewebauthn/server` is a **peer dependency** — you control the version. This keeps the package itself lightweight while giving you full WebAuthn verification.
>
> **Password-only?** If you only need `hashPassword` / `verifyPassword`, import from the subpath — no WebAuthn dependency required:
> ```bash
> npm install @passkeykit/server
> ```
> ```typescript
> import { hashPassword, verifyPassword } from '@passkeykit/server/password';
> ```

## Quick Start

### Stateless (Serverless / Vercel / Cloudflare)

No database needed for challenges — they're encrypted into signed tokens.

```typescript
import { PasskeyServer, FileCredentialStore } from '@passkeykit/server';
import { createExpressRoutes } from '@passkeykit/server/express';

const server = new PasskeyServer({
  rpName: 'My App',
  rpId: 'myapp.example.com',
  allowedOrigins: ['https://myapp.example.com'],
  encryptionKey: process.env.PASSKEY_SECRET!, // 32+ char secret
  credentialStore: new FileCredentialStore('./data/credentials.json'),
});

// Mount ready-made Express routes
app.use('/api/auth/passkey', createExpressRoutes(server, {
  getUserInfo: async (userId) => {
    const user = await db.getUser(userId);
    return user ? { id: user.id, name: user.name } : null;
  },
  onAuthenticationSuccess: async (userId) => {
    return { token: generateSessionToken() };
  },
}));
```

### Stateful (Traditional Server)

Use a challenge store if you need server-side challenge revocation.

```typescript
import { PasskeyServer, MemoryChallengeStore, FileCredentialStore } from '@passkeykit/server';

const server = new PasskeyServer({
  rpName: 'My App',
  rpId: 'myapp.example.com',
  allowedOrigins: ['https://myapp.example.com'],
  challengeStore: new MemoryChallengeStore(),
  credentialStore: new FileCredentialStore('./data/credentials.json'),
});
```

### Direct API (without Express)

```typescript
// Registration
const regOptions = await server.generateRegistrationOptions(userId, userName);
// → send regOptions to client, client runs WebAuthn ceremony
const regResult = await server.verifyRegistration(attestationResponse, challengeToken);

// Authentication
const authOptions = await server.generateAuthenticationOptions();
// → send authOptions + sessionKey to client
const authResult = await server.verifyAuthentication(assertionResponse, sessionKey);
```

## Architecture

```
Client                            Server
  │                                  │
  │── POST /register/options ──────▶│ Generate challenge
  │◀── { options, challengeToken } ──│ Seal into AES-256-GCM token
  │                                  │
  │── WebAuthn ceremony (browser) ──│
  │                                  │
  │── POST /register/verify ───────▶│ Open token, verify attestation
  │   { response, challengeToken }   │ No DB lookup needed
  │◀── { verified: true } ──────────│
```

In **stateless mode**, the `challengeToken` is an encrypted, signed, expiring token. The server needs only the secret key — zero state.

In **stateful mode**, challenges are stored in your `ChallengeStore` and consumed on verification.

## Express Routes

Mount a complete passkey API with one line:

```typescript
import { createExpressRoutes } from '@passkeykit/server/express';

const routes = createExpressRoutes(server, {
  getUserInfo: async (userId) => ({ id: userId, name: 'User' }),
  onRegistrationSuccess: async (userId, credentialId) => {
    console.log(`User ${userId} registered passkey ${credentialId}`);
  },
  onAuthenticationSuccess: async (userId) => {
    return { sessionToken: createSession(userId) };
  },
});

app.use('/api/auth/passkey', routes);
```

**Routes created:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register/options` | Get registration options + challenge |
| POST | `/register/verify` | Verify attestation response |
| POST | `/authenticate/options` | Get authentication options + challenge |
| POST | `/authenticate/verify` | Verify assertion response |
| GET | `/credentials/:userId` | List user's credentials |
| DELETE | `/credentials/:credentialId` | Delete a credential |

## Password Hashing

Built-in scrypt hashing — pure JS, works everywhere (no native bindings):

```typescript
import { hashPassword, verifyPassword, needsRehash } from '@passkeykit/server';

const hash = await hashPassword('my-passphrase');
// → $scrypt$ln=17,r=8,p=1$<salt>$<hash>

const valid = await verifyPassword(hash, 'my-passphrase'); // true

// Check if params have been upgraded since this hash was created
if (needsRehash(hash)) {
  const newHash = await hashPassword('my-passphrase');
  await db.updateHash(userId, newHash);
}
```

### argon2 (optional)

For native argon2id hashing, install `argon2` as a peer dependency:

```bash
npm install argon2
```

```typescript
import { hashPassword, verifyPassword } from '@passkeykit/server/argon2';

const hash = await hashPassword('my-passphrase');
// → $argon2id$v=19$m=65536,t=3,p=4$...
```

## Storage Backends

### Built-in Stores

| Store | Use Case |
|-------|----------|
| `MemoryChallengeStore` | Development / testing |
| `MemoryCredentialStore` | Development / testing |
| `FileChallengeStore` | Single-server deployments |
| `FileCredentialStore` | Single-server deployments |

### Custom Stores

Implement the `ChallengeStore` and/or `CredentialStore` interfaces for your backend:

```typescript
import type { CredentialStore, StoredCredential } from '@passkeykit/server';

class FirestoreCredentialStore implements CredentialStore {
  async save(credential: StoredCredential) { /* ... */ }
  async getByUserId(userId: string) { /* ... */ }
  async getByCredentialId(credentialId: string) { /* ... */ }
  async updateCounter(credentialId: string, newCounter: number) { /* ... */ }
  async delete(credentialId: string) { /* ... */ }
}
```

```typescript
import type { ChallengeStore, StoredChallenge } from '@passkeykit/server';

class RedisChallengeStore implements ChallengeStore {
  async save(key: string, challenge: StoredChallenge) { /* ... */ }
  async consume(key: string) { /* ... */ }
}
```

In **stateless mode**, you don't need a `ChallengeStore` at all — just set `encryptionKey`.

## Configuration

```typescript
interface PasskeyServerConfig {
  rpName: string;           // Shown to users during WebAuthn ceremony
  rpId: string;             // Must match the domain (e.g. 'example.com')
  allowedOrigins: string[]; // e.g. ['https://example.com']
  credentialStore: CredentialStore;

  // Stateless mode (default — pick one):
  encryptionKey?: string;   // 32+ char secret for AES-256-GCM challenge tokens

  // Stateful mode (alternative):
  challengeStore?: ChallengeStore;

  // Optional:
  challengeTTL?: number;    // Challenge expiry in ms (default: 5 minutes)
}
```

## Exports

| Import Path | Contents | Requires |
|-------------|----------|----------|
| `@passkeykit/server` | `PasskeyServer`, stores, password hashing, types | `@simplewebauthn/server` |
| `@passkeykit/server/password` | `hashPassword()`, `verifyPassword()`, `needsRehash()` — scrypt | None (pure JS) |
| `@passkeykit/server/express` | `createExpressRoutes()` — ready-made Express router | `express` |
| `@passkeykit/server/argon2` | `hashPassword()`, `verifyPassword()` — native argon2id | `argon2` |

## Client Pairing

Use [`@passkeykit/client`](https://www.npmjs.com/package/@passkeykit/client) for the browser side. It handles the WebAuthn ceremony and `challengeToken` round-tripping automatically.

```typescript
import { PasskeyClient } from '@passkeykit/client';

const client = new PasskeyClient({ serverUrl: '/api/auth/passkey' });
await client.register(userId, 'My Device');
await client.authenticate();
```

## Testing

```bash
npm test
npm run test:coverage
```

## License

MIT — [GitHub](https://github.com/dnldev/passkey-kit)
