import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { createClaudeSubagentBridge } from "./claudeBridge.js";
import { createCodexExecBridge } from "./codexBridge.js";
import type { AgentBridgeWithMetadata } from "./orchestrator.js";

type BridgeProvider = "auto" | "claude" | "codex" | "disabled";
type BridgeEnv = Record<string, string | undefined>;

export type ConfiguredAgentBridgeOptions = {
  env?: BridgeEnv;
  commandExists?: (command: string, env: BridgeEnv) => boolean;
};

export function createConfiguredAgentBridge(
  options: ConfiguredAgentBridgeOptions = {}
): AgentBridgeWithMetadata | undefined {
  const env = options.env ?? process.env;
  const commandExists = options.commandExists ?? commandIsAvailable;
  const provider = providerFromEnv(env);
  if (provider === "disabled") {
    return undefined;
  }
  if (env.BRAIN_CREATOR_AGENT_COMMAND) {
    return createClaudeSubagentBridge({
      command: env.BRAIN_CREATOR_AGENT_COMMAND,
      baseArgs: parseAgentArgs(env.BRAIN_CREATOR_AGENT_ARGS),
      timeoutMs: parseAgentTimeout(env.BRAIN_CREATOR_AGENT_TIMEOUT_MS)
    });
  }

  if (provider === "claude") {
    return createClaudeBridge(env);
  }
  if (provider === "codex") {
    return createCodexBridge(env);
  }

  const claudeCommand = env.BRAIN_CREATOR_CLAUDE_COMMAND;
  if (claudeCommand && commandExists(claudeCommand, env)) {
    return createClaudeBridge(env);
  }
  const codexCommand = env.BRAIN_CREATOR_CODEX_COMMAND ?? "codex";
  if (commandExists(codexCommand, env)) {
    return createCodexBridge(env);
  }
  return undefined;
}

export function parseAgentArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return value.split(" ").map((item) => item.trim()).filter(Boolean);
  }
}

export function parseAgentTimeout(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function providerFromEnv(env: BridgeEnv): BridgeProvider {
  const raw = env.BRAIN_CREATOR_AGENT_PROVIDER;
  if (raw === "claude" || raw === "codex" || raw === "disabled" || raw === "auto") {
    return raw;
  }
  return "auto";
}

function createClaudeBridge(env: BridgeEnv) {
  return createClaudeSubagentBridge({
    command: env.BRAIN_CREATOR_CLAUDE_COMMAND ?? "claude",
    baseArgs: parseAgentArgs(env.BRAIN_CREATOR_CLAUDE_ARGS),
    timeoutMs: parseAgentTimeout(env.BRAIN_CREATOR_AGENT_TIMEOUT_MS)
  });
}

function createCodexBridge(env: BridgeEnv) {
  return createCodexExecBridge({
    command: env.BRAIN_CREATOR_CODEX_COMMAND ?? "codex",
    baseArgs: parseAgentArgs(env.BRAIN_CREATOR_CODEX_ARGS),
    timeoutMs: parseAgentTimeout(env.BRAIN_CREATOR_AGENT_TIMEOUT_MS),
    model: env.BRAIN_CREATOR_CODEX_MODEL,
    profile: env.BRAIN_CREATOR_CODEX_PROFILE
  });
}

function commandIsAvailable(command: string, env: BridgeEnv) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const pathDirs = (env.PATH ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? windowsPathExtensions(env, command) : [""];
  return pathDirs.some((dir) =>
    extensions.some((extension) => existsSync(join(dir, `${command}${extension}`)))
  );
}

function windowsPathExtensions(env: BridgeEnv, command: string) {
  if (extname(command)) {
    return [""];
  }
  return (env.PATHEXT ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}
