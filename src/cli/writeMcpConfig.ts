#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type McpConfig = {
  mcpServers?: Record<string, unknown>;
};

export type WriteMcpConfigOptions = {
  targetDir?: string;
};

export type WriteMcpConfigResult = {
  path: string;
  status: "created" | "updated";
};

const brainCreatorMcpServer = {
  command: "brain-creator-mcp",
  env: {
    BRAIN_CREATOR_WORKSPACE: ".",
    BRAIN_CREATOR_AGENT_COMMAND: "claude",
    BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  }
};

export async function writeBrainCreatorMcpConfig(
  options: WriteMcpConfigOptions = {}
): Promise<WriteMcpConfigResult> {
  const targetDir = resolve(options.targetDir ?? process.cwd());
  const configPath = join(targetDir, ".mcp.json");
  const existing = await readExistingConfig(configPath);
  const status = existing ? "updated" : "created";
  const nextConfig: McpConfig = {
    ...existing,
    mcpServers: {
      ...(existing?.mcpServers ?? {}),
      "brain-creator": brainCreatorMcpServer
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
  writeBrainCreatorMcpConfig({ targetDir })
    .then((result) => {
      console.log(`Brain Creator MCP config ${result.status}: ${result.path}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
