import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { decryptSecrets } from "../shared/crypto.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";

type GenerateSeedFileInput = {
  workDir?: string;
  outputDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
};

export async function generateSeedFile(input: GenerateSeedFileInput) {
  await mkdir(input.outputDir, { recursive: true });
  const seedPath = join(input.outputDir, `seed-${input.system.id}.spec.ts`);
  const secrets = decryptSecrets(input.authProfile.encryptedSecrets);
  const storageStatePath = await resolveAuthStorageState(input, secrets.storageStatePath);
  const content = [
    `import { test as base } from "@playwright/test";`,
    ``,
    `export const test = base.extend({`,
    ...formatPageFixture(input.system.baseUrl, input.authProfile.loginMethod, secrets, storageStatePath),
    `});`,
    ``,
    `export { expect } from "@playwright/test";`,
    ``,
    `export const bc = {`,
    `  async step(stepId: string, page: { screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown> }, action: () => Promise<void>) {`,
    `    return base.step(\`bc:\${stepId}\`, async () => {`,
    `      await action();`,
    `      await page.screenshot({ path: base.info().outputPath(\`brain-creator-\${stepId}.png\`), fullPage: true });`,
    `    });`,
    `  }`,
    `};`
  ].join("\n");

  await writeFile(seedPath, content, "utf8");
  return {
    seedPath,
    loginMethod: input.authProfile.loginMethod,
    secretKeys: Object.keys(secrets),
    ...(storageStatePath ? { authState: "storage-state" as const } : {})
  };
}

function formatPageFixture(
  baseUrl: string,
  loginMethod: AuthProfile["loginMethod"],
  secrets: Record<string, string>,
  storageStatePath: string | undefined
) {
  if (storageStatePath) {
    return [
      `  page: async ({ browser }, use) => {`,
      `    const context = await browser.newContext({ storageState: ${JSON.stringify(storageStatePath)} });`,
      `    const page = await context.newPage();`,
      `    await page.goto(${JSON.stringify(baseUrl)});`,
      `    await use(page);`,
      `    await context.close();`,
      `  }`
    ];
  }
  return [
    `  page: async ({ page }, use) => {`,
    `    await page.goto(${JSON.stringify(baseUrl)});`,
    ...formatAuthSetup(loginMethod, secrets, baseUrl),
    `    await use(page);`,
    `  }`
  ];
}

async function resolveAuthStorageState(
  input: GenerateSeedFileInput,
  storageStatePath: string | undefined
) {
  if (input.authProfile.loginMethod !== "script" || !storageStatePath) {
    return undefined;
  }
  const workspace = input.workDir ?? dirname(input.outputDir);
  const protectedPath = await resolveProtectedStorageStatePath(workspace, storageStatePath);
  const parsed = JSON.parse(await readFile(protectedPath, "utf8")) as {
    cookies?: unknown;
    origins?: unknown;
  };
  if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw new Error("Auth storage state must contain cookies and origins arrays");
  }
  return protectedPath;
}

function formatAuthSetup(
  loginMethod: AuthProfile["loginMethod"],
  secrets: Record<string, string>,
  baseUrl: string
) {
  if (loginMethod === "token" && secrets.token) {
    return [
      `    const token = process.env.BRAIN_CREATOR_AUTH_TOKEN;`,
      `    if (!token) throw new Error("BRAIN_CREATOR_AUTH_TOKEN is required for token authentication");`,
      `    await page.evaluate((value) => window.localStorage.setItem("brain_creator_token", value), token);`
    ];
  }
  if (loginMethod === "cookie" && secrets.cookie) {
    return [
      `    const cookie = process.env.BRAIN_CREATOR_AUTH_COOKIE;`,
      `    if (!cookie) throw new Error("BRAIN_CREATOR_AUTH_COOKIE is required for cookie authentication");`,
      `    await page.context().addCookies([{ name: "brain_creator_session", value: cookie, url: ${JSON.stringify(baseUrl)} }]);`
    ];
  }
  return [`    // ${loginMethod} auth has no automatic seed setup yet.`];
}
