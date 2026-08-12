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
  actorJourney?: Array<{ role: string; authProfile: AuthProfile }>;
};

export async function generateSeedFile(input: GenerateSeedFileInput) {
  await mkdir(input.outputDir, { recursive: true });
  const seedPath = join(input.outputDir, `seed-${input.system.id}.spec.ts`);
  const secrets = decryptSecrets(input.authProfile.encryptedSecrets);
  const storageStatePath = await resolveAuthStorageState(input, secrets.storageStatePath);
  const actorRoles = await Promise.all(
    (input.actorJourney ?? []).map(async ({ role, authProfile }) => {
      const roleSecrets = decryptSecrets(authProfile.encryptedSecrets);
      return {
        role,
        storageStatePath: await resolveAuthStorageState(
          { ...input, authProfile },
          roleSecrets.storageStatePath
        ),
        loginMethod: authProfile.loginMethod,
        hasToken: Boolean(roleSecrets.token),
        hasCookie: Boolean(roleSecrets.cookie)
      };
    })
  );
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
    `  },`,
    ...(actorRoles.length ? formatActorRoleHelper(input.system.baseUrl, actorRoles) : []),
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

function formatActorRoleHelper(
  baseUrl: string,
  actorRoles: Array<{
    role: string;
    storageStatePath: string | undefined;
    loginMethod: AuthProfile["loginMethod"];
    hasToken: boolean;
    hasCookie: boolean;
  }>
) {
  const roleConfig = actorRoles
    .map((role) => {
      const envSuffix = role.role.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
      return [
        `    ${JSON.stringify(role.role)}: {`,
        `      storageStatePath: ${role.storageStatePath ? JSON.stringify(role.storageStatePath) : "undefined"},`,
        `      loginMethod: ${JSON.stringify(role.loginMethod)},`,
        `      tokenEnv: ${role.hasToken ? JSON.stringify(`BRAIN_CREATOR_AUTH_TOKEN_${envSuffix}`) : "undefined"},`,
        `      cookieEnv: ${role.hasCookie ? JSON.stringify(`BRAIN_CREATOR_AUTH_COOKIE_${envSuffix}`) : "undefined"}`,
        `    }`
      ].join("\n");
    })
    .join(",\n");
  return [
    `  async runAsRole(browser: { newContext: (options?: Record<string, unknown>) => Promise<any> }, role: string, action: (page: any) => Promise<unknown>) {`,
    `    const roles = {\n${roleConfig}\n    };`,
    `    const config = roles[role as keyof typeof roles];`,
    `    if (!config) throw new Error(\`Unknown Brain Creator actor role: \${role}\`);`,
    `    const context = await browser.newContext(config.storageStatePath ? { storageState: config.storageStatePath } : {});`,
    `    const page = await context.newPage();`,
    `    await page.goto(${JSON.stringify(baseUrl)});`,
    `    if (config.tokenEnv) { const token = process.env[config.tokenEnv]; if (!token) throw new Error(\`Missing auth env \${config.tokenEnv}\`); await page.evaluate((value: string) => window.localStorage.setItem("brain_creator_token", value), token); }`,
    `    if (config.cookieEnv) { const cookie = process.env[config.cookieEnv]; if (!cookie) throw new Error(\`Missing auth env \${config.cookieEnv}\`); await page.context().addCookies([{ name: "brain_creator_session", value: cookie, url: ${JSON.stringify(baseUrl)} }]); }`,
    `    try { return await action(page); } finally { await context.close(); }`,
  ];
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
