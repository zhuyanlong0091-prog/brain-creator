#!/usr/bin/env node
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";

type DoctorEnv = Record<string, string | undefined>;

export type DoctorCheck = {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  remediation?: string;
};

export type DoctorReport = {
  ok: boolean;
  workspace: string;
  dataFile: string;
  checks: DoctorCheck[];
};

type DoctorOptions = {
  cwd?: string;
  env?: DoctorEnv;
  commandExists?: (command: string, env: DoctorEnv) => boolean;
  fileExists?: (path: string) => boolean;
};

const agentDefinitionFiles = [
  "playwright-test-planner.md",
  "playwright-test-generator.md",
  "playwright-test-healer.md"
];

export function buildDoctorReport(options: DoctorOptions = {}): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const commandExists = options.commandExists ?? commandIsAvailable;
  const fileExists = options.fileExists ?? existsSync;
  const workspace = resolveBrainCreatorWorkspace(cwd, env);
  const dataFile = resolveBrainCreatorDataFile(cwd, env);
  const checks: DoctorCheck[] = [
    {
      name: "Workspace",
      status: "pass",
      message: `Runtime assets will use ${workspace}.`
    },
    {
      name: "Data file",
      status: "pass",
      message: `Local assets file is ${dataFile}.`
    },
    bridgeCommandCheck(env, commandExists),
    bridgeArgsCheck(env),
    bridgeTimeoutCheck(env),
    agentDefinitionsCheck(cwd, fileExists)
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    workspace,
    dataFile,
    checks
  };
}

export function formatDoctorReport(report: DoctorReport) {
  const lines = [
    `Brain Creator doctor: ${report.ok ? "ready" : "action required"}`,
    `Workspace: ${report.workspace}`,
    `Data file: ${report.dataFile}`,
    "",
    ...report.checks.flatMap((check) => [
      `${statusIcon(check.status)} ${check.name}: ${check.message}`,
      ...(check.remediation ? [`   Fix: ${check.remediation}`] : [])
    ])
  ];
  return lines.join("\n");
}

function bridgeCommandCheck(
  env: DoctorEnv,
  commandExists: (command: string, env: DoctorEnv) => boolean
): DoctorCheck {
  const configuredProvider = bridgeProvider(env);
  const detected = detectBridge(env, configuredProvider, commandExists);
  const provider = detected.provider;
  const command = detected.command;
  if (provider === "disabled") {
    return {
      name: "Agent bridge provider",
      status: "fail",
      message: "Agent bridge provider is disabled.",
      remediation: "Set BRAIN_CREATOR_AGENT_PROVIDER=auto, claude, or codex before running real suites."
    };
  }
  if (!command) {
    return {
      name: "Agent bridge provider",
      status: "fail",
      message: "No agent bridge provider is configured or detectable.",
      remediation: "Set BRAIN_CREATOR_AGENT_PROVIDER=auto, claude, or codex before starting Brain Creator MCP."
    };
  }
  if (!commandExists(command, env)) {
    return {
      name: "Agent bridge provider",
      status: "fail",
      message: `${command} is configured but was not found on PATH.`,
      remediation: "Install the selected agent CLI or set the provider command to an available wrapper command."
    };
  }
  return {
    name: "Agent bridge provider",
    status: "pass",
    message: `${provider} provider command ${command} is available.`
  };
}

function bridgeArgsCheck(env: DoctorEnv): DoctorCheck {
  const provider = bridgeProvider(env);
  const args = bridgeArgs(env, provider);
  if (!args) {
    return {
      name: "Agent bridge args",
      status: provider === "auto" ? "pass" : "fail",
      message: provider === "auto" ? "Agent bridge args will use provider defaults." : "Agent bridge args are not configured.",
      remediation: provider === "auto" ? undefined : "Set provider-specific bridge args before starting Brain Creator MCP."
    };
  }
  if ((provider === "claude" || env.BRAIN_CREATOR_AGENT_COMMAND) && !args.includes("--print")) {
    return {
      name: "Agent bridge args",
      status: "warn",
      message: "Claude bridge args do not include --print, so non-interactive runs may hang.",
      remediation: "Include --print in Claude bridge args."
    };
  }
  return {
    name: "Agent bridge args",
    status: "pass",
    message: `${provider} bridge args are configured for non-interactive runs.`
  };
}

