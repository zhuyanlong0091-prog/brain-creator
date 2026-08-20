#!/usr/bin/env node
import { buildDoctorReport, formatDoctorReport } from "./doctor.js";
import { installBrainCreatorAssets } from "./installAssets.js";
import { installBrainCreatorCodexPlugin } from "./installCodexPlugin.js";
import {
  inspectBrainCreatorMcpConfig,
  parseMcpProviderArg,
  writeBrainCreatorMcpConfig,
  type BrainCreatorAgentProvider
} from "./writeMcpConfig.js";
import { startBrainCreatorServer } from "../mcp/server.js";
import { exportCaseSuiteArchive } from "../storage/artifactArchive.js";
import {
  applyArtifactMigration,
  planArtifactMigration,
  rollbackArtifactMigration as rollbackArtifactMigrationInWorkspace
} from "../storage/artifactMigration.js";
import {
  applyArtifactRetention,
  planArtifactRetention
} from "../storage/artifactRetention.js";
import { ShardedFileBrainCreatorRepository } from "../domain/repository.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorStoreDir,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import { BRAIN_CREATOR_VERSION } from "../version.js";
import { isCliEntryPoint } from "./entrypoint.js";

type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export type BrainCreatorCliDependencies = {
  installAssets: typeof installBrainCreatorAssets;
  writeMcpConfig: typeof writeBrainCreatorMcpConfig;
  inspectMcpConfig: typeof inspectBrainCreatorMcpConfig;
  installCodexPlugin: typeof installBrainCreatorCodexPlugin;
  buildDoctorReport: typeof buildDoctorReport;
  formatDoctorReport: typeof formatDoctorReport;
  startMcp: typeof startBrainCreatorServer;
  exportSuite: typeof exportSuiteFromWorkspace;
  migrateArtifacts: typeof migrateArtifactsFromWorkspace;
  rollbackArtifactMigration: typeof rollbackArtifactMigrationFromWorkspace;
  retainArtifacts: typeof retainArtifactsFromWorkspace;
};

const defaultDependencies: BrainCreatorCliDependencies = {
  installAssets: installBrainCreatorAssets,
  writeMcpConfig: writeBrainCreatorMcpConfig,
  inspectMcpConfig: inspectBrainCreatorMcpConfig,
  installCodexPlugin: installBrainCreatorCodexPlugin,
  buildDoctorReport,
  formatDoctorReport,
  startMcp: startBrainCreatorServer,
  exportSuite: exportSuiteFromWorkspace,
  migrateArtifacts: migrateArtifactsFromWorkspace,
  rollbackArtifactMigration: rollbackArtifactMigrationFromWorkspace,
  retainArtifacts: retainArtifactsFromWorkspace
};

const help = `Brain Creator ${BRAIN_CREATOR_VERSION}

Usage:
  brain-creator init [--provider <provider>] [--with-plugin] [--target <path>]
  brain-creator doctor [--json]
  brain-creator config [show] [--target <path>] [--json]
  brain-creator config write [--provider <provider>] [--global] [--target <path>]
  brain-creator plugin install [--target <path>]
  brain-creator export --suite <suite-run-id> [--target <path>] [--output <path>]
  brain-creator artifacts migrate [--target <path>] [--confirm]
  brain-creator artifacts rollback --migration <id> --confirm [--target <path>]
  brain-creator artifacts retention --older-than-days <days> [--system <id>] [--confirm]
  brain-creator mcp
  brain-creator --version

Run brain-creator help legacy to list compatibility executables.`;

const legacyHelp = `Compatibility aliases

  brain-creator-install-assets        Use brain-creator init
  brain-creator-write-mcp-config      Use brain-creator config write
  brain-creator-install-codex-plugin  Use brain-creator plugin install
  brain-creator-doctor                Use brain-creator doctor
  brain-creator-mcp                   Use brain-creator mcp

These aliases remain available for existing MCP and automation configurations.`;

