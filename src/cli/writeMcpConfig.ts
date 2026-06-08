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
};

export type WriteMcpConfigResult = {
  path: string;
  status: "created" | "updated";
};

const brainCreatorMcpEnv = {
  BRAIN_CREATOR_WORKSPACE: ".",
  BRAIN_CREATOR_AGENT_COMMAND: "claude",
  BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
  BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
};

function brainCreatorMcpServer(commandMode: "local" | "global"): BrainCreatorMcpServer {
  if (commandMode === "global") {
    return {
      command: "brain-creator-mcp",
      env: brainCreatorMcpEnv
    };
  }
  return {
    command: "npx",
    args: ["brain-creator-mcp"],
    env: brainCreatorMcpEnv
  };
}

export async function writeBrainCreatorMcpConfig(
  options: WriteMcpConfigOptions = {}
): Promise<WriteMcpConfigResult> {
  const targetDir = resolve(options.targetDir ?? process.cwd());
  const commandMode = options.commandMode ?? "local";
  const configPath = join(targetDir, ".mcp.json");
  const existing = await readExistingConfig(configPath);
  const status = existing ? "updated" : "created";
  const nextConfig: McpConfig = {
    ...existing,
    mcpServers: {
      ...(existing?.mcpServers ?? {}),
      "brain-creator": brainCreatorMcpServer(commandMode)
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
  writeBrainCreatorMcpConfig({ targetDir, commandMode })
    .then((result) => {
      console.log(`Brain Creator MCP config ${result.status}: ${result.path}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