function bridgeTimeoutCheck(env: DoctorEnv): DoctorCheck {
  const timeout = Number(env.BRAIN_CREATOR_AGENT_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return {
      name: "Claude bridge timeout",
      status: "warn",
      message: "No positive bridge timeout is configured.",
      remediation: "Set BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000."
    };
  }
  return {
    name: "Agent bridge timeout",
    status: "pass",
    message: `Agent bridge timeout is ${timeout}ms.`
  };
}

function bridgeProvider(env: DoctorEnv) {
  if (env.BRAIN_CREATOR_AGENT_PROVIDER === "claude" || env.BRAIN_CREATOR_AGENT_PROVIDER === "codex" || env.BRAIN_CREATOR_AGENT_PROVIDER === "disabled") {
    return env.BRAIN_CREATOR_AGENT_PROVIDER;
  }
  if (env.BRAIN_CREATOR_AGENT_COMMAND) {
    return "claude";
  }
  return env.BRAIN_CREATOR_AGENT_PROVIDER === "auto" ? "auto" : "auto";
}

function bridgeCommand(env: DoctorEnv, provider: string) {
  if (env.BRAIN_CREATOR_AGENT_COMMAND) {
    return env.BRAIN_CREATOR_AGENT_COMMAND;
  }
  if (provider === "claude") {
    return env.BRAIN_CREATOR_CLAUDE_COMMAND ?? "claude";
  }
  if (provider === "codex") {
    return env.BRAIN_CREATOR_CODEX_COMMAND ?? "codex";
  }
  if (provider === "auto") {
    return env.BRAIN_CREATOR_CLAUDE_COMMAND ?? env.BRAIN_CREATOR_CODEX_COMMAND;
  }
  return undefined;
}

function detectBridge(
  env: DoctorEnv,
  provider: string,
  commandExists: (command: string, env: DoctorEnv) => boolean
) {
  const explicit = bridgeCommand(env, provider);
  if (explicit) {
    return { provider, command: explicit };
  }
  if (provider === "auto") {
    if (commandExists("codex", env)) {
      return { provider: "codex", command: "codex" };
    }
    if (commandExists("claude", env)) {
      return { provider: "claude", command: "claude" };
    }
  }
  return { provider, command: undefined };
}

function bridgeArgs(env: DoctorEnv, provider: string) {
  if (env.BRAIN_CREATOR_AGENT_ARGS) {
    return env.BRAIN_CREATOR_AGENT_ARGS;
  }
  if (provider === "claude") {
    return env.BRAIN_CREATOR_CLAUDE_ARGS;
  }
  if (provider === "codex") {
    return env.BRAIN_CREATOR_CODEX_ARGS;
  }
  return undefined;
}

function agentDefinitionsCheck(
  cwd: string,
  fileExists: (path: string) => boolean
): DoctorCheck {
  const missing = agentDefinitionFiles.filter(
    (file) => !fileExists(join(cwd, ".claude", "agents", file))
  );
  if (missing.length > 0) {
    return {
      name: "Playwright agent definitions",
      status: "fail",
      message: `Missing ${missing.join(", ")}.`,
      remediation: "Run npx playwright init-agents --loop=claude or install the Brain Creator plugin assets."
    };
  }
  return {
    name: "Playwright agent definitions",
    status: "pass",
    message: "Planner, Generator, and Healer agent definitions are present."
  };
}

function commandIsAvailable(command: string, env: DoctorEnv) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const pathDirs = (env.PATH ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? windowsPathExtensions(env) : [""];
  return pathDirs.some((dir) =>
    extensions.some((extension) => existsSync(join(dir, `${command}${extension}`)))
  );
}

function windowsPathExtensions(env: DoctorEnv) {
  const command =
    env.BRAIN_CREATOR_AGENT_COMMAND ??
    env.BRAIN_CREATOR_CLAUDE_COMMAND ??
    env.BRAIN_CREATOR_CODEX_COMMAND ??
    "";
  if (extname(command)) {
    return [""];
  }
  return (env.PATHEXT ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}

function statusIcon(status: DoctorCheck["status"]) {
  if (status === "pass") {
    return "PASS";
  }
  if (status === "warn") {
    return "WARN";
  }
  return "FAIL";
}

if (process.argv[1]?.endsWith("doctor.js")) {
  const report = buildDoctorReport();
  console.log(formatDoctorReport(report));
  process.exit(report.ok ? 0 : 1);
}
