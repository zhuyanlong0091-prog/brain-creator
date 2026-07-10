#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  codexCommand?: string;
  runCommand?: CommandRunner;
};

export type InstallCodexPluginResult = {
  marketplaceRoot: string;
};

type InstallCodexPluginCliIo = {
  packageRoot?: string;
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

  return { marketplaceRoot };
}

export async function runInstallCodexPluginCli(args: string[], io: InstallCodexPluginCliIo = {}) {
  try {
    const packageRootArgIndex = args.findIndex((arg) => arg === "--package-root");
    const packageRoot =
      packageRootArgIndex >= 0 ? args[packageRootArgIndex + 1] : io.packageRoot;
    const result = await installBrainCreatorCodexPlugin({
      packageRoot,
      runCommand: io.runCommand
    });
    (io.log ?? console.log)(
      `Brain Creator Codex plugin installed from ${result.marketplaceRoot}`
    );
    return 0;
  } catch (error) {
    (io.error ?? console.error)(error instanceof Error ? error.message : String(error));
    return 1;
  }
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
