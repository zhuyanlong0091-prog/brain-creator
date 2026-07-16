import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installBrainCreatorCodexPlugin,
  runInstallCodexPluginCli
} from "./installCodexPlugin.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("install Codex plugin CLI", () => {
  it("registers the package root as a Codex marketplace and installs Brain Creator", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const workspaceDir = await tempDir();
    const packageRoot = resolve(workspaceDir, "node_modules", "brain-creator");

    const result = await installBrainCreatorCodexPlugin({
      packageRoot,
      workspaceDir,
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return { stdout: "ok", stderr: "" };
      }
    });

    expect(result.marketplaceRoot).toBe(packageRoot);
    expect(result.mcpConfigPath).toBe(join(workspaceDir, ".mcp.json"));
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8"));
    expect(mcpConfig.mcpServers["brain-creator"].env.BRAIN_CREATOR_AGENT_PROVIDER).toBe(
      "host-agent"
    );
    expect(mcpConfig.mcpServers["brain-creator"].env.BRAIN_CREATOR_TOOL_PROFILE).toBe("facade");
    expect(calls).toEqual([
      {
        command: "codex",
        args: ["plugin", "marketplace", "add", packageRoot],
        cwd: packageRoot
      },
      {
        command: "codex",
        args: ["plugin", "add", "brain-creator@personal"],
        cwd: packageRoot
      }
    ]);
  });

  it("returns a non-zero CLI exit code when Codex is unavailable", async () => {
    const errors: string[] = [];

    const exitCode = await runInstallCodexPluginCli([], {
      packageRoot: "C:/project/node_modules/brain-creator",
      error: (message) => errors.push(message),
      runCommand: async () => {
        throw new Error("codex not found");
      }
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("codex not found");
  });

  it("prints help without running Codex commands", async () => {
    const logs: string[] = [];
    const calls: string[] = [];

    const exitCode = await runInstallCodexPluginCli(["--help"], {
      log: (message) => logs.push(message),
      runCommand: async (command) => {
        calls.push(command);
        return { stdout: "", stderr: "" };
      }
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("brain-creator-install-codex-plugin");
    expect(logs.join("\n")).toContain("--package-root");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-codex-plugin-install-"));
  tempDirs.push(dir);
  return dir;
}
