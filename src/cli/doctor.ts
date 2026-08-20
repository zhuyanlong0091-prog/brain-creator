#!/usr/bin/env node
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorStoreDir,
  resolveBrainCreatorKnowledgeDir,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import { inspectStoreHealth, type StoreHealth } from "../storage/storeDoctor.js";
import { isCliEntryPoint } from "./entrypoint.js";

type DoctorEnv = Record<string, string | undefined>;
type SupportedBridgeProvider = "auto" | "claude" | "codex" | "host-agent" | "disabled";

export type DoctorCheck = {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  remediation?: string;
};

export type DoctorAgentBridge = {
  provider: SupportedBridgeProvider | "invalid";
  configuredProvider?: string;
  command?: string;
  recommendedAction: string;
};

export type DoctorReport = {
  ok: boolean;
  workspace: string;
  dataFile: string;
  storeDir: string;
  knowledgeDir: string;
  toolProfile: "facade" | "full" | "invalid";
  connectors: { feishu: "direct" | "host-fallback" | "invalid" };
  agentBridge: DoctorAgentBridge;
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
const supportedBridgeProviders: SupportedBridgeProvider[] = [
  "auto",
  "claude",
  "codex",
  "host-agent",
  "disabled"
];

export function buildDoctorReport(options: DoctorOptions = {}): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const commandExists = options.commandExists ?? commandIsAvailable;
  const fileExists = options.fileExists ?? existsSync;
  const workspace = resolveBrainCreatorWorkspace(cwd, env);
  const dataFile = resolveBrainCreatorDataFile(cwd, env);
  const storeDir = resolveBrainCreatorStoreDir(cwd, env);
  const knowledgeDir = resolveBrainCreatorKnowledgeDir(cwd, env);
  const toolProfile = doctorToolProfile(env);
  const feishu = doctorFeishuMode(env);
  const agentBridge = resolveDoctorAgentBridge(env, commandExists);
  const storage = inspectStoreHealth({ storeDir, legacyPath: dataFile });
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
    {
      name: "Knowledge directory",
      status: "pass",
      message: `Generated knowledge will use ${knowledgeDir}.`
    },
    storageCheck(storage),
    legacyArtifactCheck(workspace, fileExists),
    toolProfileCheck(toolProfile),
    feishuConnectorCheck(feishu),
    bridgeCommandCheck(env, commandExists, agentBridge),
    bridgeArgsCheck(env),
    bridgeTimeoutCheck(env),
    playwrightBrowserCheck(env, fileExists),
    agentDefinitionsCheck(cwd, fileExists)
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    workspace,
    dataFile,
    storeDir,
    knowledgeDir,
    toolProfile,
    connectors: { feishu },
    agentBridge,
    checks
  };
}

export function formatDoctorReport(report: DoctorReport) {
  const lines = [
    `Brain Creator doctor: ${report.ok ? "ready" : "action required"}`,
    `Workspace: ${report.workspace}`,
    `Data file: ${report.dataFile}`,
    `Store directory: ${report.storeDir}`,
    `Knowledge directory: ${report.knowledgeDir}`,
    `Tool profile: ${report.toolProfile}`,
    `Feishu connector: ${report.connectors.feishu}`,
    `Agent provider: ${report.agentBridge.provider}${
      report.agentBridge.command ? ` (${report.agentBridge.command})` : ""
    }`,
    `Recommended action: ${report.agentBridge.recommendedAction}`,
    "Codex plugin setup: run npx brain-creator-install-codex-plugin in the business project.",
    "",
    ...report.checks.flatMap((check) => [
      `${statusIcon(check.status)} ${check.name}: ${check.message}`,
      ...(check.remediation ? [`   Fix: ${check.remediation}`] : [])
    ])
  ];
  return lines.join("\n");
}

function storageCheck(storage: StoreHealth): DoctorCheck {
  return {
    name: "Sharded store",
    status: storage.status,
    message: storage.message,
    remediation: storage.remediation
  };
}

