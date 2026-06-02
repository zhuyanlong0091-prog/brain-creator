import { spawn } from "node:child_process";
import type { AgentBridge, AgentBridgeInput, CommandResult } from "./orchestrator.js";

type ClaudeSubagentBridgeOptions = {
  command?: string;
  baseArgs?: string[];
  timeoutMs?: number;
};

const agentNames: Record<AgentBridgeInput["agent"], string> = {
  planner: "playwright-test-planner",
  generator: "playwright-test-generator",
  healer: "playwright-test-healer"
};

export function createClaudeSubagentBridge(
  options: ClaudeSubagentBridgeOptions = {}
): AgentBridge {
  return (input) =>
    runClaudeSubagent({
      command: options.command ?? "claude",
      args: options.baseArgs ?? ["--print"],
      stdin: buildSubagentPrompt(input),
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? options.timeoutMs
    });
}

function buildSubagentPrompt(input: AgentBridgeInput) {
  return [
    `Call #${agentNames[input.agent]} subagent.`,
    "",
    `System id: ${input.systemId}`,
    `Task: ${input.inputSummary}`,
    "",
    "Arguments:",
    input.args.length > 0 ? input.args.join(" ") : "(none)",
    "",
    "Expected output paths:",
    input.outputPaths.length > 0 ? input.outputPaths.join("\n") : "(none)"
  ].join("\n");
}

function runClaudeSubagent(input: {
  command: string;
  args: string[];
  stdin: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd
    });
    let stdout = "";
    let stderr = "";
    const timeout =
      input.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill();
            reject(new Error(`Command timed out after ${input.timeoutMs}ms`));
          }, input.timeoutMs);

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
    child.stdin.end(input.stdin);
  });
}
