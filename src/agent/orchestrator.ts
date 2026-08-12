import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { buildAgentPrompt } from "./promptBuilder.js";
import { generateSeedFile } from "./seedGenerator.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "./caseFormatter.js";
import { checkBusinessRules } from "./qualityGate.js";
import { extractCandidateTerms } from "./termExtractor.js";
import { id } from "../shared/id.js";
import { parsePlaywrightJsonReport } from "../execution/playwrightReporter.js";
import type {
  AgentRun,
  AuthProfile,
  BusinessRule,
  ChainRun,
  Gap,
  GlossaryTerm,
  SystemProfile,
  TestCase,
  StructuredReporterResult
} from "../domain/types.js";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  structuredReporter?: StructuredReporterResult;
  reporterPath?: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
) => Promise<CommandResult>;

export type AgentBridgeInput = {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  cwd?: string;
  timeoutMs?: number;
};

export type AgentBridge = (input: AgentBridgeInput) => Promise<CommandResult>;
export type AgentBridgePreflight = () => Promise<Omit<BridgePreflight, "checkedAt">>;
export type AgentBridgeWithMetadata = AgentBridge & {
  provider?: string;
  preflight?: AgentBridgePreflight;
};

export type BridgePreflight = {
  ok: boolean;
  error?: string;
  checkedAt: string;
};

/**
 * Agent Bridge 可用性预检（preflight）。
 * 在 planner/generator/healer 执行前调用，5 秒内确认桥接器是否可达。
 * bridge 未配置或不可达时返回结构化错误，避免进入 120s 超时。
 */
export async function preflightAgentBridge(
  bridge: AgentBridgeWithMetadata | undefined,
  timeoutMs = 5000
): Promise<BridgePreflight> {
  if (!bridge) {
    return {
      ok: false,
      error:
        "Agent bridge not configured. Set BRAIN_CREATOR_AGENT_COMMAND to enable Planner/Generator/Healer.",
      checkedAt: new Date().toISOString()
    };
  }
  if (bridge.preflight) {
    try {
      const result = await withTimeout(bridge.preflight(), timeoutMs);
      return { ...result, checkedAt: new Date().toISOString() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Agent bridge preflight failed (${timeoutMs}ms timeout): ${message}`,
        checkedAt: new Date().toISOString()
      };
    }
  }
  try {
    const result = await withTimeout(
      bridge({
        systemId: "_preflight",
        agent: "planner",
        inputSummary: "preflight-ping",
        args: [],
        outputPaths: []
      }),
      timeoutMs
    );
    // bridge 有响应（即使是参数错误）说明桥接器存活
    return { ok: true, checkedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Agent bridge unreachable (${timeoutMs}ms timeout): ${message}`,
      checkedAt: new Date().toISOString()
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    )
  ]);
}

type RunAgentInput = {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  agentBridge?: AgentBridge;
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
  agentBridge?: AgentBridge;
};

type RunChainInput = {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  testCase: TestCase;
  agentBridge?: AgentBridge;
  runner?: CommandRunner;
  maxHealAttempts?: number;
  knowledgeContext?: string;
  structuredReporter?: boolean;
};