function legacyArtifactCheck(
  workspace: string,
  fileExists: (path: string) => boolean
): DoctorCheck {
  const legacyPaths = [join(workspace, "specs"), join(workspace, "tests", "generated")]
    .filter(fileExists);
  if (legacyPaths.length === 0) {
    return {
      name: "Artifact ownership",
      status: "pass",
      message: "No legacy root artifact directories were detected."
    };
  }
  return {
    name: "Artifact ownership",
    status: "warn",
    message: `Legacy artifact directories need review: ${legacyPaths.join(", ")}.`,
    remediation: "Run brain-creator artifacts migrate for a dry-run before confirming migration."
  };
}

function bridgeCommandCheck(
  env: DoctorEnv,
  commandExists: (command: string, env: DoctorEnv) => boolean,
  agentBridge: DoctorAgentBridge
): DoctorCheck {
  const provider = agentBridge.provider;
  const command = agentBridge.command;
  if (provider === "invalid") {
    return {
      name: "Agent bridge provider",
      status: "fail",
      message: `Unsupported agent bridge provider ${agentBridge.configuredProvider}.`,
      remediation: "Set BRAIN_CREATOR_AGENT_PROVIDER to auto, claude, codex, host-agent, or disabled."
    };
  }
  if (provider === "host-agent") {
    return {
      name: "Agent bridge provider",
      status: "pass",
      message: "host-agent provider is ready for Planner, Generator, and Healer tasks without a Claude or Codex subprocess."
    };
  }
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
  if (provider === "host-agent") {
    return {
      name: "Agent bridge args",
      status: "pass",
      message: "host-agent provider does not require subprocess args."
    };
  }
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

function doctorToolProfile(env: DoctorEnv): DoctorReport["toolProfile"] {
  const value = env.BRAIN_CREATOR_TOOL_PROFILE ?? "full";
  return value === "facade" || value === "full" ? value : "invalid";
}

function toolProfileCheck(profile: DoctorReport["toolProfile"]): DoctorCheck {
  if (profile === "invalid") {
    return {
      name: "MCP tool profile",
      status: "fail",
      message: "BRAIN_CREATOR_TOOL_PROFILE is invalid.",
      remediation: "Set BRAIN_CREATOR_TOOL_PROFILE to facade or full."
    };
  }
  return {
    name: "MCP tool profile",
    status: "pass",
    message: `${profile} tool exposure is configured.`
  };
}

function doctorFeishuMode(env: DoctorEnv): DoctorReport["connectors"]["feishu"] {
  const appId = Boolean(env.BRAIN_CREATOR_FEISHU_APP_ID);
  const appSecret = Boolean(env.BRAIN_CREATOR_FEISHU_APP_SECRET);
  if (appId !== appSecret) return "invalid";
  return appId ? "direct" : "host-fallback";
}

function feishuConnectorCheck(mode: DoctorReport["connectors"]["feishu"]): DoctorCheck {
  if (mode === "invalid") {
    return {
      name: "Feishu connector",
      status: "fail",
      message: "Feishu OpenAPI credentials are only partially configured.",
      remediation: "Set both BRAIN_CREATOR_FEISHU_APP_ID and BRAIN_CREATOR_FEISHU_APP_SECRET, or unset both to use host fallback."
    };
  }
  if (mode === "direct") {
    return {
      name: "Feishu connector",
      status: "pass",
      message: "Feishu OpenAPI direct reading is configured with environment references."
    };
  }
  return {
    name: "Feishu connector",
    status: "warn",
    message: "Feishu direct reading is not configured; host content-package fallback remains available."
  };
}

function playwrightBrowserCheck(
  env: DoctorEnv,
  fileExists: (path: string) => boolean
): DoctorCheck {
  const configured = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const candidates = [
    configured,
    process.platform === "win32"
      ? `${env.PROGRAMFILES ?? process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.platform === "win32"
      ? `${env["PROGRAMFILES(X86)"] ?? process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));
  const available = candidates.find(fileExists);
  if (available) {
    return {
      name: "Playwright browser",
      status: "pass",
      message: `A Chromium-compatible browser is available at ${available}.`
    };
  }
  return {
    name: "Playwright browser",
    status: "warn",
    message: configured
      ? `PLAYWRIGHT_CHROMIUM_EXECUTABLE does not exist: ${configured}.`
      : "No system Chrome/Edge browser was detected for real Playwright execution.",
    remediation:
      "Run npx playwright install chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE to an installed Chrome/Edge executable."
  };
}

function bridgeProvider(env: DoctorEnv) {
  if (
    env.BRAIN_CREATOR_AGENT_PROVIDER &&
    supportedBridgeProviders.includes(env.BRAIN_CREATOR_AGENT_PROVIDER as SupportedBridgeProvider)
  ) {
    return env.BRAIN_CREATOR_AGENT_PROVIDER as SupportedBridgeProvider;
  }
  if (env.BRAIN_CREATOR_AGENT_PROVIDER) {
    return "invalid";
  }
  if (env.BRAIN_CREATOR_AGENT_COMMAND) {
    return "claude";
  }
  return env.BRAIN_CREATOR_AGENT_PROVIDER === "auto" ? "auto" : "auto";
}

function bridgeCommand(env: DoctorEnv, provider: SupportedBridgeProvider | "invalid") {
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
  provider: SupportedBridgeProvider | "invalid",
  commandExists: (command: string, env: DoctorEnv) => boolean
): Pick<DoctorAgentBridge, "provider" | "command"> {
  if (provider === "invalid") {
    return { provider, command: undefined };
  }
  if (provider === "auto") {
    const claudeCommand = env.BRAIN_CREATOR_CLAUDE_COMMAND;
    if (claudeCommand && commandExists(claudeCommand, env)) {
      return { provider: "claude", command: claudeCommand };
    }
    const codexCommand = env.BRAIN_CREATOR_CODEX_COMMAND ?? "codex";
    if (commandExists(codexCommand, env)) {
      return { provider: "codex", command: codexCommand };
    }
    return { provider, command: undefined };
  }
  const explicit = bridgeCommand(env, provider);
  if (explicit) {
    return { provider, command: explicit };
  }
  return { provider, command: undefined };
}

function resolveDoctorAgentBridge(
  env: DoctorEnv,
  commandExists: (command: string, env: DoctorEnv) => boolean
): DoctorAgentBridge {
  const configuredProvider = env.BRAIN_CREATOR_AGENT_PROVIDER;
  const provider = bridgeProvider(env);
  const detected = detectBridge(env, provider, commandExists);
  return {
    provider: detected.provider,
    configuredProvider,
    command: detected.command,
    recommendedAction: recommendedBridgeAction(detected.provider)
  };
}

function recommendedBridgeAction(provider: SupportedBridgeProvider | "invalid") {
  if (provider === "claude") {
    return "Run confirmed workflows through the Claude subprocess bridge.";
  }
  if (provider === "codex") {
    return "Run confirmed workflows through the Codex subprocess bridge.";
  }
  if (provider === "host-agent") {
    return "When Planner, Generator, or Healer returns needs_agent_execution, execute that task in the current agent, write the requested outputs, then call bc_submit_agent_output.";
  }
  if (provider === "disabled") {
    return "Use preview/status workflows only; real Planner/Generator/Healer execution is disabled.";
  }
  if (provider === "auto") {
    return "Configure BRAIN_CREATOR_AGENT_PROVIDER or install Claude/Codex so Brain Creator can resolve an agent bridge.";
  }
  return "Set BRAIN_CREATOR_AGENT_PROVIDER to auto, claude, codex, host-agent, or disabled.";
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

if (isCliEntryPoint(import.meta.url)) {
  const report = buildDoctorReport();
  console.log(formatDoctorReport(report));
  process.exit(report.ok ? 0 : 1);
}