const commandHelp: Record<string, string> = {
  init: `Usage: brain-creator init [--provider <provider>] [--with-plugin] [--target <path>] [--global] [--force] [--json]\n\nInstalls project assets and creates or updates the MCP configuration. Existing custom assets are skipped unless --force is used.`,
  doctor: `Usage: brain-creator doctor [--json]\n\nChecks Agent provider, browser, connector, knowledge directory, and installed assets.`,
  config: `Usage:\n  brain-creator config [show] [--target <path>] [--json]\n  brain-creator config write [--provider <provider>] [--global] [--target <path>] [--json]\n\nShow is read-only and redacts secret-like environment values.`,
  plugin: `Usage: brain-creator plugin install [--target <path>] [--package-root <path>] [--json]\n\nInstalls the Codex plugin and configures host-agent execution.`,
  export: `Usage: brain-creator export --suite <suite-run-id> [--target <path>] [--output <path>] [--json]\n\nExports a portable Suite archive with evidence manifest and hashes.`,
  artifacts: `Usage:\n  brain-creator artifacts migrate [--target <path>] [--confirm]\n  brain-creator artifacts rollback --migration <id> --confirm [--target <path>]\n  brain-creator artifacts retention --older-than-days <days> [--system <id>] [--target <path>] [--confirm]\n\nMigration and retention are dry-run by default. Mutations require --confirm.`,
  mcp: `Usage: brain-creator mcp\n\nStarts the Brain Creator MCP server over stdio.`
};

