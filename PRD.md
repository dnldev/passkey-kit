# PasskeyKit — Product Requirements Document

## Problem Statement

WebAuthn/Passkey authentication is the modern standard for passwordless login, but implementing it correctly is complex:

1. **Challenge management** — Challenges must be generated server-side, stored or encrypted, and verified after the ceremony. Getting this wrong creates security vulnerabilities.
2. **Serverless incompatibility** — Traditional stateful challenge storage doesn't work on edge runtimes (Vercel, Cloudflare Workers) that don't have persistent state between requests.
3. **Boilerplate** — Setting up WebAuthn requires ~200 lines of server code for each app, with subtle security pitfalls around counter verification, origin validation, and challenge binding.
4. **Password hashing** — Many apps need passkeys AND passwords during migration. Bundling password hashing avoids bringing in a separate dependency.

## Solution

PasskeyKit provides a **minimal, correct, and serverless-compatible** WebAuthn implementation split into two packages:

### @passkeykit/server
- **Core class** (`PasskeyServer`) that handles registration + authentication with proper challenge binding
- **Stateless mode** — challenges encrypted into AES-256-GCM tokens (zero server state)
- **Stateful mode** — pluggable `ChallengeStore` interface for traditional backends
- **Storage abstraction** — `CredentialStore` interface with built-in Memory + File implementations
- **Password hashing** — scrypt (pure JS, works everywhere) + optional argon2id
- **Express integration** — one-line route mounting

### @passkeykit/client
- **Ceremony handler** (`PasskeyClient`) that manages the fetch → WebAuthn → verify flow
- **Automatic `challengeToken` round-tripping** for stateless mode
- **Feature detection** utilities for browser support checks
- **Framework-agnostic** — works with React, Vue, Svelte, vanilla JS

## Target Users

1. **Solo developers** building apps with passkey auth who want a simple, secure library
2. **Teams migrating from passwords to passkeys** who need both password hashing and WebAuthn
3. **Serverless apps** that can't use traditional session-based challenge storage
4. **Multi-app platforms** that need a shared auth library across services

## Non-Goals

- **Identity provider** — PasskeyKit handles the ceremony, not user management, sessions, or JWTs
- **OAuth/OIDC** — This is WebAuthn only; combine with your own session/token system
- **Admin UI** — No dashboard or credential management UI; implement your own

## Technical Requirements

### Must Have
- [x] Server-side challenge generation (never client-side)
- [x] Stateless challenge tokens (AES-256-GCM encrypted)
- [x] Stateful challenge storage (interface + Memory/File implementations)
- [x] Registration + authentication verification
- [x] Credential counter tracking
- [x] Scrypt password hashing (pure JS, zero native deps)
- [x] TypeScript types and declarations
- [x] Dual CJS/ESM build output
- [x] Express route factory
- [x] Client-side ceremony handler
- [x] Browser feature detection

### Should Have
- [x] Argon2id via optional subpath export
- [x] Password-only subpath (no WebAuthn dep required)
- [x] Custom headers and extraBody support in client
- [x] Challenge TTL configuration
- [ ] Fastify/Hono route adapters
- [ ] Redis challenge store implementation

### Nice to Have
- [ ] React hook (`usePasskey`)
- [ ] Rate limiting middleware
- [ ] Credential management UI components
- [ ] WebAuthn conditional UI (autofill) support

## Package Size Budget

| Package | Tarball | Installed (with peer deps) |
|---------|---------|---------------------------|
| `@passkeykit/server` | < 10 KB | ~4 MB (with `@simplewebauthn/server`) |
| `@passkeykit/server/password` | (subpath) | ~200 KB (`@noble/hashes` only) |
| `@passkeykit/client` | < 5 KB | ~500 KB (with `@simplewebauthn/browser`) |

`@simplewebauthn/server` is heavy (~2MB) because it bundles ASN.1/CBOR parsers for attestation verification. By making it a **peer dependency**, consumers install it explicitly and can share it with other packages.

## API Surface

### Server
```typescript
// Core
new PasskeyServer(config)
server.generateRegistrationOptions(user, opts?)
server.verifyRegistration(userId, response, name?, token?)
server.generateAuthenticationOptions(userId?, opts?)
server.verifyAuthentication(sessionKey, response)

// Password
hashPassword(password, opts?)
verifyPassword(storedHash, password)
needsRehash(storedHash, opts?)

// Challenge tokens (advanced)
sealChallengeToken(payload, secret)
openChallengeToken(token, secret)

// Stores
new MemoryChallengeStore()
new MemoryCredentialStore()
new FileChallengeStore(path)
new FileCredentialStore(path)

// Express
createExpressRoutes(server, config)
```

### Client
```typescript
new PasskeyClient(config)
client.register(userId, name?, opts?)
client.authenticate(userId?, opts?)
isWebAuthnAvailable()
isPlatformAuthenticatorAvailable()
```

## Versioning

Follows [Semantic Versioning](https://semver.org/):
- **Major**: Breaking API changes
- **Minor**: New features, peer dep changes
- **Patch**: Bug fixes, documentation

## License

MIT
