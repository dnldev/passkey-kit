import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSSOClient, type SSOClient, type SSOSession } from "../src/index";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
};

// Mock fetch
const fetchMock = vi.fn();

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { origin: "https://test.example.com", href: "" });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSSOClient(overrides?: Partial<Parameters<typeof createSSOClient>[0]>): SSOClient {
  return createSSOClient({
    verifyUrl: "https://push.example.com/api/auth/sso-verify",
    ...overrides,
  });
}

function seedSession(sso: SSOClient, overrides?: Partial<SSOSession>) {
  const session: SSOSession = {
    userId: "daniel",
    name: "Daniel",
    email: "daniel@test.com",
    role: "admin",
    token: "jwt-token",
    expires: Date.now() + 1000 * 60 * 60,
    ...overrides,
  };
  store[sso.config.sessionKey] = JSON.stringify(session);
  return session;
}

describe("createSSOClient", () => {
  it("returns an object with all required methods", () => {
    const sso = makeSSOClient();
    expect(sso.getSession).toBeTypeOf("function");
    expect(sso.clearSession).toBeTypeOf("function");
    expect(sso.redirectToSSO).toBeTypeOf("function");
    expect(sso.handleSSOCallback).toBeTypeOf("function");
    expect(sso.touchActivity).toBeTypeOf("function");
    expect(sso.startActivityTracking).toBeTypeOf("function");
    expect(sso.isElevated).toBeTypeOf("function");
    expect(sso.elevateSession).toBeTypeOf("function");
    expect(sso.completeElevation).toBeTypeOf("function");
    expect(sso.stepDown).toBeTypeOf("function");
  });

  it("applies defaults for optional config", () => {
    const sso = makeSSOClient();
    expect(sso.config.ssoUrl).toBe("https://user.danieltech.dev");
    expect(sso.config.callbackPath).toBe("/auth/callback");
    expect(sso.config.sessionDuration).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sso.config.inactivityTimeout).toBe(Infinity);
    expect(sso.config.sessionKey).toBe("sso_session");
  });

  it("allows overriding config", () => {
    const sso = makeSSOClient({
      ssoUrl: "https://custom.sso",
      callbackPath: "/?sso_callback=1",
      inactivityTimeout: 5 * 60 * 60 * 1000,
    });
    expect(sso.config.ssoUrl).toBe("https://custom.sso");
    expect(sso.config.callbackPath).toBe("/?sso_callback=1");
    expect(sso.config.inactivityTimeout).toBe(18_000_000);
  });
});

describe("getSession", () => {
  it("returns null when no session exists", () => {
    const sso = makeSSOClient();
    expect(sso.getSession()).toBeNull();
  });

  it("returns the session when valid", () => {
    const sso = makeSSOClient();
    seedSession(sso);
    const session = sso.getSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe("daniel");
  });

  it("returns null and clears when session is expired", () => {
    const sso = makeSSOClient();
    seedSession(sso, { expires: Date.now() - 1000 });
    expect(sso.getSession()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("sso_session");
  });

  it("returns null when inactive too long", () => {
    const sso = makeSSOClient({ inactivityTimeout: 5000 });
    seedSession(sso);
    store[sso.config.activityKey] = String(Date.now() - 10_000);
    expect(sso.getSession()).toBeNull();
  });

  it("skips inactivity check when timeout is Infinity", () => {
    const sso = makeSSOClient({ inactivityTimeout: Infinity });
    seedSession(sso);
    store[sso.config.activityKey] = String(Date.now() - 999_999_999);
    expect(sso.getSession()).not.toBeNull();
  });
});

describe("clearSession", () => {
  it("removes session and activity keys", () => {
    const sso = makeSSOClient();
    seedSession(sso);
    store[sso.config.activityKey] = "123";
    sso.clearSession();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("sso_session");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("sso_last_activity");
  });
});

describe("redirectToSSO", () => {
  it("constructs the correct login URL", () => {
    const sso = makeSSOClient();
    sso.redirectToSSO();
    expect(globalThis.location.href).toContain("https://user.danieltech.dev/login?callbackUrl=");
    expect(globalThis.location.href).toContain(encodeURIComponent("https://test.example.com/auth/callback"));
  });

  it("uses custom callback path", () => {
    const sso = makeSSOClient({ callbackPath: "/?sso_callback=1" });
    sso.redirectToSSO();
    expect(globalThis.location.href).toContain(encodeURIComponent("https://test.example.com/?sso_callback=1"));
  });
});

describe("handleSSOCallback", () => {
  it("verifies token and stores session", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        user: { id: "heather", name: "Heather", email: "h@test.com", role: "member" },
      }),
    });
    const sso = makeSSOClient();
    const session = await sso.handleSSOCallback("jwt-token");
    expect(session).not.toBeNull();
    expect(session!.userId).toBe("heather");
    expect(session!.role).toBe("member");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "sso_session",
      expect.stringContaining('"userId":"heather"')
    );
  });

  it("returns null on failed verification", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const sso = makeSSOClient();
    expect(await sso.handleSSOCallback("bad")).toBeNull();
  });

  it("returns null when response missing valid/user", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "test" }),
    });
    const sso = makeSSOClient();
    expect(await sso.handleSSOCallback("bad")).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));
    const sso = makeSSOClient();
    expect(await sso.handleSSOCallback("bad")).toBeNull();
  });
});

describe("activity tracking", () => {
  it("touchActivity writes timestamp to localStorage", () => {
    const sso = makeSSOClient();
    sso.touchActivity();
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "sso_last_activity",
      expect.any(String)
    );
  });

  it("startActivityTracking registers event listeners", () => {
    const sso = makeSSOClient();
    const cleanup = sso.startActivityTracking();
    expect(globalThis.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(globalThis.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(globalThis.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });
    cleanup();
    expect(globalThis.removeEventListener).toHaveBeenCalledTimes(3);
  });
});

describe("admin elevation", () => {
  it("isElevated returns false for non-admin", () => {
    const sso = makeSSOClient();
    seedSession(sso, { role: "member" });
    expect(sso.isElevated()).toBe(false);
  });

  it("isElevated returns false for non-elevated admin", () => {
    const sso = makeSSOClient();
    seedSession(sso, { role: "admin" });
    expect(sso.isElevated()).toBe(false);
  });

  it("completeElevation sets elevated flag", () => {
    const sso = makeSSOClient();
    seedSession(sso, { role: "admin" });
    store["sso_elevate_pending"] = "true";
    const result = sso.completeElevation();
    expect(result).toBe(true);
    const updated = sso.getSession();
    expect(updated!.elevated).toBe(true);
    expect(updated!.elevatedUntil).toBeGreaterThan(Date.now());
  });

  it("stepDown clears elevation", () => {
    const sso = makeSSOClient();
    seedSession(sso, { role: "admin", elevated: true, elevatedUntil: Date.now() + 60000 });
    expect(sso.isElevated()).toBe(true);
    sso.stepDown();
    expect(sso.isElevated()).toBe(false);
  });
});
