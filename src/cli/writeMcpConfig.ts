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

const supportedProviders = ["auto", "claude", "codex", "host-agent", "disabled"] as const;
export type BrainCreatorAgentProvider = (typeof supportedProviders)[number];

export type WriteMcpConfigOptions = {
  targetDir?: string;
  commandMode?: "local" | "global";
  provider?: BrainCreatorAgentProvider;
};

export type WriteMcpConfigResult = {
  path: string;
  status: "created" | "updated";
};

export type InspectMcpConfigOptions = {
  targetDir?: string;
};

export type InspectMcpConfigResult = {
  path: string;
  exists: boolean;
  server?: unknown;
};

type WriteMcpConfigCliIo = {
  cwd?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function brainCreatorMcpEnv(provider: NonNullable<WriteMcpConfigOptions["provider"]>) {
  const base = {
    BRAIN_CREATOR_WORKSPACE: ".",
    BRAIN_CREATOR_TOOL_PROFILE: "facade",
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
  const provider = parseMcpProviderArg(options.provider);
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

export async function inspectBrainCreatorMcpConfig(
  options: InspectMcpConfigOptions = {}
): Promise<InspectMcpConfigResult> {
  const targetDir = resolve(options.targetDir ?? process.cwd());
  const path = join(targetDir, ".mcp.json");
  const config = await readExistingConfig(path);
  if (!config) {
    return { path, exists: false };
  }
  const server = config.mcpServers?.["brain-creator"];
  return {
    path,
    exists: true,
    ...(server === undefined ? {} : { server: redactSecretValues(server) })
  };
}

async function readExistingConfig(path: string): Promise<McpConfig | undefined> {
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw) as McpConfig;
}

function redactSecretValues(value: unknown, key = ""): unknown {
  if (/secret|token|password|cookie/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretValues(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactSecretValues(childValue, childKey)
      ])
    );
  }
  return value;
}

export function parseMcpProviderArg(value: string | undefined): BrainCreatorAgentProvider {
  const provider = value ?? "auto";
  if (supportedProviders.includes(provider as BrainCreatorAgentProvider)) {
    return provider as BrainCreatorAgentProvider;
  }
  throw new Error(`Unsupported Brain Creator agent provider: ${provider}`);
}

export async function runWriteMcpConfigCli(args: string[], io: WriteMcpConfigCliIo = {}) {
  try {
    const targetArgIndex = args.findIndex((arg) => arg === "--target");
    const targetDir = targetArgIndex >= 0 ? args[targetArgIndex + 1] : io.cwd;
    const commandMode = args.includes("--global") ? "global" : "local";
    const providerArgIndex = args.findIndex((arg) => arg === "--provider");
    const provider = providerArgIndex >= 0 ? args[providerArgIndex + 1] : undefined;
    const result = await writeBrainCreatorMcpConfig({
      targetDir,
      commandMode,
      provider: parseMcpProviderArg(provider)
    });
    (io.log ?? console.log)(`Brain Creator MCP config ${result.status}: ${result.path}`);
    return 0;
  } catch (error) {
    (io.error ?? console.error)(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1]?.endsWith("writeMcpConfig.js")) {
  runWriteMcpConfigCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
