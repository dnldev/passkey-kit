# @passkeykit/sso

SSO client library for DanielTech satellite apps. Provides session management, inactivity tracking, SSO callback handling, and admin elevation — all configurable via a single factory function.

## Install

```bash
npm install @passkeykit/sso
```

## Quick Start

```ts
import { createSSOClient } from '@passkeykit/sso';

const sso = createSSOClient({
  verifyUrl: 'https://push.danieltech.dev/api/auth/sso-verify',
});
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `verifyUrl` | `string` | **required** | Token verification endpoint URL |
| `ssoUrl` | `string` | `https://user.danieltech.dev` | SSO login page URL |
| `callbackPath` | `string` | `/auth/callback` | Callback path on your app |
| `sessionDuration` | `number` | 30 days (ms) | Absolute session lifetime |
| `inactivityTimeout` | `number` | `Infinity` | Idle timeout before re-auth (ms). Set `0` or `Infinity` to disable |
| `sessionKey` | `string` | `sso_session` | localStorage key for session data |
| `activityKey` | `string` | `sso_last_activity` | localStorage key for activity timestamp |
| `elevationDuration` | `number` | 15 min (ms) | Duration of admin elevation after re-auth |

### Per-App Examples

```ts
// Meds — 5h inactivity, custom callback path
const sso = createSSOClient({
  verifyUrl: 'https://push.danieltech.dev/api/auth/sso-verify',
  callbackPath: '/?sso_callback=1',
  inactivityTimeout: 5 * 60 * 60 * 1000,
});

// Groceries — 12h inactivity
const sso = createSSOClient({
  verifyUrl: 'https://push.danieltech.dev/api/auth/sso-verify',
  inactivityTimeout: 12 * 60 * 60 * 1000,
});

// MediaBox — no inactivity timeout (default)
const sso = createSSOClient({
  verifyUrl: 'https://push.danieltech.dev/api/auth/sso-verify',
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

Replace your app's inline `src/lib/sso.ts` with a thin wrapper:

```ts
// src/lib/sso.ts
import { createSSOClient } from '@passkeykit/sso';

const PUSH_URL = import.meta.env.VITE_PUSH_URL || 'https://push.danieltech.dev';

export const sso = createSSOClient({
  verifyUrl: `${PUSH_URL}/api/auth/sso-verify`,
  inactivityTimeout: 5 * 60 * 60 * 1000, // app-specific
});

// Re-export for convenience
export type { SSOSession, SSOClient } from '@passkeykit/sso';
```

Then update imports:

```diff
- import { getSession, redirectToSSO } from '@/lib/sso';
+ import { sso } from '@/lib/sso';
+ // use sso.getSession(), sso.redirectToSSO(), etc.
```

Or re-export individual functions:

```ts
// src/lib/sso.ts
import { createSSOClient } from '@passkeykit/sso';
export type { SSOSession } from '@passkeykit/sso';

const PUSH_URL = import.meta.env.VITE_PUSH_URL || 'https://push.danieltech.dev';

const sso = createSSOClient({
  verifyUrl: `${PUSH_URL}/api/auth/sso-verify`,
  inactivityTimeout: 5 * 60 * 60 * 1000,
});

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

This approach preserves existing import signatures so no other files need changes.

## License

MIT
