import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
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
    const command = resolveCommand(input.command);
    const child = spawn(command.path, input.args, {
      cwd: input.cwd,
      shell: command.shell
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

function resolveCommand(command: string) {
  if (process.platform !== "win32") {
    return { path: command, shell: false };
  }
  const resolved = hasPathSegment(command) ? command : resolveFromPath(command);
  return {
    path: resolved,
    shell: isWindowsShellCommand(resolved)
  };
}

function resolveFromPath(command: string) {
  const extensions = command.includes(".") ? [""] : windowsPathExtensions();
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return command;
}

function windowsPathExtensions() {
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  return raw.split(";").filter(Boolean).map((extension) => extension.toLowerCase());
}

function hasPathSegment(command: string) {
  return command.includes("/") || command.includes("\\");
}

function isWindowsShellCommand(command: string) {
  return [".cmd", ".bat", ".ps1"].includes(extname(command).toLowerCase());
}
