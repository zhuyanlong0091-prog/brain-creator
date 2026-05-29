import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildAgentPrompt } from "./promptBuilder.js";
import { generateSeedFile } from "./seedGenerator.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "./caseFormatter.js";
import { checkBusinessRules } from "./qualityGate.js";
import { extractCandidateTerms } from "./termExtractor.js";
import { id } from "../shared/id.js";
import type {
  AgentRun,
  AuthProfile,
  BusinessRule,
  ChainRun,
  GlossaryTerm,
  SystemProfile,
  TestCase
} from "../domain/types.js";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
) => Promise<CommandResult>;

type RunAgentInput = {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  runner?: CommandRunner;
  cwd?: string;
  timeoutMs?: number;
};

type GeneratePlanDraftInput = {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  requirement: string;
  glossaryTerms: GlossaryTerm[];
  businessRules: BusinessRule[];
  specPath: string;
  runner?: CommandRunner;
};

type RunChainInput = {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  testCase: TestCase;
  runner?: CommandRunner;
};

export async function runAgent(input: RunAgentInput): Promise<AgentRun> {
  const start = Date.now();
  const runner = input.runner ?? spawnCommand;
  const result = await runner(
    "npx",
    ["playwright", "agent", input.agent, ...input.args],
    { cwd: input.cwd, timeoutMs: input.timeoutMs }
  );
  const logs = [result.stdout, result.stderr].map((entry) => entry.trim()).filter(Boolean);
  const status = result.exitCode === 0 ? "succeeded" : "failed";

  return {
    id: id("agent"),
    systemId: input.systemId,
    agent: input.agent,
    status,
    inputSummary: input.inputSummary,
    outputPaths: input.outputPaths,
    duration: Date.now() - start,
    logs,
    error: status === "failed" ? result.stderr || result.stdout || "Agent command failed" : undefined,
    createdAt: new Date().toISOString()
  };
}

export async function generatePlanDraft(input: GeneratePlanDraftInput) {
  const contextDir = join(input.workDir, "specs", "_context");
  const seedDir = join(input.workDir, "tests");
  const prompt = await buildAgentPrompt({
    outputDir: contextDir,
    system: input.system,
    requirement: input.requirement,
    glossaryTerms: input.glossaryTerms,
    businessRules: input.businessRules,
    authProfiles: [safeAuthSummary(input.authProfile)]
  });
  const seed = await generateSeedFile({
    outputDir: seedDir,
    system: input.system,
    authProfile: input.authProfile
  });

  await mkdir(dirname(input.specPath), { recursive: true });
  const agentRun = await runAgent({
    systemId: input.system.id,
    agent: "planner",
    inputSummary: input.requirement,
    args: ["--prompt", prompt.promptPath, "--seed", seed.seedPath, "--output", input.specPath],
    outputPaths: [input.specPath],
    cwd: input.workDir,
    runner: input.runner
  });

  const specContent = await readFile(input.specPath, "utf8");
  const scenarios = parseSpecMarkdown(specContent);
  const ruleCheckResult = checkBusinessRules({
    specContent,
    rules: input.businessRules
  });
  const newTerms = extractCandidateTerms({
    systemId: input.system.id,
    specContent,
    existingTerms: input.glossaryTerms,
    pageScope: "/"
  });

  return {
    agentRun,
    promptPath: prompt.promptPath,
    seedPath: seed.seedPath,
    specPath: input.specPath,
    scenarios,
    ruleCheckResult,
    newTerms
  };
}

export async function runChain(input: RunChainInput) {
  if (input.testCase.status !== "approved") {
    throw new Error("Test case must be approved before running chain");
  }

  const specsDir = join(input.workDir, "specs");
  const generatedDir = join(input.workDir, "tests", "generated");
  const specPath = join(specsDir, `${input.testCase.id}.md`);
  const testPath = join(generatedDir, `${input.testCase.id}.spec.ts`);
  await mkdir(specsDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
  await writeFile(specPath, formatScenariosAsMarkdown(input.testCase.scenarios), "utf8");

  const seed = await generateSeedFile({
    outputDir: join(input.workDir, "tests"),
    system: input.system,
    authProfile: input.authProfile
  });
  const generateRun = await runAgent({
    systemId: input.system.id,
    agent: "generator",
    inputSummary: input.testCase.requirement,
    args: ["--spec", specPath, "--seed", seed.seedPath, "--output", testPath],
    outputPaths: [testPath],
    cwd: input.workDir,
    runner: input.runner
  });

  const runner = input.runner ?? spawnCommand;
  const testResult = await runner("npx", ["playwright", "test", testPath], {
    cwd: input.workDir
  });
  const status = generateRun.status === "succeeded" && testResult.exitCode === 0 ? "succeeded" : "failed";
  const chainRun: ChainRun = {
    id: id("chain"),
    systemId: input.system.id,
    testCaseId: input.testCase.id,
    status,
    generateRunId: generateRun.id,
    specPath,
    testPath,
    gaps: [],
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };

  return {
    chainRun,
    generateRun,
    specPath,
    testPath
  };
}

export async function spawnCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill();
            reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

function safeAuthSummary(profile: AuthProfile): AuthProfile {
  return {
    ...profile,
    encryptedSecrets: Object.fromEntries(
      Object.keys(profile.encryptedSecrets).map((key) => [key, "[REDACTED]"])
    )
  };
}
