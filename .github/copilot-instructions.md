# passkey-kit — Shared WebAuthn Authentication Library

## What Is This
A monorepo providing WebAuthn (passkey) authentication for all of Daniel's apps. Two packages:
- `@passkey-kit/server` — Challenge generation, credential verification, scrypt password hashing
- `@passkey-kit/client` — Browser-side WebAuthn ceremony (register + authenticate)

## Architecture
- `packages/server/` — Node.js server-side WebAuthn (SimpleWebAuthn under the hood)
- `packages/client/` — Browser client (SimpleWebAuthn browser)
- `packages/server/src/index.ts` — Main exports: `PasskeyServer` class
- `packages/client/src/index.ts` — Main exports: `PasskeyClient` class

## Stateless Mode
For serverless deployments (Vercel SPAs), challenges are encrypted into tokens rather than stored server-side. The server decrypts the token on verification.

## Consumers
- **push-service** — Shared passkey backend at `push.danieltech.dev/api/passkey/*` (SPAs authenticate here)
- **MediaBox** — Own passkey server at `/api/video/auth/passkey/*`
- **SafeHarbor, Groceries, Meds** — Use `@passkey-kit/client` in browser, authenticate via push-service

## Important
- Each SPA has `passkey-kit` as a `file:` dependency in package.json
- Vercel deployments clone and build passkey-kit during install (custom `installCommand` in `vercel.json`)
- scrypt is used for any password-based fallbacks (not bcrypt)

## Build & Test
```bash
npm test       # Vitest
npm run build  # TypeScript compile
```
Direct push to `main`.

## @ai_context Mandate
Every complex or non-obvious file must include a `/** @ai_context */` block comment explaining WHY, not HOW. Document architectural decisions, external constraints, cross-file dependencies, and "never do X because Y" warnings.

Pattern:
```typescript
/**
 * @ai_context <explain the why, not the how>
 * Key constraints: ...
 * Cross-dependencies: ...
 */
```
