#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBrainCreatorMcpConfig } from "./writeMcpConfig.js";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  cwd: string
) => Promise<CommandResult>;

export type InstallCodexPluginOptions = {
  packageRoot?: string;
  workspaceDir?: string;
  codexCommand?: string;
  runCommand?: CommandRunner;
};

export type InstallCodexPluginResult = {
  marketplaceRoot: string;
  mcpConfigPath: string;
};

type InstallCodexPluginCliIo = {
  packageRoot?: string;
  cwd?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  runCommand?: CommandRunner;
};

export async function installBrainCreatorCodexPlugin(
  options: InstallCodexPluginOptions = {}
): Promise<InstallCodexPluginResult> {
  const marketplaceRoot = resolve(options.packageRoot ?? resolvePackageRoot());
  const command = options.codexCommand ?? "codex";
  const run = options.runCommand ?? runCommand;

  await run(command, ["plugin", "marketplace", "add", marketplaceRoot], marketplaceRoot);
  await run(command, ["plugin", "add", "brain-creator@personal"], marketplaceRoot);
  const mcpConfig = await writeBrainCreatorMcpConfig({
    targetDir: options.workspaceDir ?? process.cwd(),
    provider: "host-agent"
  });

  return { marketplaceRoot, mcpConfigPath: mcpConfig.path };
}

export async function runInstallCodexPluginCli(args: string[], io: InstallCodexPluginCliIo = {}) {
  try {
    if (args.includes("--help") || args.includes("-h")) {
      (io.log ?? console.log)(installCodexPluginHelp());
      return 0;
    }
    const packageRootArgIndex = args.findIndex((arg) => arg === "--package-root");
    const packageRoot =
      packageRootArgIndex >= 0 ? args[packageRootArgIndex + 1] : io.packageRoot;
    const result = await installBrainCreatorCodexPlugin({
      packageRoot,
      workspaceDir: io.cwd ?? process.cwd(),
      runCommand: io.runCommand
    });
    (io.log ?? console.log)(
      `Brain Creator Codex plugin installed from ${result.marketplaceRoot}`
    );
    (io.log ?? console.log)(`Brain Creator host-agent MCP config: ${result.mcpConfigPath}`);
    return 0;
  } catch (error) {
    (io.error ?? console.error)(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function installCodexPluginHelp() {
  return [
    "Usage: brain-creator-install-codex-plugin [--package-root <path>]",
    "",
    "Registers Brain Creator as a Codex plugin marketplace, installs brain-creator@personal, and configures the current workspace for host-agent execution.",
    "",
    "Options:",
    "  --package-root <path>  Package root to register. Defaults to this installed package.",
    "  -h, --help             Show this help."
  ].join("\n");
}

function resolvePackageRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.includes(`${resolve("dist", "cli")}`)) {
    return resolve(dirname(currentFile), "..", "..");
  }
  return resolve(dirname(currentFile), "..", "..");
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolveResult({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `Command failed: ${command} ${args.join(" ")}`,
            `cwd: ${cwd}`,
            `stdout:\n${stdout}`,
            `stderr:\n${stderr}`
          ].join("\n")
        )
      );
    });
  });
}

if (process.argv[1]?.endsWith("installCodexPlugin.js")) {
  runInstallCodexPluginCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
