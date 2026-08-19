import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { decryptSecrets } from "../shared/crypto.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import type {
  AuthRefreshAdapter,
  AuthRefreshInput,
  AuthRefreshPreflightResult,
  AuthRefreshProvider
} from "./authStateRefresh.js";

export type AuthProviderHttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

export type AuthProviderHttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body: string;
};

export type AuthProviderHttpTransport = (
  request: AuthProviderHttpRequest
) => Promise<AuthProviderHttpResponse>;

export type StandardAuthProviderOptions = {
  transport?: AuthProviderHttpTransport;
};

/**
 * Concrete protocol adapters for providers with a documented HTTP contract.
 * Provider-specific secrets stay encrypted in AuthProfile and are only used
 * inside the adapter. The result is always a protected Playwright state path.
 */
export function createStandardAuthProviderAdapters(
  options: StandardAuthProviderOptions = {}
): AuthRefreshAdapter[] {
  const transport = options.transport ?? fetchTransport;
  return [
    createOAuthAdapter(transport),
    createCasAdapter(transport),
    createSamlAdapter(transport)
  ];
}

function createOAuthAdapter(transport: AuthProviderHttpTransport): AuthRefreshAdapter {
  return {
    provider: "oauth",
    supports: (input) => input.authProfile.refreshProvider === "oauth",
    preflight: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["tokenEndpoint", "refreshToken", "clientId"], "OAuth");
      assertHttpUrl(secrets.tokenEndpoint, "OAuth token endpoint");
      return {
        provider: "oauth",
        status: "ready",
        checks: ["token-endpoint-configured", "refresh-token-configured", "client-id-configured"]
      };
    },
    refresh: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["tokenEndpoint", "refreshToken", "clientId"], "OAuth");
      assertHttpUrl(secrets.tokenEndpoint, "OAuth token endpoint");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
        client_id: secrets.clientId,
        ...(secrets.clientSecret ? { client_secret: secrets.clientSecret } : {})
      }).toString();
      const response = await transport({
        url: secrets.tokenEndpoint,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body
      });
      const payload = parseJsonResponse(response, "OAuth token endpoint");
      const accessToken = stringValue(payload.access_token);
      if (!accessToken) throw new Error("OAuth token endpoint did not return access_token");
      const storageStatePath = await writeTokenStorageState(input, "oauth", accessToken, secrets);
      return {
        provider: "oauth",
        status: "succeeded",
        storageStatePath,
        ...(numberValue(payload.expires_in)
          ? { expiresAt: new Date(Date.now() + numberValue(payload.expires_in)! * 1000).toISOString() }
          : {})
      };
    }
  };
}

function createCasAdapter(transport: AuthProviderHttpTransport): AuthRefreshAdapter {
  return {
    provider: "cas",
    supports: (input) => input.authProfile.refreshProvider === "cas",
    preflight: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["validateEndpoint", "serviceTicket", "serviceUrl"], "CAS");
      assertHttpUrl(secrets.validateEndpoint, "CAS validation endpoint");
      assertHttpUrl(secrets.serviceUrl, "CAS service URL");
      return {
        provider: "cas",
        status: "ready",
        checks: ["cas-validation-endpoint-configured", "service-ticket-configured", "service-url-configured"]
      };
    },
    refresh: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["validateEndpoint", "serviceTicket", "serviceUrl"], "CAS");
      assertHttpUrl(secrets.validateEndpoint, "CAS validation endpoint");
      assertHttpUrl(secrets.serviceUrl, "CAS service URL");
      const url = new URL(secrets.validateEndpoint);
      url.searchParams.set("ticket", secrets.serviceTicket);
      url.searchParams.set("service", secrets.serviceUrl);
      const response = await transport({ url: url.toString(), method: "GET", headers: { accept: "application/xml,text/xml" } });
      if (response.status < 200 || response.status >= 300 || !/<(?:cas:)?authenticationSuccess\b/i.test(response.body)) {
        throw new Error(`CAS validation endpoint returned HTTP ${response.status}`);
      }
      const storageStatePath = await writeTokenStorageState(input, "cas", secrets.serviceTicket, secrets);
      return { provider: "cas", status: "succeeded", storageStatePath };
    }
  };
}

function createSamlAdapter(transport: AuthProviderHttpTransport): AuthRefreshAdapter {
  return {
    provider: "saml",
    supports: (input) => input.authProfile.refreshProvider === "saml",
    preflight: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["sessionEndpoint", "samlResponse"], "SAML");
      assertHttpUrl(secrets.sessionEndpoint, "SAML session endpoint");
      return {
        provider: "saml",
        status: "ready",
        checks: ["saml-session-endpoint-configured", "saml-response-configured"]
      };
    },
    refresh: async (input) => {
      const secrets = providerSecrets(input.authProfile);
      requireSecrets(secrets, ["sessionEndpoint", "samlResponse"], "SAML");
      assertHttpUrl(secrets.sessionEndpoint, "SAML session endpoint");
      const response = await transport({
        url: secrets.sessionEndpoint,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json,application/xml,text/xml" },
        body: new URLSearchParams({ SAMLResponse: secrets.samlResponse }).toString()
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`SAML session endpoint returned HTTP ${response.status}`);
      }
      const payload = parseMaybeJson(response.body);
      const sessionToken = stringValue(payload?.access_token) ?? extractXmlValue(response.body, "SessionToken");
      if (!sessionToken) throw new Error("SAML session endpoint did not return a session token");
      const storageStatePath = await writeTokenStorageState(input, "saml", sessionToken, secrets);
      return { provider: "saml", status: "succeeded", storageStatePath };
    }
  };
}

async function writeTokenStorageState(
  input: AuthRefreshInput,
  provider: AuthRefreshProvider,
  token: string,
  secrets: Record<string, string>
) {
  const relativePath = secrets.storageStatePath ??
    join(".brain-creator", "auth", safePart(input.system.id), safePart(input.authProfile.id), `${provider}-storage-state.json`);
  const outputPath = await resolveProtectedStorageStatePath(input.workDir, relativePath);
  const storageMode = secrets.storageMode ?? "localStorage";
  const state = storageMode === "cookie"
    ? {
        cookies: [{
          name: secrets.cookieName ?? "brain_creator_session",
          value: token,
          url: input.system.baseUrl
        }],
        origins: []
      }
    : {
        cookies: [],
        origins: [{
          origin: new URL(input.system.baseUrl).origin,
          localStorage: [{ name: secrets.localStorageKey ?? "brain_creator_token", value: token }]
        }]
      };
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(outputPath), 0o700).catch(() => undefined);
  await writeFile(outputPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600).catch(() => undefined);
  return outputPath;
}

function providerSecrets(profile: AuthProfile) {
  return decryptSecrets(profile.encryptedSecrets);
}

function requireSecrets(secrets: Record<string, string>, keys: string[], provider: string) {
  const missing = keys.filter((key) => !secrets[key]);
  if (missing.length > 0) throw new Error(`${provider} provider is missing required configuration: ${missing.join(", ")}`);
}

function assertHttpUrl(value: string, label: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label} must use http or https`);
}

async function fetchTransport(request: AuthProviderHttpRequest): Promise<AuthProviderHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {})
  });
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
}

function parseJsonResponse(response: AuthProviderHttpResponse, label: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) throw new Error(`${label} returned HTTP ${response.status}`);
  const parsed = parseMaybeJson(response.body);
  if (!parsed) throw new Error(`${label} returned invalid JSON`);
  return parsed;
}

function parseMaybeJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function extractXmlValue(value: string, tag: string) {
  return value.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"))?.[1];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
