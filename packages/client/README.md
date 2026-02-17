# @passkeykit/client

Browser-side WebAuthn passkey authentication. Handles the registration and authentication ceremonies with zero configuration — just point it at your server.

Works with `@passkeykit/server` or any WebAuthn server that follows the standard challenge-response pattern.

[![npm](https://img.shields.io/npm/v/@passkeykit/client)](https://www.npmjs.com/package/@passkeykit/client)
[![license](https://img.shields.io/npm/l/@passkeykit/client)](https://github.com/dnldev/passkey-kit/blob/main/LICENSE)

## Install

```bash
npm install @passkeykit/client
```

## Quick Start

```typescript
import { PasskeyClient, isWebAuthnAvailable } from '@passkeykit/client';

const client = new PasskeyClient({
  serverUrl: '/api/auth/passkey',
});

// Check browser support
if (isWebAuthnAvailable()) {
  // Register a new passkey
  const reg = await client.register('user-123', 'My MacBook');
  console.log('Registered:', reg.credentialId);

  // Authenticate with a passkey
  const auth = await client.authenticate();
  console.log('Authenticated as:', auth.userId);
}
```

## API

### `new PasskeyClient(config)`

| Option | Type | Description |
|--------|------|-------------|
| `serverUrl` | `string` | **Required.** Base URL of the passkey API (e.g. `/api/auth/passkey`) |
| `fetch` | `typeof fetch` | Custom fetch function (e.g. to add auth headers). Defaults to `globalThis.fetch` |
| `headers` | `Record<string, string>` | Extra headers included in every request |
| `extraBody` | `Record<string, unknown>` | Extra fields merged into every request body. Useful for multi-app servers that need `rpId`/`rpName` per request |

### `client.register(userId, credentialName?, opts?)`

Registers a new passkey for a user.

1. Fetches registration options from the server
2. Triggers the browser's WebAuthn prompt (TouchID / FaceID / Windows Hello / security key)
3. Sends the attestation back for server-side verification

```typescript
const result = await client.register('user-123', 'My Phone', {
  authenticatorAttachment: 'platform',  // 'platform' | 'cross-platform'
  residentKey: 'preferred',             // 'required' | 'preferred' | 'discouraged'
  userVerification: 'preferred',        // 'required' | 'preferred' | 'discouraged'
});
// → { verified: true, credentialId: '...', credentialName: 'My Phone' }
```

### `client.authenticate(userId?, opts?)`

Authenticates with a passkey.

- **Without `userId`**: Discoverable credential flow — the browser picks the passkey
- **With `userId`**: Server hints which credentials to use

```typescript
const result = await client.authenticate();
// → { verified: true, userId: 'user-123', credentialId: '...' }
```

### `isWebAuthnAvailable()`

Returns `true` if the browser supports WebAuthn (`PublicKeyCredential` + `navigator.credentials`).

```typescript
import { isWebAuthnAvailable } from '@passkeykit/client';

if (!isWebAuthnAvailable()) {
  console.log('Passkeys not supported in this browser');
}
```

### `isPlatformAuthenticatorAvailable()`

Async check for platform authenticator support (TouchID, FaceID, Windows Hello).

```typescript
import { isPlatformAuthenticatorAvailable } from '@passkeykit/client';

if (await isPlatformAuthenticatorAvailable()) {
  // Show "Add Passkey" button
}
```

## Multi-App Server

When multiple apps share one passkey server, use `extraBody` to specify the relying party:

```typescript
const client = new PasskeyClient({
  serverUrl: 'https://auth.example.com/api/passkey',
  extraBody: {
    rpId: 'myapp.example.com',
    rpName: 'My App',
  },
});
```

## Stateless Mode

When used with `@passkeykit/server` in stateless mode, the client automatically handles `challengeToken` round-tripping — no extra config needed. The token is returned by the server in the options response and sent back during verification.

## Server Pairing

This package is designed to work with [`@passkeykit/server`](https://www.npmjs.com/package/@passkeykit/server), but it's compatible with any server that exposes:

- `POST /register/options` → returns WebAuthn registration options
- `POST /register/verify` → verifies the attestation response
- `POST /authenticate/options` → returns WebAuthn authentication options
- `POST /authenticate/verify` → verifies the assertion response

## License

MIT — [GitHub](https://github.com/dnldev/passkey-kit)
