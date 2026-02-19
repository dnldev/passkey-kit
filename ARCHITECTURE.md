# PasskeyKit Architecture

## Overview

PasskeyKit is a monorepo containing two npm packages for WebAuthn passkey authentication:

- **`@passkeykit/server`** — Server-side challenge generation, attestation/assertion verification, and password hashing
- **`@passkeykit/client`** — Browser-side WebAuthn ceremony handler

The packages are designed to work together but can be used independently.

## Monorepo Structure

```
passkey-kit/
├── packages/
│   ├── server/                    # @passkeykit/server
│   │   ├── src/
│   │   │   ├── index.ts           # Main entry — re-exports public API
│   │   │   ├── passkey-server.ts  # Core PasskeyServer class (registration + authentication)
│   │   │   ├── challenge-token.ts # Stateless AES-256-GCM challenge token encryption
│   │   │   ├── password.ts        # Scrypt password hashing (pure JS, works everywhere)
│   │   │   ├── password-argon2.ts # Optional argon2id hashing (native bindings)
│   │   │   ├── stores.ts          # Built-in Memory + File store implementations
│   │   │   ├── express-routes.ts  # Ready-made Express router factory
│   │   │   └── types.ts           # All TypeScript interfaces
│   │   ├── tests/                 # Vitest test suite
│   │   ├── tsconfig.json          # CJS build config
│   │   └── tsconfig.esm.json      # ESM build config
│   │
│   └── client/                    # @passkeykit/client
│       ├── src/
│       │   ├── index.ts           # Main entry
│       │   ├── passkey-client.ts   # PasskeyClient class (fetch + WebAuthn ceremony)
│       │   ├── errors.ts          # Typed PasskeyError class with error codes
│       │   └── detect.ts          # Feature detection utilities
│       └── tests/                 # Vitest test suite
│
├── vitest.config.ts               # Shared test configuration (if present)
├── package.json                   # Workspace root
└── ARCHITECTURE.md                # This file
```

## Design Principles

### 1. Stateless by Default
The server supports two challenge modes:
- **Stateless**: Challenges are encrypted into AES-256-GCM tokens and returned to the client. No server-side storage needed — ideal for serverless (Vercel, Cloudflare Workers, Lambda).
- **Stateful**: Challenges are stored in a `ChallengeStore` (memory, file, Redis). Use when you need server-side challenge revocation.

### 2. Storage Abstraction
Both `ChallengeStore` and `CredentialStore` are interfaces. The package ships with Memory and File implementations, but consumers provide their own for production (PostgreSQL, Firestore, DynamoDB, Redis, etc).

### 3. Peer Dependencies for Heavy Modules
`@simplewebauthn/server` (~2MB installed with its ASN.1/CBOR deps) is a **peer dependency** — consumers control the version and the install footprint is explicit. Password hashing (`@passkeykit/server/password`) requires zero external dependencies.

### 4. Subpath Exports
The server package uses Node.js subpath exports to enable tree-shaking and selective imports:

| Subpath | Purpose | Dependencies |
|---------|---------|--------------|
| `@passkeykit/server` | Full API | `@simplewebauthn/server` |
| `@passkeykit/server/password` | Scrypt hashing only | `@noble/hashes` |
| `@passkeykit/server/express` | Express router factory | `express` (peer) |
| `@passkeykit/server/argon2` | Argon2id hashing | `argon2` (peer) |

### 5. Dual CJS/ESM Output
The server package builds to both CommonJS (`dist/`) and ESM (`dist/esm/`) to support all bundlers and runtimes.

## Data Flow

### Registration
```
Browser                              Server
  │                                    │
  │── POST /register/options ────────▶ │  Generate challenge
  │◀── { options, challengeToken } ──  │  (seal into AES-256-GCM token OR store)
  │                                    │
  │── navigator.credentials.create() ──│  (browser-local WebAuthn ceremony)
  │                                    │
  │── POST /register/verify ─────────▶ │  Verify attestation
  │   { response, challengeToken }     │  (open token OR consume from store)
  │◀── { verified: true } ────────────│  Save credential to CredentialStore
```

### Authentication
```
Browser                              Server
  │                                    │
  │── POST /authenticate/options ────▶ │  Generate challenge
  │◀── { options, sessionKey } ───────│  (sessionKey = encrypted token in stateless)
  │                                    │
  │── navigator.credentials.get() ────│  (browser-local WebAuthn ceremony)
  │                                    │
  │── POST /authenticate/verify ─────▶│  Verify assertion
  │   { response, sessionKey }         │  Lookup credential, check counter
  │◀── { verified, userId, token } ──│  Return session token / JWT
```

## Security Model

- **Challenges are server-generated** — the client never creates challenges
- **AES-256-GCM** authenticated encryption for stateless tokens (confidentiality + integrity)
- **HKDF-SHA256 key derivation** from the encryption secret via Web Crypto `deriveKey`
- **Web Crypto API** — no `node:crypto` dependency; works on Node 18+, Deno, Bun, Cloudflare Workers, Vercel Edge
- **Key rotation** — `encryptionKey` accepts `string | string[]`; encryption uses the first key, decryption tries all keys in order
- **Challenge expiry** baked into tokens (default: 5 minutes)
- **Counter verification** prevents credential cloning attacks
- **Scrypt password hashing** with OWASP-recommended parameters (N=2^17, r=8, p=1)
- **Constant-time comparison** via XOR (no `crypto.timingSafeEqual` dependency)

### Client Error Typing

The `@passkeykit/client` package throws typed `PasskeyError` instances instead of generic `Error`. Error codes (`USER_CANCELLED`, `SERVER_ERROR`, `NETWORK_ERROR`, `NOT_SUPPORTED`, `INVALID_RESPONSE`, `UNKNOWN`) allow consumers to handle "user closed the prompt" differently from real failures.

## Testing

Tests use Vitest and mock `@simplewebauthn/server` to test the orchestration logic independently. File-based stores use a temp directory that's cleaned up after each test.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Build

```bash
npm run build         # Build all packages (CJS + ESM + declarations)
npm run clean         # Remove dist/ from all packages
```
