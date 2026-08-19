import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { encryptSecrets } from "../shared/crypto.js";
import { AuthStateRefreshRegistry } from "./authStateRefresh.js";
import { createStandardAuthProviderAdapters, type AuthProviderHttpRequest } from "./standardAuthProviders.js";

const workDir = join(process.cwd(), ".tmp-standard-auth-providers");
const system = {
  id: "system-auth-protocol",
  name: "Protocol system",
  environment: "test",
  baseUrl: "https://app.example.test",
  urlAllowlist: ["https://app.example.test"],
  defaultLocale: "en-US",
  status: "succeeded",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z"
} as unknown as SystemProfile;

afterEach(async () => rm(workDir, { recursive: true, force: true }));
beforeEach(async () => mkdir(workDir, { recursive: true }));

describe("standard authentication providers", () => {
  it("refreshes OAuth with the standard refresh-token grant and writes protected state", async () => {
    const requests: AuthProviderHttpRequest[] = [];
    const [oauth] = createStandardAuthProviderAdapters({
      transport: async (request) => {
        requests.push(request);
        return { status: 200, body: JSON.stringify({ access_token: "oauth-access", expires_in: 60 }) };
      }
    });
    const result = await oauth.refresh(input("oauth", {
      tokenEndpoint: "https://idp.example.test/oauth/token",
      refreshToken: "refresh-secret",
      clientId: "client-id",
      storageMode: "localStorage"
    }));

    expect(requests[0]).toMatchObject({ method: "POST", url: "https://idp.example.test/oauth/token" });
    expect(requests[0].body).toContain("grant_type=refresh_token");
    expect(result).toMatchObject({ provider: "oauth", status: "succeeded", expiresAt: expect.any(String) });
    const state = JSON.parse(await readFile(result.storageStatePath!, "utf8"));
    expect(state.origins[0].localStorage).toEqual([{ name: "brain_creator_token", value: "oauth-access" }]);
  });

  it("validates a CAS ticket and writes cookie state without returning the ticket", async () => {
    const [cas] = createStandardAuthProviderAdapters({
      transport: async (request) => {
        expect(request.method).toBe("GET");
        expect(request.url).toContain("ticket=ST-123");
        return { status: 200, body: "<cas:serviceResponse><cas:authenticationSuccess><cas:user>qa</cas:user></cas:authenticationSuccess></cas:serviceResponse>" };
      }
    }).slice(1, 2);
    const result = await cas.refresh(input("cas", {
      validateEndpoint: "https://sso.example.test/cas/serviceValidate",
      serviceTicket: "ST-123",
      serviceUrl: "https://app.example.test/callback",
      storageMode: "cookie",
      cookieName: "SESSION"
    }));

    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result)).not.toContain("ST-123");
    const state = JSON.parse(await readFile(result.storageStatePath!, "utf8"));
    expect(state.cookies[0]).toMatchObject({ name: "SESSION", value: "ST-123" });
  });

  it("accepts a SAML session exchange response and rejects incomplete configuration in preflight", async () => {
    const adapters = createStandardAuthProviderAdapters({
      transport: async () => ({ status: 200, body: JSON.stringify({ access_token: "saml-session" }) })
    });
    const saml = adapters[2];
    const blocked = await new AuthStateRefreshRegistry([saml]).preflight(
      input("saml", { sessionEndpoint: "https://sso.example.test/session" })
    );
    expect(blocked.status).toBe("unavailable");
    expect(blocked.reason).toContain("samlResponse");
    const result = await saml.refresh(input("saml", {
      sessionEndpoint: "https://sso.example.test/session",
      samlResponse: "assertion",
      storageMode: "cookie"
    }));
    expect(result).toMatchObject({ provider: "saml", status: "succeeded" });
  });
});

function input(provider: "oauth" | "cas" | "saml", secrets: Record<string, string>) {
  return {
    workDir,
    system,
    authProfile: {
      id: `auth-${provider}`,
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "script",
      refreshProvider: provider,
      encryptedSecrets: encryptSecrets(secrets),
      status: "succeeded",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z"
    } as AuthProfile,
    reason: "test"
  };
}
