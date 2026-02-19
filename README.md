# passkey-kit

Server-verified WebAuthn passkey authentication library. **Stateless by default** — works on Vercel, Cloudflare Workers, and traditional servers. Zero native dependencies.

Replaces insecure client-side challenge generation with a proper server-side challenge-response pattern using [@simplewebauthn](https://simplewebauthn.dev/).

## Packages

| Package | Description |
|---------|-------------|
| `@passkeykit/server` | Challenge generation, attestation/assertion verification, scrypt password hashing |
| `@passkeykit/client` | Browser-side WebAuthn ceremony handler (works with any framework) |

## Why?

Many WebAuthn implementations have subtle security issues:
- Challenge generated client-side (`crypto.getRandomValues`) — attackers can forge challenges
- No server-side signature verification — passkey presence alone doesn't prove identity
- Weak password hashing (e.g., PBKDF2 with low iterations)

PasskeyKit fixes these issues with a proper server-side challenge-response pattern.

## Features

- **Stateless mode** (default): Challenges encrypted into signed tokens (AES-256-GCM) — no database or memory store needed. Set one secret key and deploy anywhere.
- **Stateful mode**: Bring your own `ChallengeStore` (memory, file, Redis) for traditional servers.
- **Pure JS**: No native C++ bindings. Uses `@noble/hashes` (Trail of Bits audited) for scrypt.
- **Optional argon2**: Import from `@passkeykit/server/argon2` if you want native argon2id.

## Quick Start

### Stateless Server (Serverless / Vercel / Cloudflare)

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

### Stateful Server (Traditional)

```typescript
import { PasskeyServer, MemoryChallengeStore, FileCredentialStore } from '@passkeykit/server';

const server = new PasskeyServer({
  rpName: 'My App',
  rpId: 'myapp.example.com',
  allowedOrigins: ['https://myapp.example.com'],
  challengeStore: new MemoryChallengeStore(), // or Redis, Firestore, etc.
  credentialStore: new FileCredentialStore('./data/credentials.json'),
});
```

### Client (Browser)

```typescript
import { PasskeyClient, isWebAuthnAvailable } from '@passkeykit/client';

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
```

The client automatically handles `challengeToken` round-tripping for stateless servers — no extra config needed.

## Architecture

### Stateless (default)

```
Client                            Server
  │                                  │
  │── POST /register/options ──────▶│ Generate challenge
  │◀── { options, challengeToken } ──│ Seal challenge into AES-256-GCM token
  │                                  │
  │── WebAuthn ceremony (browser) ──│
  │                                  │
  │── POST /register/verify ───────▶│ Open token, verify attestation
  │   { response, challengeToken }   │ No DB lookup needed
  │◀── { verified: true } ──────────│
```

The `challengeToken` is an encrypted, signed, expiring token. The server needs only the secret key to verify it — zero state.

### Stateful (bring your ChallengeStore)

Same flow, but challenges are stored in your database/cache instead of encrypted tokens.

## Password Hashing

Default uses **scrypt** (pure JS, works everywhere):

```typescript
import { hashPassword, verifyPassword, needsRehash } from '@passkeykit/server';

const hash = await hashPassword('my-passphrase');
// $scrypt$ln=17,r=8,p=1$<salt>$<hash>

const valid = await verifyPassword(hash, 'my-passphrase'); // true

if (needsRehash(hash)) {
  // Params changed since this hash was created — rehash on next login
}
```

### argon2 (optional, requires native bindings)

```typescript
import { hashPassword, verifyPassword } from '@passkeykit/server/argon2';

const hash = await hashPassword('my-passphrase');
// $argon2id$v=19$m=65536,t=3,p=4$...
```

Install argon2 as a peer dependency: `npm install argon2`

## Storage Backends

### Built-in

- **`MemoryChallengeStore`** / **`MemoryCredentialStore`** — In-memory. Good for dev.
- **`FileChallengeStore`** / **`FileCredentialStore`** — JSON file. Good for single-server.

### Custom stores

```typescript
import type { CredentialStore } from '@passkeykit/server';

class FirestoreCredentialStore implements CredentialStore {
  async save(credential) { /* ... */ }
  async getByUserId(userId) { /* ... */ }
  async getByCredentialId(credentialId) { /* ... */ }
  async updateCounter(credentialId, newCounter) { /* ... */ }
  async delete(credentialId) { /* ... */ }
}
```

In stateless mode, you don't need a `ChallengeStore` at all.

## Multi-App Server

Use `extraBody` on the client to send app-specific data:

```typescript
const client = new PasskeyClient({
  serverUrl: 'https://shared-auth.example.com/api/passkey',
  extraBody: { rpId: 'myapp.com', rpName: 'My App' },
});
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## License

MIT
