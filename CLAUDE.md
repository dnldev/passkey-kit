# PasskeyKit — Product Intent

> Auto-loaded by Claude Code. Estate-wide rules live in `/root/CLAUDE.md` (and the
> global user CLAUDE.md); this file adds only what is specific to PasskeyKit.
> Full reference: `PRD.md` (repo) and `/root/knowledge-base/products/passkey-kit.md`.

## What this is

The estate's shared WebAuthn library — an npm workspaces monorepo publishing
`@passkeykit/server`, `@passkeykit/client`, and `@passkeykit/sso`. Every SPA and
MediaBox authenticate through this code. **It is security-critical infrastructure, not
an app**: a subtle bug here compromises every product at once.

## Non-negotiables

- **Contract-first is MANDATORY here** (estate rule for auth/crypto): interface + failing
  tests land before implementation. No drive-by refactors of verification logic.
- `packages/server/src/passkey-server.ts` (core WebAuthn verification),
  `challenge-token.ts` (AES-256-GCM stateless challenge encryption), and
  `password.ts` (scrypt, OWASP-parameter N=2^17) are the crown jewels — changes need
  Daniel-level review, tests in the diff, and no weakening of parameters, ever.
- **Stateless mode exists for serverless consumers** — challenge round-trips must keep
  working without a shared store. Don't add server-side state to shared paths.
- Backwards compatibility: consumers (MediaBox, push-service passkey routes, SPAs) pin
  published versions. Breaking API changes = major version + migration notes.

## Repo gotchas

- **npm workspaces monorepo:** a lockfile generated from a partial copy misses
  `@passkeykit/*` entries. Always clone/operate on the FULL repo and install with
  `CI=true npm install` at the root (pitfalls.md).
- Root `prepare: "husky"` breaks bare CI clones (exit 127) — `npm install
  --ignore-scripts` then explicit build, or `HUSKY=0`.
- **Git index is corrupted — local `git commit` fails.** Land changes via the GitHub
  contents API: `/root/scripts/contents-api-push.sh dnldev/passkey-kit <base> <branch> …`.
  (`/root/repos/passkey-kit-corrupted` is an old broken clone — ignore it.)
- Gates from the repo root: `npm run lint && npm test && npm run typecheck` (runs across
  workspaces). Publishing: npm, public packages — never include AI references in
  anything published.
