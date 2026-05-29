import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthProfile, BusinessRule, GlossaryTerm, SystemProfile } from "../domain/types.js";

type BuildAgentPromptInput = {
  outputDir: string;
  system: SystemProfile;
  requirement: string;
  glossaryTerms: GlossaryTerm[];
  businessRules: BusinessRule[];
  authProfiles: AuthProfile[];
};

export async function buildAgentPrompt(input: BuildAgentPromptInput) {
  await mkdir(input.outputDir, { recursive: true });
  const promptPath = join(input.outputDir, `${input.system.id}-prompt.md`);
  const content = [
    `# Brain Creator Planner Context`,
    ``,
    `## Requirement`,
    input.requirement,
    ``,
    `## Business System`,
    `- Name: ${input.system.name}`,
    `- Environment: ${input.system.environment}`,
    `- Base URL: ${input.system.baseUrl}`,
    `- Default locale: ${input.system.defaultLocale}`,
    `- URL allowlist: ${input.system.urlAllowlist.join(", ") || "none"}`,
    ``,
    `## Auth Profiles`,
    ...formatAuthProfiles(input.authProfiles),
    ``,
    `## Glossary`,
    ...formatGlossary(input.glossaryTerms),
    ``,
    `## Business Rules`,
    ...formatRules(input.businessRules),
    ``,
    `## Instructions`,
    `Explore only allowed URLs, use business terms as user-facing intent, and return structured scenarios before code generation.`
  ].join("\n");

  await writeFile(promptPath, content, "utf8");
  return { promptPath, content };
}

function formatAuthProfiles(authProfiles: AuthProfile[]) {
  if (authProfiles.length === 0) {
    return ["- none"];
  }
  return authProfiles.map(
    (profile) =>
      `- ${profile.role} (${profile.env}) via ${profile.loginMethod}; status=${profile.status}; secrets=${Object.keys(
        profile.encryptedSecrets
      )
        .map((key) => `${key}=${profile.encryptedSecrets[key]}`)
        .join(", ")}`
  );
}

function formatGlossary(terms: GlossaryTerm[]) {
  if (terms.length === 0) {
    return ["- none"];
  }
  return terms.map(
    (term) =>
      `- ${term.key}: ${term.zhCN} / ${term.enUS}; aliases=${term.aliases.join(", ") || "none"}; scope=${term.pageScope}`
  );
}

function formatRules(rules: BusinessRule[]) {
  if (rules.length === 0) {
    return ["- none"];
  }
  return rules.map((rule) => `- [${rule.severity}] ${rule.id} ${rule.name}: ${rule.condition}`);
}
