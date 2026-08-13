// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encryptSecrets } from "../shared/crypto.js";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { materializeBrowserAuthState } from "./authStateMaterializer.js";
import { verifyStoredBrowserAuth } from "./authStateVerifier.js";

const tempDirs: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("browser auth state materializer", () => {
  it("materializes a token into workspace storageState usable by Chromium", async () => {
    const fixture = await localFixture();
    const workDir = await tempDir();
    const result = await materializeBrowserAuthState({
      workDir,
      system: fixture.system,
      authProfile: authProfile("token", { token: "token-secret", localStorageKey: "session_token" })
    });

    const state = JSON.parse(await readFile(result.storageStatePath, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    expect(result.method).toBe("token");
    expect(result.storageStatePath).toContain(join(".brain-creator", "auth"));
    expect(state.origins?.flatMap((origin) => origin.localStorage ?? [])).toContainEqual({
      name: "session_token",
      value: "token-secret"
    });
    await expect(verifyStoredBrowserAuth({
      storageStatePath: result.storageStatePath,
      targetUrl: fixture.system.baseUrl,
      allowedUrls: fixture.system.urlAllowlist
    })).resolves.toEqual(expect.objectContaining({ status: "valid" }));
  }, 30_000);

  it("materializes a cookie header without returning the cookie value", async () => {
    const fixture = await localFixture();
    const workDir = await tempDir();
    const result = await materializeBrowserAuthState({
      workDir,
      system: fixture.system,
      authProfile: authProfile("cookie", { cookie: "session_id=cookie-secret; theme=dark" })
    });
    const state = await readFile(result.storageStatePath, "utf8");

    expect(result.method).toBe("cookie");
    expect(result).not.toHaveProperty("cookie");
    expect(state).toContain("cookie-secret");
    await expect(verifyStoredBrowserAuth({
      storageStatePath: result.storageStatePath,
      targetUrl: fixture.system.baseUrl,
      allowedUrls: fixture.system.urlAllowlist
    })).resolves.toEqual(expect.objectContaining({ status: "valid" }));
  }, 30_000);

  it("rejects password and script profiles instead of guessing a login flow", async () => {
    const fixture = await localFixture();
    await expect(materializeBrowserAuthState({
      workDir: await tempDir(),
      system: fixture.system,
      authProfile: authProfile("password", { password: "secret" })
    })).rejects.toThrow("token or cookie");
  });
});

async function localFixture() {
  const server = createServer((request, response) => {
    const authenticated = request.headers.cookie?.includes("session_id=cookie-secret") ||
      request.headers.cookie?.includes("session_token=token-secret");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Auth Fixture</title><body><script>document.title = document.cookie.includes('session_id=cookie-secret') || localStorage.getItem('session_token') === 'token-secret' ? 'Authenticated' : 'Login';</script></body>`);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  return {
    system: {
      id: "system-auth-fixture",
      name: "Auth Fixture",
      environment: "test",
      baseUrl,
      defaultLocale: "en-US",
      urlAllowlist: [baseUrl],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } satisfies SystemProfile
  };
}

function authProfile(loginMethod: AuthProfile["loginMethod"], secrets: Record<string, string>): AuthProfile {
  return {
    id: `auth-${loginMethod}`,
    projectId: "system-auth-fixture",
    env: "test",
    role: "qa",
    loginMethod,
    encryptedSecrets: encryptSecrets(secrets),
    status: "succeeded",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-auth-materializer-"));
  tempDirs.push(dir);
  return dir;
}