export async function runBrainCreatorCli(
  args: string[],
  io: CliIo = { stdout: console.log, stderr: console.error },
  dependencies: BrainCreatorCliDependencies = defaultDependencies
) {
  const json = args.includes("--json");
  const normalizedArgs = args.filter((arg) => arg !== "--json");
  const [command, ...commandArgs] = normalizedArgs;

  try {
    if (!command || command === "--help" || command === "-h") {
      io.stdout(help);
      return 0;
    }
    if (command === "help") {
      const topic = commandArgs[0];
      io.stdout(topic === "legacy" ? legacyHelp : commandHelp[topic] ?? help);
      return 0;
    }
    if (
      normalizedArgs.length === 1 &&
      (command === "--version" || command === "-v" || command === "version")
    ) {
      io.stdout(BRAIN_CREATOR_VERSION);
      return 0;
    }
    if (commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h")) {
      const focusedHelp = commandHelp[command];
      if (!focusedHelp) throw new Error(`Unknown command: ${command}`);
      io.stdout(focusedHelp);
      return 0;
    }
    if (command === "init") {
      return await runInit(commandArgs, json, io, dependencies);
    }
    if (command === "doctor") {
      assertAllowedArgs(commandArgs, [], []);
      const report = dependencies.buildDoctorReport();
      writeSuccess(io, json, "doctor", report, dependencies.formatDoctorReport(report));
      return report.ok ? 0 : 1;
    }
    if (command === "config") {
      return await runConfig(commandArgs, json, io, dependencies);
    }
    if (command === "plugin") {
      return await runPlugin(commandArgs, json, io, dependencies);
    }
    if (command === "export") {
      return await runExport(commandArgs, json, io, dependencies);
    }
    if (command === "artifacts") {
      return await runArtifacts(commandArgs, json, io, dependencies);
    }
    if (command === "migrate" && commandArgs[0] === "artifacts") {
      return await runArtifacts(["migrate", ...commandArgs.slice(1)], json, io, dependencies);
    }
    if (command === "mcp") {
      assertAllowedArgs(commandArgs, [], []);
      await dependencies.startMcp();
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    writeError(io, json, command ?? "help", error);
    return 1;
  }
}

async function runInit(
  args: string[],
  json: boolean,
  io: CliIo,
  dependencies: BrainCreatorCliDependencies
) {
  assertAllowedArgs(args, ["--target", "--provider"], ["--global", "--with-plugin", "--force"]);
  const targetDir = optionValue(args, "--target");
  const providerValue = optionValue(args, "--provider");
  const withPlugin = args.includes("--with-plugin");
  const provider: BrainCreatorAgentProvider =
    withPlugin && providerValue === undefined ? "host-agent" : parseMcpProviderArg(providerValue);
  if (withPlugin && provider !== "host-agent") {
    throw new Error("--with-plugin requires --provider host-agent");
  }
  if (withPlugin && args.includes("--global")) {
    throw new Error("--with-plugin cannot be combined with --global");
  }

  const assets = await dependencies.installAssets({
    targetDir,
    force: args.includes("--force")
  });
  const configuration = withPlugin
    ? await dependencies.installCodexPlugin({ workspaceDir: targetDir })
    : await dependencies.writeMcpConfig({
        targetDir,
        commandMode: args.includes("--global") ? "global" : "local",
        provider
      });
  const result = { assets, configuration, provider, pluginInstalled: withPlugin };
  writeSuccess(
    io,
    json,
    "init",
    result,
    [
      `Brain Creator initialization complete: ${assets.targetDir}`,
      `Assets installed: ${assets.installed.length}; skipped: ${assets.skipped.length}`,
      `Agent provider: ${provider}`,
      `Codex plugin: ${withPlugin ? "installed" : "not requested"}`
    ].join("\n")
  );
  return 0;
}

async function runConfig(
  args: string[],
  json: boolean,
  io: CliIo,
  dependencies: BrainCreatorCliDependencies
) {
  const action = args[0] === "show" || args[0] === "write" ? args[0] : "show";
  const actionArgs = action === "show" && args[0] !== "show" ? args : args.slice(1);
  if (action === "show") {
    assertAllowedArgs(actionArgs, ["--target"], []);
    const result = await dependencies.inspectMcpConfig({
      targetDir: optionValue(actionArgs, "--target")
    });
    writeSuccess(
      io,
      json,
      "config show",
      result,
      result.exists
        ? `Brain Creator MCP config: ${result.path}\n${JSON.stringify(result.server ?? {}, null, 2)}`
        : `Brain Creator MCP config not found: ${result.path}\nRun brain-creator init.`
    );
    return 0;
  }

  assertAllowedArgs(actionArgs, ["--target", "--provider"], ["--global"]);
  const result = await dependencies.writeMcpConfig({
    targetDir: optionValue(actionArgs, "--target"),
    commandMode: actionArgs.includes("--global") ? "global" : "local",
    provider: parseMcpProviderArg(optionValue(actionArgs, "--provider"))
  });
  writeSuccess(io, json, "config write", result, `Brain Creator MCP config ${result.status}: ${result.path}`);
  return 0;
}

async function runPlugin(
  args: string[],
  json: boolean,
  io: CliIo,
  dependencies: BrainCreatorCliDependencies
) {
  if (args[0] !== "install") {
    throw new Error("Unknown plugin command. Use: brain-creator plugin install");
  }
  const actionArgs = args.slice(1);
  assertAllowedArgs(actionArgs, ["--target", "--package-root"], []);
  const workspaceDir = optionValue(actionArgs, "--target");
  const packageRoot = optionValue(actionArgs, "--package-root");
  const options = {
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(packageRoot ? { packageRoot } : {})
  };
  const result = await dependencies.installCodexPlugin(options);
  writeSuccess(
    io,
    json,
    "plugin install",
    result,
    `Brain Creator Codex plugin installed from ${result.marketplaceRoot}`
  );
  return 0;
}

async function runExport(
  args: string[],
  json: boolean,
  io: CliIo,
  dependencies: BrainCreatorCliDependencies
) {
  assertAllowedArgs(args, ["--suite", "--target", "--output"], []);
  const suiteRunId = optionValue(args, "--suite");
  if (!suiteRunId) throw new Error("--suite requires a value");
  const targetDir = optionValue(args, "--target");
  const outputPath = optionValue(args, "--output");
  const result = await dependencies.exportSuite({ suiteRunId, targetDir, outputPath });
  writeSuccess(
    io,
    json,
    "export",
    result,
    `Brain Creator Suite archive exported: ${result.outputPath}`
  );
  return 0;
}

async function runArtifacts(
  args: string[],
  json: boolean,
  io: CliIo,
  dependencies: BrainCreatorCliDependencies
) {
  const [action, ...actionArgs] = args;
  if (action === "migrate") {
    assertAllowedArgs(actionArgs, ["--target"], ["--confirm", "--dry-run"]);
    if (actionArgs.includes("--confirm") && actionArgs.includes("--dry-run")) {
      throw new Error("--confirm cannot be combined with --dry-run");
    }
    const result = await dependencies.migrateArtifacts({
      targetDir: optionValue(actionArgs, "--target"),
      confirm: actionArgs.includes("--confirm")
    });
    writeSuccess(
      io,
      json,
      "artifacts migrate",
      result,
      result.status === "planned"
        ? `Artifact migration dry-run: ${result.entries} files; ${result.unresolved} unresolved. Re-run with --confirm to apply.`
        : `Artifact migration applied: ${result.migrated} files; migration ${result.migrationId}.`
    );
    return 0;
  }
  if (action === "rollback") {
    assertAllowedArgs(actionArgs, ["--target", "--migration"], ["--confirm"]);
    if (!actionArgs.includes("--confirm")) throw new Error("Artifact rollback requires --confirm");
    const migrationId = optionValue(actionArgs, "--migration");
    if (!migrationId) throw new Error("--migration requires a value");
    const result = await dependencies.rollbackArtifactMigration({
      targetDir: optionValue(actionArgs, "--target"),
      migrationId
    });
    writeSuccess(io, json, "artifacts rollback", result, `Artifact migration rolled back: ${migrationId}`);
    return 0;
  }
  if (action === "retention") {
    assertAllowedArgs(
      actionArgs,
      ["--target", "--older-than-days", "--system"],
      ["--confirm", "--dry-run"]
    );
    if (actionArgs.includes("--confirm") && actionArgs.includes("--dry-run")) {
      throw new Error("--confirm cannot be combined with --dry-run");
    }
    const rawDays = optionValue(actionArgs, "--older-than-days");
    if (!rawDays) throw new Error("--older-than-days requires a value");
    const olderThanDays = Number(rawDays);
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
      throw new Error("--older-than-days must be a positive integer");
    }
    const result = await dependencies.retainArtifacts({
      targetDir: optionValue(actionArgs, "--target"),
      olderThanDays,
      systemId: optionValue(actionArgs, "--system"),
      confirm: actionArgs.includes("--confirm")
    });
    writeSuccess(
      io,
      json,
      "artifacts retention",
      result,
      result.status === "planned"
        ? `Artifact retention dry-run: ${result.entries} Suite runs; ${result.bytes} bytes. Re-run with --confirm to delete.`
        : `Artifact retention completed: ${result.deleted} Suite runs; ${result.bytesFreed} bytes freed.`
    );
    return 0;
  }
  throw new Error("Unknown artifacts command. Use migrate, rollback, or retention");
}

