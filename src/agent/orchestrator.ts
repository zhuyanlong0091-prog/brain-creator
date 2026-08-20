import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { buildAgentPrompt } from "./promptBuilder.js";
import { generateSeedFile } from "./seedGenerator.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "./caseFormatter.js";
import { checkBusinessRules } from "./qualityGate.js";
import { extractCandidateTerms } from "./termExtractor.js";
import { id } from "../shared/id.js";
import {
  normalizeReporterExitCode,
  parsePlaywrightJsonReport
} from "../execution/playwrightReporter.js";
import { playwrightTestArgs } from "../execution/browserObservation.js";
import { decryptSecrets } from "../shared/crypto.js";
import { redactSensitiveText, scanSensitivePatterns, scanSensitiveValues } from "../shared/secretScan.js";
import type {
  AgentRun,
  AuthProfile,
  BrowserExecutionMode,
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
  actorRoleEvidencePath?: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
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
  protectedSecrets?: Record<string, string>;
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
  actorJourney?: Array<{ role: string; authProfile: AuthProfile }>;
  requiredStepIds?: string[];
  browserMode?: BrowserExecutionMode;
};

export async function runAgent(input: RunAgentInput): Promise<AgentRun> {
  const start = Date.now();
  const invalidOutputPaths = input.outputPaths.filter((outputPath) => {
    const root = resolve(input.cwd ?? process.cwd());
    const offset = relative(root, resolve(root, outputPath));
    return offset.startsWith("..") || /^[A-Za-z]:/.test(offset);
  });
  if (invalidOutputPaths.length > 0) {
    const message = `Agent output path must stay inside the workdir: ${invalidOutputPaths.join(", ")}`;
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
  const redact = (value: string) => redactSensitiveText(value, input.protectedSecrets ?? {});
  const stdout = redact(result.stdout);
  const stderr = redact(result.stderr);
  const logs = [stdout, stderr].map((entry) => entry.trim()).filter(Boolean);
  const outputFindings = await scanAgentOutputFiles(input);
  if (outputFindings.length > 0) {
    logs.push(
      `Sensitive values were redacted from Agent output(s): ${outputFindings.join(", ")}`
    );
  }
  const status = result.exitCode === 0 && outputFindings.length === 0 ? "succeeded" : "failed";

  return {
    id: id("agent"),
    systemId: input.systemId,
    agent: input.agent,
    status,
    inputSummary: input.inputSummary,
    outputPaths: input.outputPaths,
    duration: Date.now() - start,
    logs,
    error:
      status === "failed"
        ? outputFindings.length > 0
          ? `Agent output contained sensitive material: ${outputFindings.join(", ")}`
          : stderr || stdout || "Agent command failed"
        : undefined,
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
    agentBridge: input.agentBridge,
    protectedSecrets: decryptSecrets(input.authProfile.encryptedSecrets)
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
    authProfile: input.authProfile,
    actorJourney: input.actorJourney
  });
  const protectedSecrets = Object.fromEntries(
    [input.authProfile, ...(input.actorJourney ?? []).map((actor) => actor.authProfile)]
      .flatMap((profile) => Object.entries(decryptSecrets(profile.encryptedSecrets)))
  );
  const generateRun = await runAgent({
    systemId: input.system.id,
    agent: "generator",
    inputSummary: input.testCase.requirement,
    args: ["--spec", specPath, "--seed", seed.seedPath, "--output", testPath],
    outputPaths: [testPath],
    cwd: input.workDir,
    agentBridge: input.agentBridge,
    protectedSecrets
  });

  const runner = input.runner ?? spawnCommand;
  const structuredReporterEnabled = input.structuredReporter ?? !input.runner;
  const runPlaywright = async (): Promise<CommandResult> => {
    const generatedSource = await readGeneratedSource(testPath);
    if (structuredReporterEnabled && !generatedSource?.trim()) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Generated Playwright test file is missing or empty; strict execution is blocked."
      };
    }
    if (generatedSource) {
      const secretFindings = scanGeneratedSourceSecrets(
        generatedSource,
        [input.authProfile, ...(input.actorJourney ?? []).map((actor) => actor.authProfile)]
      );
      if (secretFindings.length > 0) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Generated test contains sensitive material: ${secretFindings.join(", ")}`
        };
      }
    }
    if (input.actorJourney && input.actorJourney.length > 1) {
      const source = await readFile(testPath, "utf8");
      const journeyCheck = validateActorJourneyUsage(source, input.actorJourney);
      if (!journeyCheck.valid) {
        return { exitCode: 1, stdout: "", stderr: journeyCheck.reason };
      }
    }
    if (input.requiredStepIds?.length) {
      const source = await readFile(testPath, "utf8");
      const instrumentationCheck = validateStepInstrumentation(source, input.requiredStepIds);
      if (!instrumentationCheck.valid) {
        return { exitCode: 1, stdout: "", stderr: instrumentationCheck.reason };
      }
    }
    const args = playwrightTestArgs(testRunPath, {
      browserMode: input.browserMode,
      structuredReporter: structuredReporterEnabled
    });
    const actorRoleEvidencePath =
      input.actorJourney && input.actorJourney.length > 1
        ? join(input.workDir, ".brain-creator", "runs", input.testCase.id, "actor-journey.jsonl")
        : undefined;
    if (actorRoleEvidencePath) await mkdir(dirname(actorRoleEvidencePath), { recursive: true });
    const rawResult = await runner("npx", args, {
      cwd: input.workDir,
      ...(actorRoleEvidencePath
        ? { env: { ...process.env, BRAIN_CREATOR_ACTOR_EVIDENCE_PATH: actorRoleEvidencePath } }
        : {})
    });
    const result = {
      ...rawResult,
      stdout: redactSensitiveText(rawResult.stdout, protectedSecrets),
      stderr: redactSensitiveText(rawResult.stderr, protectedSecrets)
    };
    if (actorRoleEvidencePath && input.actorJourney) {
      const roleCheck = await verifyActorRoleEvidence(actorRoleEvidencePath, input.actorJourney);
      if (!roleCheck.valid) {
        return {
          ...result,
          exitCode: 1,
          stderr: [result.stderr, roleCheck.reason].filter(Boolean).join("\n"),
          actorRoleEvidencePath
        };
      }
    }
    if (!structuredReporterEnabled) {
      return { ...result, ...(actorRoleEvidencePath ? { actorRoleEvidencePath } : {}) };
    }
    const reporter = parseReporterOutput(result.stdout);
    if (!reporter) {
      return {
        ...result,
        exitCode: result.exitCode === 0 ? 1 : result.exitCode,
        stderr: [
          result.stderr,
          "Structured Playwright Reporter output was missing; execution is not auditable."
        ].filter(Boolean).join("\n"),
        ...(actorRoleEvidencePath ? { actorRoleEvidencePath } : {})
      };
    }
    const reporterPath = join(
      input.workDir,
      ".brain-creator",
      "runs",
      input.testCase.id,
      "playwright-report.json"
    );
    await mkdir(dirname(reporterPath), { recursive: true });
    const safeReporter = redactStructuredReporter(reporter, protectedSecrets);
    await writeFile(reporterPath, `${JSON.stringify(safeReporter, null, 2)}\n`, "utf8");
    return {
      ...result,
      exitCode: normalizeReporterExitCode(result.exitCode, reporter),
      structuredReporter: safeReporter,
      reporterPath,
      ...(actorRoleEvidencePath ? { actorRoleEvidencePath } : {})
    };
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
  const maxHealAttempts = input.maxHealAttempts ?? 2;

  for (
    let attempt = 0;
    generateRun.status === "succeeded" && testResult.exitCode !== 0 && attempt < maxHealAttempts;
    attempt += 1
  ) {
    const beforeHealSource = await readGeneratedSource(testPath);
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
      agentBridge: input.agentBridge,
      protectedSecrets
    });
    const afterHealSource = await readGeneratedSource(testPath);
    const mutationCheck = beforeHealSource && afterHealSource
      ? validateHealerMutation(beforeHealSource, afterHealSource, input.requiredStepIds ?? [])
      : beforeHealSource && !afterHealSource
        ? { valid: false as const, reason: "Healer removed the generated test file." }
        : { valid: true as const };
    const guardedHealerRun = !mutationCheck.valid
      ? {
          ...healerRun,
          status: "failed" as const,
          error: mutationCheck.reason,
          logs: [...healerRun.logs, mutationCheck.reason]
        }
      : healerRun;
    healerRuns.push(guardedHealerRun);
    if (guardedHealerRun.status !== "succeeded") {
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

async function scanAgentOutputFiles(input: RunAgentInput) {
  const findings: string[] = [];
  const root = resolve(input.cwd ?? process.cwd());
  for (const outputPath of [...new Set(input.outputPaths)]) {
    const path = resolve(root, outputPath);
    const offset = relative(root, path);
    if (offset.startsWith("..") || /^[A-Za-z]:/.test(offset)) {
      findings.push(`${outputPath} (outside-workdir)`);
      continue;
    }
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const matches = [
      ...scanSensitiveValues(source, input.protectedSecrets ?? {}).map(
        (finding) => `credential:${finding.secretKey}`
      ),
      ...scanSensitivePatterns(source).map((finding) => `pattern:${finding.rule}`)
    ];
    if (matches.length === 0) continue;
    await writeFile(path, redactSensitiveText(source, input.protectedSecrets ?? {}), "utf8");
    findings.push(`${outputPath} (${[...new Set(matches)].join(", ")})`);
  }
  return findings;
}

async function readGeneratedSource(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function scanGeneratedSourceSecrets(source: string, profiles: AuthProfile[]) {
  const protectedValues = profiles.flatMap((profile) => {
    try {
      return Object.entries(decryptSecrets(profile.encryptedSecrets));
    } catch {
      return [];
    }
  });
  return [
    ...scanSensitiveValues(source, Object.fromEntries(protectedValues)).map(
      (finding) => `credential:${finding.secretKey}`
    ),
    ...scanSensitivePatterns(source).map((finding) => `pattern:${finding.rule}`)
  ];
}

export function validateActorJourneyUsage(
  source: string,
  actorJourney: Array<{ role: string }>
) {
  if (actorJourney.length <= 1) return { valid: true as const };
  if (!/\bbc\.runAsRole\s*\(/.test(source)) {
    return {
      valid: false as const,
      reason: "Generated test must call bc.runAsRole for a multi-role actor journey."
    };
  }
  const missingRoles = actorJourney
    .map((actor) => actor.role)
    .filter(
      (role) =>
        !source.includes(JSON.stringify(role)) &&
        !source.includes(`'${role}'`) &&
        !source.includes(`\"${role}\"`)
    );
  if (missingRoles.length > 0) {
    return {
      valid: false as const,
      reason: `Generated test does not reference actor role(s): ${missingRoles.join(", ")}.`
    };
  }
  return { valid: true as const };
}

