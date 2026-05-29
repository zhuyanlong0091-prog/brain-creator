import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthProfile, SystemProfile } from "../domain/types.js";
import { decryptSecrets } from "../shared/crypto.js";

type GenerateSeedFileInput = {
  outputDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
};

export async function generateSeedFile(input: GenerateSeedFileInput) {
  await mkdir(input.outputDir, { recursive: true });
  const seedPath = join(input.outputDir, `seed-${input.system.id}.spec.ts`);
  const secrets = decryptSecrets(input.authProfile.encryptedSecrets);
  const content = [
    `import { test as base } from "@playwright/test";`,
    ``,
    `export const test = base.extend({`,
    `  page: async ({ page }, use) => {`,
    `    await page.goto(${JSON.stringify(input.system.baseUrl)});`,
    ...formatAuthSetup(input.authProfile.loginMethod, secrets),
    `    await use(page);`,
    `  }`,
    `});`,
    ``,
    `export { expect } from "@playwright/test";`
  ].join("\n");

  await writeFile(seedPath, content, "utf8");
  return {
    seedPath,
    loginMethod: input.authProfile.loginMethod,
    secretKeys: Object.keys(secrets)
  };
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