export async function runAgent(input: RunAgentInput): Promise<AgentRun> {
  const start = Date.now();
  const agentBridge = input.agentBridge ?? missingAgentBridge;
  let result: CommandResult;
  try {
    result = await agentBridge(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: id("agent"),
      systemId: input.systemId,
      agent: input.agent,
      status: "failed",
      inputSummary: input.inputSummary,
      outputPaths: input.outputPaths,
      duration: Date.now() - start,
      logs: [message],
      error: message,
      createdAt: new Date().toISOString()
    };
  }
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

export function commandRunnerAgentBridge(runner: CommandRunner): AgentBridge {
  return (input) =>
    runner("npx", ["playwright", "agent", input.agent, ...input.args], {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs
    });
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
    workDir: input.workDir,
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
    agentBridge: input.agentBridge
  });
  if (agentRun.status !== "succeeded") {
    throw new Error(agentRun.error ?? "Planner agent failed");
  }

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
  const testRunPath = relative(input.workDir, testPath).replace(/\\/g, "/");
  await mkdir(specsDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    specPath,
    [formatScenariosAsMarkdown(input.testCase.scenarios), input.knowledgeContext]
      .filter(Boolean)
      .join("\n\n"),
    "utf8"
  );

  const seed = await generateSeedFile({
    workDir: input.workDir,
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
    agentBridge: input.agentBridge
  });

  const runner = input.runner ?? spawnCommand;
  const structuredReporterEnabled = input.structuredReporter ?? !input.runner;
  const runPlaywright = async (): Promise<CommandResult> => {
    const args = ["playwright", "test", testRunPath];
    if (structuredReporterEnabled) args.push("--reporter=json");
    const result = await runner("npx", args, { cwd: input.workDir });
    if (!structuredReporterEnabled) return result;
    const reporter = parseReporterOutput(result.stdout);
    if (!reporter) return result;
    const reporterPath = join(
      input.workDir,
      ".brain-creator",
      "runs",
      input.testCase.id,
      "playwright-report.json"
    );
    await mkdir(dirname(reporterPath), { recursive: true });
    await writeFile(reporterPath, `${JSON.stringify(reporter, null, 2)}\n`, "utf8");
    return { ...result, structuredReporter: reporter, reporterPath };
  };
  let testResult: CommandResult =
    generateRun.status === "succeeded"
      ? await runPlaywright()
      : {
          exitCode: 1,
          stdout: "",
          stderr: generateRun.error ?? "Generator agent failed"
        };
  const healerRuns: AgentRun[] = [];
  const maxHealAttempts = input.maxHealAttempts ?? 3;

  for (
    let attempt = 0;
    generateRun.status === "succeeded" && testResult.exitCode !== 0 && attempt < maxHealAttempts;
    attempt += 1
  ) {
    const healerRun = await runAgent({
      systemId: input.system.id,
      agent: "healer",
      inputSummary: `Heal ${input.testCase.requirement}`,
      args: [
        "--test",
        testPath,
        "--seed",
        seed.seedPath,
        "--error",
        testResult.stderr || testResult.stdout
      ],
      outputPaths: [testPath],
      cwd: input.workDir,
      agentBridge: input.agentBridge
    });
    healerRuns.push(healerRun);
    if (healerRun.status !== "succeeded") {
      break;
    }
    testResult = await runPlaywright();
  }

  const status = generateRun.status === "succeeded" && testResult.exitCode === 0 ? "succeeded" : "failed";
  const gaps =
    status === "failed"
      ? [
          createGap(
            input.system.id,
            "healer-skip",
            input.testCase.id,
            testResult.stderr || testResult.stdout || generateRun.error || "Generated test chain failed"
          )
        ]
      : [];
  const chainRun: ChainRun = {
    id: id("chain"),
    systemId: input.system.id,
    testCaseId: input.testCase.id,
    status,
    generateRunId: generateRun.id,
    healRunId: healerRuns.at(-1)?.id,
    specPath,
    testPath,
    gaps,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };

  return {
    chainRun,
    generateRun,
    healerRuns,
    specPath,
    testPath,
    testResult
  };
}

function parseReporterOutput(output: string): StructuredReporterResult | undefined {
  try {
    return parsePlaywrightJsonReport(JSON.parse(output));
  } catch {
    return undefined;
  }
}

async function missingAgentBridge(): Promise<CommandResult> {
  return {
    exitCode: 1,
    stdout: "",
    stderr:
      "Claude subagent bridge required: current Playwright CLI does not expose `playwright agent`; provide an AgentBridge or run through Claude subagents."
  };
}

export async function spawnCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const normalized = normalizeCommand(command, args);
    const child = spawn(normalized.command, normalized.args, {
      cwd: options.cwd
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

function normalizeCommand(command: string, args: string[]) {
  if (command === "npx" && args[0] === "playwright") {
    return {
      command: process.execPath,
      args: [join(process.cwd(), "node_modules", "@playwright", "test", "cli.js"), ...args.slice(1)]
    };
  }
  return { command, args };
}

function safeAuthSummary(profile: AuthProfile): AuthProfile {
  return {
    ...profile,
    encryptedSecrets: Object.fromEntries(
      Object.keys(profile.encryptedSecrets).map((key) => [key, "[REDACTED]"])
    )
  };
}

function createGap(projectId: string, sourceType: string, sourceId: string, reason: string): Gap {
  const now = new Date().toISOString();
  return {
    id: id("gap"),
    projectId,
    sourceType,
    sourceId,
    reason,
    severity: "high",
    owner: "qa",
    status: "open",
    createdAt: now,
    updatedAt: now
  };
}