export function validateStepInstrumentation(source: string, stepIds: string[]) {
  const executableSource = removeSourceComments(source);
  const missingStepIds = stepIds.filter(
    (stepId) =>
      !executableSource.includes(`bc.step(${JSON.stringify(stepId)}`) &&
      !executableSource.includes(`bc.step('${stepId}'`) &&
      !executableSource.includes(`bc.step("${stepId}"`)
  );
  return missingStepIds.length
    ? {
        valid: false as const,
        reason: `Generated test is missing bc.step instrumentation for: ${missingStepIds.join(", ")}.`
      }
    : { valid: true as const };
}

export function validateHealerMutation(
  beforeSource: string,
  afterSource: string,
  requiredStepIds: string[]
) {
  const before = removeSourceComments(beforeSource);
  const after = removeSourceComments(afterSource);
  if (/\b(?:test|it|describe)\.skip\s*\(/.test(after)) {
    return { valid: false as const, reason: "Healer introduced a skipped test." };
  }
  if (/\b(?:test|it|describe)\.only\s*\(/.test(after)) {
    return { valid: false as const, reason: "Healer introduced an isolated test.only/it.only/describe.only." };
  }
  const instrumentation = validateStepInstrumentation(after, requiredStepIds);
  if (!instrumentation.valid) return instrumentation;
  const beforeAssertions = countAssertions(before);
  const afterAssertions = countAssertions(after);
  if (afterAssertions < beforeAssertions) {
    return {
      valid: false as const,
      reason: `Healer removed assertion(s): ${beforeAssertions} before, ${afterAssertions} after.`
    };
  }
  return { valid: true as const };
}

function countAssertions(source: string) {
  return (source.match(/\bexpect(?:\.soft)?\s*\(|\bassert(?:\.[A-Za-z]+)?\s*\(/g) ?? []).length;
}

function removeSourceComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/.*$/gm, "$1");
}

async function verifyActorRoleEvidence(
  evidencePath: string,
  actorJourney: Array<{ role: string; authProfile: AuthProfile }>
) {
  let content: string;
  try {
    content = await readFile(evidencePath, "utf8");
  } catch {
    return {
      valid: false as const,
      reason: "Multi-role execution did not produce runtime actor evidence."
    };
  }
  const observedRoles = new Set<string>();
  const observedEnteredRoles: string[] = [];
  const observedEnteredAuthProfiles: Array<{ role: string; authProfileId?: string }> = [];
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        role?: unknown;
        authProfileId?: unknown;
        event?: unknown;
      };
      if (typeof event.role === "string") {
        observedRoles.add(event.role);
        if (event.event === "entered") {
          observedEnteredRoles.push(event.role);
          observedEnteredAuthProfiles.push({
            role: event.role,
            authProfileId:
              typeof event.authProfileId === "string" ? event.authProfileId : undefined
          });
        }
      }
    } catch {
      return {
        valid: false as const,
        reason: "Runtime actor evidence is not valid JSONL."
      };
    }
  }
  const missingRoles = actorJourney
    .map((actor) => actor.role)
    .filter((role) => !observedRoles.has(role));
  if (missingRoles.length > 0) {
    return {
      valid: false as const,
      reason: `Runtime actor evidence is missing role(s): ${missingRoles.join(", ")}.`
    };
  }
  const expectedAuthProfiles = new Map(
    actorJourney.map((actor) => [actor.role, actor.authProfile.id])
  );
  const authProfileMismatches = observedEnteredAuthProfiles.filter(
    (event) => event.authProfileId !== expectedAuthProfiles.get(event.role)
  );
  if (authProfileMismatches.length > 0) {
    return {
      valid: false as const,
      reason: `Runtime actor evidence maps role(s) to an unexpected AuthProfile: ${authProfileMismatches.map((event) => event.role).join(", ")}.`
    };
  }
  const declaredRoles = actorJourney.map((actor) => actor.role);
  const unknownRoles = [...observedRoles].filter((role) => !declaredRoles.includes(role));
  if (unknownRoles.length > 0) {
    return {
      valid: false as const,
      reason: `Runtime actor evidence contains undeclared role(s): ${unknownRoles.join(", ")}.`
    };
  }
  let nextDeclaredRole = 0;
  for (const role of observedEnteredRoles) {
    if (role === declaredRoles[nextDeclaredRole]) nextDeclaredRole += 1;
    if (nextDeclaredRole === declaredRoles.length) break;
  }
  if (nextDeclaredRole < declaredRoles.length) {
    return {
      valid: false as const,
      reason: `Runtime actor evidence does not follow the declared role order: ${declaredRoles.join(" -> ")}.`
    };
  }
  return { valid: true as const };
}

function parseReporterOutput(output: string): StructuredReporterResult | undefined {
  try {
    return parsePlaywrightJsonReport(JSON.parse(output));
  } catch {
    return undefined;
  }
}

function redactStructuredReporter(
  reporter: StructuredReporterResult,
  secrets: Record<string, string>
) {
  try {
    return JSON.parse(
      redactSensitiveText(JSON.stringify(reporter), secrets)
    ) as StructuredReporterResult;
  } catch {
    return reporter;
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
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const normalized = normalizeCommand(command, args);
    const child = spawn(normalized.command, normalized.args, {
      cwd: options.cwd,
      env: options.env
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
