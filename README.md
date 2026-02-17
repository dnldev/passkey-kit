# passkey-kit

Server-verified WebAuthn passkey authentication library with argon2 password hashing.

Replaces insecure client-side challenge generation with a proper server-side challenge-response pattern using [@simplewebauthn](https://simplewebauthn.dev/).

## Packages

| Package | Description |
|---------|-------------|
| `@passkey-kit/server` | Server-side challenge generation, attestation/assertion verification, argon2 hashing |
| `@passkey-kit/client` | Browser-side WebAuthn ceremony handler (works with any framework) |

## Why?

The old pattern (used across several projects) was **insecure**:
- Challenge was generated client-side (`crypto.getRandomValues`) — attacker can forge
- No server-side signature verification — passkey presence ≠ identity proof
- PBKDF2 with 10K iterations — outdated, argon2id is recommended

This library fixes all three issues.

## Quick Start

### Server (Express)

```typescript
import {
  PasskeyServer,
  createExpressRoutes,
  MemoryChallengeStore,
  FileCredentialStore,
  hashPassword,
  verifyPassword,
} from '@passkey-kit/server';

const passkeyServer = new PasskeyServer({
  rpName: 'My App',
  rpId: 'myapp.example.com',
  allowedOrigins: ['https://myapp.example.com'],
  challengeStore: new MemoryChallengeStore(),
  credentialStore: new FileCredentialStore('./data/credentials.json'),
});

// Mount ready-made Express routes
const routes = createExpressRoutes(passkeyServer, {
  getUserInfo: async (userId) => {
    const user = await db.getUser(userId);
    return user ? { id: user.id, name: user.name } : null;
  },
  onAuthenticationSuccess: async (userId) => {
    const token = generateSessionToken();
    return { token }; // merged into response JSON
  },
});

app.use('/api/auth/passkey', routes);

// Password hashing (argon2id)
const hash = await hashPassword('my-passphrase');
const valid = await verifyPassword(hash, 'my-passphrase');
```

### Client (Browser)

```typescript
import { PasskeyClient, isWebAuthnAvailable } from '@passkey-kit/client';

const client = new PasskeyClient({
  serverUrl: '/api/auth/passkey',
});

// Register a new passkey
if (isWebAuthnAvailable()) {
  const result = await client.register(userId, 'My MacBook');
  console.log('Registered:', result.credentialId);
}

// Authenticate
const auth = await client.authenticate();
console.log('Authenticated as:', auth.userId);
// auth also contains any extras from onAuthenticationSuccess (e.g. token)
```

## Architecture

```
┌─────────────┐         ┌──────────────────┐
│   Browser    │         │     Server       │
│              │         │                  │
│ PasskeyClient│──POST──▶│ /register/options │
│              │◀────────│ (challenge)       │
│              │         │                  │
│ WebAuthn API │         │                  │
│ (browser     │──POST──▶│ /register/verify  │
│  prompt)     │◀────────│ (verified: true)  │
│              │         │                  │
│              │──POST──▶│ /authenticate/    │
│              │◀────────│  options          │
│              │         │                  │
│ WebAuthn API │──POST──▶│ /authenticate/    │
│              │◀────────│  verify           │
└─────────────┘         └──────────────────┘
```

## Storage Backends

The library uses a storage abstraction — implement `ChallengeStore` and `CredentialStore` for your backend:

### Built-in stores

- **`MemoryChallengeStore`** — In-memory, auto-expiring. Good for single-process servers.
- **`MemoryCredentialStore`** — In-memory. Good for development.
- **`FileChallengeStore`** — JSON file. Good for single-server apps.
- **`FileCredentialStore`** — JSON file. Good for single-server apps like MovieBox.

### Custom stores

```typescript
import type { ChallengeStore, CredentialStore } from '@passkey-kit/server';

class FirestoreChallengeStore implements ChallengeStore {
  async save(key, challenge) { /* ... */ }
  async consume(key) { /* ... */ }
}

class FirestoreCredentialStore implements CredentialStore {
  async save(credential) { /* ... */ }
  async getByUserId(userId) { /* ... */ }
  async getByCredentialId(credentialId) { /* ... */ }
  async updateCounter(credentialId, newCounter) { /* ... */ }
  async delete(credentialId) { /* ... */ }
}
```

## Password Hashing

Server-side argon2id hashing (replaces PBKDF2):

```typescript
import { hashPassword, verifyPassword } from '@passkey-kit/server';

// Hash
const hash = await hashPassword('my-passphrase');
// $argon2id$v=19$m=65536,t=3,p=4$...

// Verify
const valid = await verifyPassword(hash, 'my-passphrase'); // true

// With custom params
const strongHash = await hashPassword('passphrase', {
  memoryCost: 131072, // 128 MB
  timeCost: 4,
  parallelism: 8,
});
```

## License

MIT
