# @passkeykit/sso

Configurable SSO client for browser-based apps. Provides session management, inactivity tracking, SSO callback handling, and admin elevation — all via a single factory function.

## Install

```bash
npm install @passkeykit/sso
```

## Quick Start

```ts
import { createSSOClient } from '@passkeykit/sso';

const sso = createSSOClient({
  ssoUrl: 'https://sso.example.com',
  verifyUrl: 'https://api.example.com/auth/verify',
});
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `ssoUrl` | `string` | **required** | SSO login page URL |
| `verifyUrl` | `string` | **required** | Token verification endpoint URL |
| `callbackPath` | `string` | `/auth/callback` | Callback path on your app |
| `sessionDuration` | `number` | 30 days (ms) | Absolute session lifetime |
| `inactivityTimeout` | `number` | `Infinity` | Idle timeout before re-auth (ms). Set `0` or `Infinity` to disable |
| `sessionKey` | `string` | `sso_session` | localStorage key for session data |
| `activityKey` | `string` | `sso_last_activity` | localStorage key for activity timestamp |
| `elevationDuration` | `number` | 15 min (ms) | Duration of admin elevation after re-auth |

### Examples

```ts
// 5-hour inactivity timeout, custom callback path
const sso = createSSOClient({
  ssoUrl: 'https://sso.example.com',
  verifyUrl: 'https://api.example.com/auth/verify',
  callbackPath: '/?sso_callback=1',
  inactivityTimeout: 5 * 60 * 60 * 1000,
});

// 12-hour inactivity timeout
const sso = createSSOClient({
  ssoUrl: 'https://sso.example.com',
  verifyUrl: 'https://api.example.com/auth/verify',
  inactivityTimeout: 12 * 60 * 60 * 1000,
});

// No inactivity timeout (default)
const sso = createSSOClient({
  ssoUrl: 'https://sso.example.com',
  verifyUrl: 'https://api.example.com/auth/verify',
});
```

## API

### `createSSOClient(config): SSOClient`

Returns an `SSOClient` with the following methods:

#### Session

- **`getSession(): SSOSession | null`** — Returns the current session, or `null` if expired or inactive.
- **`clearSession(): void`** — Removes session and activity data from localStorage.
- **`redirectToSSO(): void`** — Redirects the browser to the SSO login page with the correct callback URL.
- **`handleSSOCallback(token: string): Promise<SSOSession | null>`** — Verifies a JWT token via the `verifyUrl` endpoint, stores the session, and returns it.

#### Activity Tracking

- **`touchActivity(): void`** — Records current timestamp as last activity.
- **`startActivityTracking(): () => void`** — Listens for `pointerdown`, `keydown`, and `scroll` events (30s throttle). Returns a cleanup function.

#### Admin Elevation

- **`isElevated(): boolean`** — Checks if the current admin session has been elevated (re-authenticated).
- **`elevateSession(): void`** — Redirects to SSO for re-authentication with an elevation flag.
- **`completeElevation(): boolean`** — Call after SSO callback to finalize elevation. Returns `true` if elevation was completed.
- **`stepDown(): void`** — Drops the elevated status.

### Types

```ts
interface SSOSession {
  userId: string;
  name: string;
  email: string;
  role: string;
  token: string;
  expires: number;
  elevated?: boolean;
  elevatedUntil?: number;
}
```

## Integration Pattern

Create a thin wrapper to configure the client and re-export functions:

```ts
// src/lib/sso.ts
import { createSSOClient } from '@passkeykit/sso';

export type { SSOSession } from '@passkeykit/sso';

const sso = createSSOClient({
  ssoUrl: process.env.SSO_URL || 'https://sso.example.com',
  verifyUrl: process.env.VERIFY_URL || 'https://api.example.com/auth/verify',
  inactivityTimeout: 5 * 60 * 60 * 1000, // app-specific
});

// Re-export individual functions to preserve existing import signatures
export const {
  getSession,
  clearSession,
  redirectToSSO,
  handleSSOCallback,
  touchActivity,
  startActivityTracking,
  isElevated,
  elevateSession,
  completeElevation,
  stepDown,
} = sso;
```

## Token Verification

The `verifyUrl` endpoint receives a `POST` request with `{ token: string }` and should return:

```json
{ "valid": true, "user": { "id": "...", "name": "...", "email": "...", "role": "..." } }
```

On failure, return `{ "valid": false }` or a non-200 status.

## License

MIT
