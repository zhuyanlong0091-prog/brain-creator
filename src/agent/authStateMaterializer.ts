import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { decryptSecrets } from "../shared/crypto.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import { browserExecutablePath } from "./authStateVerifier.js";

export type AuthStateMaterializer = (input: {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
}) => Promise<{ storageStatePath: string; method: "token" | "cookie" }>;

/**
 * Materialize the two auth formats Brain Creator can safely interpret without
 * guessing a product-specific login flow: localStorage token and Cookie header.
 */
export const materializeBrowserAuthState: AuthStateMaterializer = async (input) => {
  const secrets = decryptSecrets(input.authProfile.encryptedSecrets);
  const method = input.authProfile.loginMethod;
  if (method !== "token" && method !== "cookie") {
    throw new Error("Automatic auth materialization supports token or cookie profiles only");
  }
  if (method === "token" && !secrets.token) {
    throw new Error("Token auth profile does not contain a token");
  }
  if (method === "cookie" && !secrets.cookie) {
    throw new Error("Cookie auth profile does not contain a cookie header");
  }

  const outputPath = await resolveProtectedStorageStatePath(
    input.workDir,
    join(".brain-creator", "auth", safePart(input.system.id), safePart(input.authProfile.id), "storage-state.json")
  );
  const authDir = join(outputPath, "..");
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  await chmod(authDir, 0o700).catch(() => undefined);
  const executablePath = browserExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (method === "token") {
      const key = secrets.tokenStorageKey || secrets.localStorageKey || "brain_creator_token";
      await page.addInitScript(
        `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(secrets.token)});`
      );
    } else {
      await context.addCookies(parseCookieHeader(secrets.cookie!, input.system.baseUrl));
    }
    await page.goto(input.system.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000
    });
    await context.storageState({ path: outputPath });
    await chmod(outputPath, 0o600).catch(() => undefined);
    await context.close();
  } finally {
    await browser.close();
  }
  return { storageStatePath: outputPath, method };
};

function parseCookieHeader(value: string, url: string) {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) throw new Error("Cookie header contains an invalid cookie pair");
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        url
      };
    });
}

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