async function exportSuiteFromWorkspace(input: {
  suiteRunId: string;
  targetDir?: string;
  outputPath?: string;
}) {
  const workspace = resolveBrainCreatorWorkspace(input.targetDir ?? process.cwd(), process.env);
  const repository = new ShardedFileBrainCreatorRepository(
    resolveBrainCreatorStoreDir(workspace, process.env),
    resolveBrainCreatorDataFile(workspace, process.env)
  );
  return exportCaseSuiteArchive({
    repository,
    workDir: workspace,
    suiteRunId: input.suiteRunId,
    outputPath: input.outputPath ?? `${input.suiteRunId}.brain-creator.zip`
  });
}

async function migrateArtifactsFromWorkspace(input: {
  targetDir?: string;
  confirm: boolean;
}) {
  const { workspace, repository } = workspaceRepository(input.targetDir);
  const plan = await planArtifactMigration({ repository, workDir: workspace });
  if (!input.confirm) {
    return {
      status: "planned" as const,
      migrationId: plan.id,
      entries: plan.entries.length,
      unresolved: plan.entries.filter((entry) => entry.ownership === "unresolved").length
    };
  }
  return applyArtifactMigration({ repository, workDir: workspace, plan });
}

async function rollbackArtifactMigrationFromWorkspace(input: {
  targetDir?: string;
  migrationId: string;
}) {
  const { workspace, repository } = workspaceRepository(input.targetDir);
  return rollbackArtifactMigrationInWorkspace({
    repository,
    workDir: workspace,
    migrationId: input.migrationId
  });
}

async function retainArtifactsFromWorkspace(input: {
  targetDir?: string;
  olderThanDays: number;
  systemId?: string;
  confirm: boolean;
}) {
  const { workspace, repository } = workspaceRepository(input.targetDir);
  const plan = await planArtifactRetention({
    repository,
    workDir: workspace,
    olderThanDays: input.olderThanDays,
    systemId: input.systemId
  });
  if (!input.confirm) {
    return {
      status: "planned" as const,
      entries: plan.entries.length,
      bytes: plan.entries.reduce((total, entry) => total + entry.bytes, 0)
    };
  }
  return applyArtifactRetention({ workDir: workspace, plan, confirm: true });
}

function workspaceRepository(targetDir?: string) {
  const workspace = resolveBrainCreatorWorkspace(targetDir ?? process.cwd(), process.env);
  const repository = new ShardedFileBrainCreatorRepository(
    resolveBrainCreatorStoreDir(workspace, process.env),
    resolveBrainCreatorDataFile(workspace, process.env)
  );
  return { workspace, repository };
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function assertAllowedArgs(args: string[], valueOptions: string[], flags: string[]) {
  const allowed = new Set([...valueOptions, ...flags]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!allowed.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (valueOptions.includes(arg)) {
      optionValue(args, arg);
      index += 1;
    }
  }
}

function writeSuccess(io: CliIo, json: boolean, command: string, data: unknown, human: string) {
  io.stdout(json ? JSON.stringify({ success: true, command, data }, null, 2) : human);
}

function writeError(io: CliIo, json: boolean, command: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(
    json
      ? JSON.stringify({ success: false, command, error: message }, null, 2)
      : `${message}\nRun brain-creator --help for usage.`
  );
}

if (isCliEntryPoint(import.meta.url)) {
  runBrainCreatorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
