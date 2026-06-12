import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentBridge, CommandResult } from "../agent/orchestrator.js";
import type { AgentRun } from "../domain/types.js";
import { evaluateAgentOutput } from "./eval.js";

export type HarnessPolicy = {
  canWriteFiles: boolean;
  allowedWriteGlobs: string[];
  canRunTests: boolean;
  canUseNetwork: boolean;
  canUseBrowser: boolean;
  maxRetries: number;
  secretsMode: "none" | "redacted" | "local-only";
};

export type HarnessRunInput = {
  runId: string;
  systemId: string;
  agent: AgentRun["agent"];
  contextPackPath: string;
  workingDir: string;
  allowedFiles: string[];
  timeoutMs: number;
  policy: HarnessPolicy;
  args?: string[];
  outputPaths?: string[];
};

export type HarnessRunOutput = {
  status: "succeeded" | "failed" | "blocked" | "timeout";
  stdoutPath: string;
  stderrPath: string;
  artifacts: string[];
  structuredOutputPath: string;
  evalPath: string;
  ledgerPath: string;
  errors: string[];
  durationMs: number;
};

export async function runAgentHarness(
  input: HarnessRunInput,
  agentBridge: AgentBridge
): Promise<HarnessRunOutput> {
  const started = Date.now();
  const runDir = join(input.workingDir, ".brain-creator", "runs", input.runId);
  await mkdir(runDir, { recursive: true });
  const contextContent = await readFile(input.contextPackPath, "utf8");
  await writeFile(join(runDir, "input.context.json"), contextContent, "utf8");
  await writeFile(
    join(runDir, "input.prompt.md"),
    `# Brain Creator ${input.agent} Harness\n\nContext: ${relative(input.workingDir, input.contextPackPath)}`,
    "utf8"
  );

  let commandResult: CommandResult;
  try {
    commandResult = await agentBridge({
      systemId: input.systemId,
      agent: input.agent,
      inputSummary: `Harness ${input.agent} run ${input.runId}`,
      args: input.args ?? [],
      outputPaths: input.outputPaths ?? [],
      cwd: input.workingDir,
      timeoutMs: input.timeoutMs
    });
  } catch (error) {
    commandResult = {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }

  const stdoutPath = join(runDir, "output.raw.txt");
  const stderrPath = join(runDir, "output.stderr.txt");
  await writeFile(stdoutPath, commandResult.stdout, "utf8");
  await writeFile(stderrPath, commandResult.stderr, "utf8");
  const structuredOutput = parseStructuredOutput(commandResult.stdout);
  const structuredOutputPath = join(runDir, "output.structured.json");
  await writeFile(structuredOutputPath, JSON.stringify(structuredOutput, null, 2), "utf8");

  const evalResult = evaluateAgentOutput({
    agent: input.agent,
    outputText: commandResult.stdout,
    context: {
      systemId: input.systemId,
      approved: input.agent === "planner" ? false : true,
      allowedFiles: input.allowedFiles
    }
  });
  const evalPath = join(runDir, "eval.json");
  await writeFile(evalPath, JSON.stringify(evalResult, null, 2), "utf8");
  const status =
    evalResult.verdict === "blocked"
      ? "blocked"
      : commandResult.exitCode === 0
        ? "succeeded"
        : "failed";
  const ledgerPath = join(runDir, "ledger.json");
  await writeFile(
    ledgerPath,
    JSON.stringify(
      {
        runId: input.runId,
        systemId: input.systemId,
        agent: input.agent,
        status,
        durationMs: Date.now() - started
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    status,
    stdoutPath,
    stderrPath,
    artifacts: (input.outputPaths ?? []).filter((path) => isAllowedPath(input.workingDir, path)),
    structuredOutputPath,
    evalPath,
    ledgerPath,
    errors: commandResult.exitCode === 0 ? [] : [commandResult.stderr || commandResult.stdout],
    durationMs: Date.now() - started
  };
}

export const plannerPolicy: HarnessPolicy = {
  canWriteFiles: true,
  allowedWriteGlobs: ["specs/**"],
  canRunTests: false,
  canUseNetwork: false,
  canUseBrowser: false,
  maxRetries: 0,
  secretsMode: "redacted"
};

export const generatorPolicy: HarnessPolicy = {
  canWriteFiles: true,
  allowedWriteGlobs: ["tests/generated/**", "specs/**"],
  canRunTests: true,
  canUseNetwork: false,
  canUseBrowser: true,
  maxRetries: 0,
  secretsMode: "local-only"
};

export const healerPolicy: HarnessPolicy = {
  canWriteFiles: true,
  allowedWriteGlobs: ["tests/generated/**"],
  canRunTests: true,
  canUseNetwork: false,
  canUseBrowser: true,
  maxRetries: 2,
  secretsMode: "local-only"
};

function parseStructuredOutput(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch {
    return { rawText: stdout };
  }
}

function isAllowedPath(root: string, candidate: string) {
  const rootPath = resolve(root);
  const candidatePath = resolve(root, candidate);
  const offset = relative(rootPath, candidatePath);
  return offset !== "" && !offset.startsWith("..") && !isAbsolute(offset);
}
