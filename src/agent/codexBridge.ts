import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import type { AgentBridgeInput, AgentBridgeWithMetadata, CommandResult } from "./orchestrator.js";

type CodexExecBridgeOptions = {
  command?: string;
  baseArgs?: string[];
  timeoutMs?: number;
  model?: string;
  profile?: string;
};

export function createCodexExecBridge(options: CodexExecBridgeOptions = {}): AgentBridgeWithMetadata {
  const bridge: AgentBridgeWithMetadata = (input) =>
    runCodexExec({
      command: options.command ?? "codex",
      args: codexArgs(options, input),
      stdin: buildCodexPrompt(input),
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? options.timeoutMs
    });
  bridge.provider = "codex";
  bridge.preflight = async () => {
    const command = resolveCommand(options.command ?? "codex");
    if (!hasPathSegment(options.command ?? "codex") && command.path === (options.command ?? "codex")) {
      return {
        ok: false,
        error: `Codex bridge command ${(options.command ?? "codex")} was not found on PATH.`
      };
    }
    return { ok: true };
  };
  return bridge;
}

function codexArgs(options: CodexExecBridgeOptions, input: AgentBridgeInput) {
  const args = [
    ...(options.baseArgs ?? [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "-C",
      "{cwd}",
      "-"
    ])
  ];
  const cwd = input.cwd ?? process.cwd();
  const withCwd = args.map((arg) => (arg === "{cwd}" ? cwd : arg));
  if (options.model) {
    withCwd.splice(1, 0, "--model", options.model);
  }
  if (options.profile) {
    withCwd.splice(1, 0, "--profile", options.profile);
  }
  return withCwd;
}

function buildCodexPrompt(input: AgentBridgeInput) {
  return [
    `You are the Brain Creator ${input.agent} agent.`,
    "",
    "Execution contract:",
    "- This is a non-interactive Brain Creator run.",
    "- Do not ask the user for permission or clarification.",
    "- Keep secrets out of stdout and summaries.",
    "- Write every requested output file exactly where specified.",
    ...agentInstructions(input.agent),
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

function agentInstructions(agent: AgentBridgeInput["agent"]) {
  if (agent === "planner") {
    return [
      "- Planner output must be Markdown in Brain Creator's parser format.",
      "- Use one or more headings exactly like `## Scenario: Scenario title`.",
      "- Include `Priority: critical|high|medium|low` after each scenario heading.",
      "- Write steps as `- navigate: ...`, `- fill: target = value`, `- click: ...`, or `- assert: target => expected`."
    ];
  }
  if (agent === "generator") {
    return [
      "- Generator output must be a complete TypeScript Playwright test file.",
      "- Import from `@playwright/test`.",
      "- Read the `--spec` and `--seed` argument files when present.",
      "- Write the file to the `--output` path.",
      "- The generated test must be runnable by `npx playwright test`."
    ];
  }
  return [
    "- Healer output must repair the failing Playwright test in place.",
    "- Read the `--test` argument file and the `--error` details.",
    "- Edit or rewrite the test file so `npx playwright test` can pass."
  ];
}

function runCodexExec(input: {
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
