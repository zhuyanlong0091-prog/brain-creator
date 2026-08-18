// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import {
  AuthStateRefreshRegistry,
  createConfiguredAuthRefreshRegistry,
  createDefaultAuthRefreshRegistry,
  type AuthRefreshAdapter
} from "./authStateRefresh.js";

const system = {
  id: "system-auth",
  name: "Auth system",
  environment: "test",
  baseUrl: "https://system.example/",
  urlAllowlist: ["https://system.example/"],
  defaultLocale: "zh-CN",
  status: "succeeded",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z"
} as unknown as SystemProfile;

const profile = {
  id: "auth-profile",
  projectId: system.id,
  env: "test",
  role: "qa",
  loginMethod: "cookie",
  encryptedSecrets: { cookie: "encrypted-value" },
  status: "succeeded",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z"
} as AuthProfile;

describe("auth refresh registry", () => {
  it("selects the hinted provider deterministically", async () => {
    const adapter: AuthRefreshAdapter = {
      provider: "cookie",
      supports: (input) => input.authProfile.loginMethod === "cookie",
      refresh: async () => ({
        provider: "cookie",
        status: "succeeded",
        storageStatePath: "C:/safe/state.json"
      })
    };
    const registry = new AuthStateRefreshRegistry([adapter]);

    const result = await registry.refresh({
      workDir: "C:/work",
      system,
      authProfile: profile,
      reason: "expired",
      timeoutMs: 100
    });

    expect(result).toMatchObject({ provider: "cookie", status: "succeeded" });
  });

  it("returns needs-user when no provider can refresh the profile", async () => {
    const result = await createDefaultAuthRefreshRegistry().refresh({
      workDir: "C:/work",
      system,
      authProfile: profile,
      reason: "expired",
      timeoutMs: 100
    });

    expect(result.status).toBe("needs-user");
    expect(result.reason).toContain("provider");
  });

  it("converts provider timeout into a bounded failed attempt", async () => {
    const registry = new AuthStateRefreshRegistry([
      {
        provider: "cookie",
        supports: () => true,
        refresh: async () => new Promise(() => undefined)
      }
    ]);

    const result = await registry.refresh({
      workDir: "C:/work",
      system,
      authProfile: profile,
      reason: "expired",
      timeoutMs: 10
    });

    expect(result).toMatchObject({ provider: "cookie", status: "failed" });
    expect(result.reason).toContain("timed out");
  });

  it("does not fall back to host-agent when an explicit provider is unavailable", async () => {
    const explicitProfile = {
      ...profile,
      refreshProvider: "oauth"
    } as AuthProfile & { refreshProvider: "oauth" };
    const registry = createDefaultAuthRefreshRegistry(async () => ({
      storageStatePath: "C:/safe/host-state.json",
      provider: "host-agent"
    }));

    const result = await registry.refresh({
      workDir: "C:/work",
      system,
      authProfile: explicitProfile,
      reason: "expired",
      timeoutMs: 100
    });

    expect(result).toMatchObject({ provider: "oauth", status: "needs-user" });
    expect(result.reason).toContain("oauth");
  });

  it("registers a provider callback without exposing credentials", async () => {
    const explicitProfile = {
      ...profile,
      refreshProvider: "cas"
    } as AuthProfile & { refreshProvider: "cas" };
    const registry = createConfiguredAuthRefreshRegistry({
      providers: [{
        provider: "cas",
        handler: async () => ({
          storageStatePath: "C:/safe/cas-state.json",
          expiresAt: "2026-08-17T01:00:00.000Z",
          evidenceRefs: ["auth-check-cas"]
        })
      }]
    });

    const result = await registry.refresh({
      workDir: "C:/work",
      system,
      authProfile: explicitProfile,
      reason: "expired",
      timeoutMs: 100
    });

    expect(result).toEqual({
      provider: "cas",
      status: "succeeded",
      storageStatePath: "C:/safe/cas-state.json",
      expiresAt: "2026-08-17T01:00:00.000Z",
      evidenceRefs: ["auth-check-cas"]
    });
  });

  it("rejects duplicate provider registrations instead of making refresh order implicit", () => {
    const registry = new AuthStateRefreshRegistry();
    const adapter: AuthRefreshAdapter = {
      provider: "oauth",
      supports: () => true,
      refresh: async () => ({ status: "needs-user" })
    };

    registry.register(adapter);
    expect(() => registry.register(adapter)).toThrow(
      "Authentication refresh provider is already registered: oauth"
    );
  });
});
