import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { decryptSecrets } from "../shared/crypto.js";

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
    `export { expect } from "@playwright/test";`
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
    ...formatAuthSetup(loginMethod, secrets),
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
  const workspace = resolve(input.workDir ?? dirname(input.outputDir));
  const candidate = isAbsolute(storageStatePath)
    ? resolve(storageStatePath)
    : resolve(workspace, storageStatePath);
  const lexicalOffset = relative(workspace, candidate);
  if (lexicalOffset.startsWith("..") || isAbsolute(lexicalOffset)) {
    throw new Error("Auth storage state must stay inside the Brain Creator workspace");
  }
  const canonicalWorkspace = await realpath(workspace);
  const canonicalCandidate = await realpath(candidate);
  const offset = relative(canonicalWorkspace, canonicalCandidate);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Auth storage state must stay inside the Brain Creator workspace");
  }
  const parsed = JSON.parse(await readFile(canonicalCandidate, "utf8")) as {
    cookies?: unknown;
    origins?: unknown;
  };
  if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw new Error("Auth storage state must contain cookies and origins arrays");
  }
  return canonicalCandidate;
}

function formatAuthSetup(loginMethod: AuthProfile["loginMethod"], secrets: Record<string, string>) {
  if (loginMethod === "token" && secrets.token) {
    return [
      `    await page.evaluate((token) => window.localStorage.setItem("brain_creator_token", token), ${JSON.stringify(
        secrets.token
      )});`
    ];
  }
  if (loginMethod === "cookie" && secrets.cookie) {
    return [
      `    await page.context().addCookies([{ name: "brain_creator_session", value: ${JSON.stringify(
        secrets.cookie
      )}, url: ${JSON.stringify("http://localhost")} }]);`
    ];
  }
  return [`    // ${loginMethod} auth has no automatic seed setup yet.`];
}
