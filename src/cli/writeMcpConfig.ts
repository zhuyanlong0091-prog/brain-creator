#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type McpConfig = {
  mcpServers?: Record<string, unknown>;
};

type BrainCreatorMcpServer = {
  command: string;
  args?: string[];
  env: Record<string, string>;
};

export type WriteMcpConfigOptions = {
  targetDir?: string;
  commandMode?: "local" | "global";
  provider?: "auto" | "claude" | "codex" | "host-agent" | "disabled";
};

export type WriteMcpConfigResult = {
  path: string;
  status: "created" | "updated";
};

function brainCreatorMcpEnv(provider: NonNullable<WriteMcpConfigOptions["provider"]>) {
  const base = {
    BRAIN_CREATOR_WORKSPACE: ".",
    BRAIN_CREATOR_AGENT_PROVIDER: provider,
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  };
  if (provider === "claude") {
    return {
      ...base,
      BRAIN_CREATOR_CLAUDE_COMMAND: "claude",
      BRAIN_CREATOR_CLAUDE_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]"
    };
  }
  if (provider === "codex") {
    return {
      ...base,
      BRAIN_CREATOR_CODEX_COMMAND: "codex",
      BRAIN_CREATOR_CODEX_ARGS:
        "[\"exec\",\"--json\",\"--ephemeral\",\"--sandbox\",\"workspace-write\",\"--ask-for-approval\",\"never\",\"-C\",\"{cwd}\",\"-\"]"
    };
  }
  return base;
}

function brainCreatorMcpServer(
  commandMode: "local" | "global",
  provider: NonNullable<WriteMcpConfigOptions["provider"]>
): BrainCreatorMcpServer {
  if (commandMode === "global") {
    return {
      command: "brain-creator-mcp",
      env: brainCreatorMcpEnv(provider)
    };
  }
  return {
    command: "npx",
    args: ["brain-creator-mcp"],
    env: brainCreatorMcpEnv(provider)
  };
}

export async function writeBrainCreatorMcpConfig(
  options: WriteMcpConfigOptions = {}
): Promise<WriteMcpConfigResult> {
  const targetDir = resolve(options.targetDir ?? process.cwd());
  const commandMode = options.commandMode ?? "local";
  const provider = options.provider ?? "auto";
  const configPath = join(targetDir, ".mcp.json");
  const existing = await readExistingConfig(configPath);
  const status = existing ? "updated" : "created";
  const nextConfig: McpConfig = {
    ...existing,
    mcpServers: {
      ...(existing?.mcpServers ?? {}),
      "brain-creator": brainCreatorMcpServer(commandMode, provider)
    }
  };

  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return { path: configPath, status };
}

async function readExistingConfig(path: string): Promise<McpConfig | undefined> {
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw) as McpConfig;
}

if (process.argv[1]?.endsWith("writeMcpConfig.js")) {
  const targetArgIndex = process.argv.findIndex((arg) => arg === "--target");
  const targetDir = targetArgIndex >= 0 ? process.argv[targetArgIndex + 1] : undefined;
  const commandMode = process.argv.includes("--global") ? "global" : "local";
  const providerArgIndex = process.argv.findIndex((arg) => arg === "--provider");
  const provider = providerArgIndex >= 0 ? process.argv[providerArgIndex + 1] : undefined;
  writeBrainCreatorMcpConfig({
    targetDir,
    commandMode,
      provider:
      provider === "claude" || provider === "codex" || provider === "host-agent" || provider === "disabled" || provider === "auto"
        ? provider
        : undefined
  })
    .then((result) => {
      console.log(`Brain Creator MCP config ${result.status}: ${result.path}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
