#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { BRAIN_CREATOR_VERSION } from "../version.js";

type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const help = `Brain Creator ${BRAIN_CREATOR_VERSION}

Usage:
  brain-creator --version
  brain-creator --help

Installed commands:
  brain-creator-mcp                   Start the MCP server
  brain-creator-doctor                Check runtime readiness
  brain-creator-install-assets        Install project assets
  brain-creator-write-mcp-config      Write MCP configuration
  brain-creator-install-codex-plugin  Install the Codex plugin`;

export function runBrainCreatorCli(
  args: string[],
  io: CliIo = { stdout: console.log, stderr: console.error }
) {
  const [command] = args;
  if (args.length === 0 || command === "--help" || command === "-h") {
    io.stdout(help);
    return 0;
  }
  if (args.length === 1 && (command === "--version" || command === "-v" || command === "version")) {
    io.stdout(BRAIN_CREATOR_VERSION);
    return 0;
  }

  io.stderr(`Unknown argument: ${args.join(" ")}\nRun brain-creator --help for usage.`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runBrainCreatorCli(process.argv.slice(2));
}
