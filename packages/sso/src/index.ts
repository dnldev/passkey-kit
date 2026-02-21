/**
 * @passkeykit/sso — Configurable SSO client for browser-based apps.
 *
 * Usage:
 *   import { createSSOClient } from '@passkeykit/sso';
 *   const sso = createSSOClient({ verifyUrl: 'https://your-sso.example.com/api/auth/verify' });
 *   // or with inactivity timeout:
 *   const sso = createSSOClient({ verifyUrl: '...', inactivityTimeout: 5 * 60 * 60 * 1000 });
 */

export interface SSOSession {
  userId: string;
  name: string;
  email: string;
  role: string;
  token: string;
  expires: number;
  elevated?: boolean;
  elevatedUntil?: number;
}

export interface SSOClientConfig {
  /** URL of the SSO login page. Required. */
  ssoUrl: string;
  /** URL of the token verification endpoint. Required. */
  verifyUrl: string;
  /** Callback path on the satellite app. Defaults to '/auth/callback'. */
  callbackPath?: string;
  /** Absolute session duration in ms. Defaults to 30 days. */
  sessionDuration?: number;
  /** Inactivity timeout in ms. Set to 0 or Infinity to disable. Defaults to Infinity (disabled). */
  inactivityTimeout?: number;
  /** localStorage key for the session. Defaults to 'sso_session'. */
  sessionKey?: string;
  /** localStorage key for activity tracking. Defaults to 'sso_last_activity'. */
  activityKey?: string;
  /** Admin elevation duration in ms. Defaults to 15 minutes. */
  elevationDuration?: number;
}

const DEFAULTS = {
  callbackPath: "/auth/callback",
  sessionDuration: 30 * 24 * 60 * 60 * 1000,
  inactivityTimeout: Infinity,
  sessionKey: "sso_session",
  activityKey: "sso_last_activity",
  elevationDuration: 15 * 60 * 1000,
} as const;

export interface SSOClient {
  /** Get the current session, or null if expired/inactive. */
  getSession(): SSOSession | null;
  /** Clear the current session and activity data. */
  clearSession(): void;
  /** Redirect the browser to the SSO login page. */
  redirectToSSO(): void;
  /** Handle the SSO callback — verify token and store session. */
  handleSSOCallback(token: string): Promise<SSOSession | null>;
  /** Record user activity (for inactivity tracking). */
  touchActivity(): void;
  /** Start listening to DOM events for activity tracking. Returns cleanup fn. */
  startActivityTracking(): () => void;
  /** Check if the current admin session is elevated. */
  isElevated(): boolean;
  /** Redirect to SSO for admin elevation (re-auth). */
  elevateSession(): void;
  /** Complete an in-flight elevation after SSO callback. */
  completeElevation(): boolean;
  /** Drop admin elevation. */
  stepDown(): void;
  /** The resolved config. */
  config: Required<SSOClientConfig>;
}

/**
 * Create a configured SSO client instance.
 *
 * @example
 * // Minimal — no inactivity timeout
 * const sso = createSSOClient({
 *   ssoUrl: 'https://sso.example.com',
 *   verifyUrl: 'https://api.example.com/auth/verify',
 * });
 *
 * @example
 * // With 5-hour inactivity timeout
 * const sso = createSSOClient({
 *   ssoUrl: 'https://sso.example.com',
 *   verifyUrl: 'https://api.example.com/auth/verify',
 *   inactivityTimeout: 5 * 60 * 60 * 1000,
 * });
 */
export function createSSOClient(userConfig: SSOClientConfig): SSOClient {
  const cfg: Required<SSOClientConfig> = {
    ssoUrl: userConfig.ssoUrl,
    verifyUrl: userConfig.verifyUrl,
    callbackPath: userConfig.callbackPath ?? DEFAULTS.callbackPath,
    sessionDuration: userConfig.sessionDuration ?? DEFAULTS.sessionDuration,
    inactivityTimeout: userConfig.inactivityTimeout ?? DEFAULTS.inactivityTimeout,
    sessionKey: userConfig.sessionKey ?? DEFAULTS.sessionKey,
    activityKey: userConfig.activityKey ?? DEFAULTS.activityKey,
    elevationDuration: userConfig.elevationDuration ?? DEFAULTS.elevationDuration,
  };

  function getSession(): SSOSession | null {
    try {
      const raw = localStorage.getItem(cfg.sessionKey);
      if (!raw) return null;
      const session: SSOSession = JSON.parse(raw);

      // Absolute expiry
      if (Date.now() > session.expires) {
        clearSession();
        return null;
      }

      // Inactivity check
      if (cfg.inactivityTimeout !== Infinity && cfg.inactivityTimeout > 0) {
        const last = localStorage.getItem(cfg.activityKey);
        if (last && Date.now() - Number(last) > cfg.inactivityTimeout) {
          clearSession();
          return null;
        }
      }

      return session;
    } catch {
      clearSession();
      return null;
    }
  }

  function clearSession(): void {
    localStorage.removeItem(cfg.sessionKey);
    localStorage.removeItem(cfg.activityKey);
  }

  function redirectToSSO(): void {
    const callbackUrl = `${globalThis.location.origin}${cfg.callbackPath}`;
    const loginUrl = `${cfg.ssoUrl}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    globalThis.location.href = loginUrl;
  }

  async function handleSSOCallback(token: string): Promise<SSOSession | null> {
    try {
      const resp = await fetch(cfg.verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data.valid || !data.user) return null;

      const session: SSOSession = {
        userId: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role || "member",
        token,
        expires: Date.now() + cfg.sessionDuration,
      };

      localStorage.setItem(cfg.sessionKey, JSON.stringify(session));
      return session;
    } catch {
      return null;
    }
  }

  function touchActivity(): void {
    localStorage.setItem(cfg.activityKey, String(Date.now()));
  }

  function startActivityTracking(): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; }, 30_000);
      touchActivity();
    };
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') touchActivity();
    };
    touchActivity();
    globalThis.addEventListener("pointerdown", handler);
    globalThis.addEventListener("keydown", handler);
    globalThis.addEventListener("scroll", handler, { passive: true });
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      globalThis.removeEventListener("pointerdown", handler);
      globalThis.removeEventListener("keydown", handler);
      globalThis.removeEventListener("scroll", handler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }

  // ── Admin elevation ──────────────────────────────────────────────────

  function isElevated(): boolean {
    const session = getSession();
    if (!session || session.role !== "admin") return false;
    return !!(session.elevated && session.elevatedUntil && Date.now() < session.elevatedUntil);
  }

  function elevateSession(): void {
    const session = getSession();
    if (!session || session.role !== "admin") return;
    localStorage.setItem("sso_elevate_pending", "true");
    const callbackUrl = `${globalThis.location.origin}${cfg.callbackPath}`;
    const loginUrl = `${cfg.ssoUrl}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    globalThis.location.href = loginUrl;
  }

  function completeElevation(): boolean {
    const pending = localStorage.getItem("sso_elevate_pending");
    localStorage.removeItem("sso_elevate_pending");
    if (!pending) return false;
    const session = getSession();
    if (!session || session.role !== "admin") return false;
    session.elevated = true;
    session.elevatedUntil = Date.now() + cfg.elevationDuration;
    localStorage.setItem(cfg.sessionKey, JSON.stringify(session));
    return true;
  }

  function stepDown(): void {
    const session = getSession();
    if (!session) return;
    session.elevated = false;
    session.elevatedUntil = undefined;
    localStorage.setItem(cfg.sessionKey, JSON.stringify(session));
  }

  return {
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
    config: cfg,
  };
}
