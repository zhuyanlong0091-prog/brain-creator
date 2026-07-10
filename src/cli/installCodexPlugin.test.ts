import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  installBrainCreatorCodexPlugin,
  runInstallCodexPluginCli
} from "./installCodexPlugin.js";

describe("install Codex plugin CLI", () => {
  it("registers the package root as a Codex marketplace and installs Brain Creator", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const packageRoot = resolve("tmp", "business-project", "node_modules", "brain-creator");

    const result = await installBrainCreatorCodexPlugin({
      packageRoot,
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return { stdout: "ok", stderr: "" };
      }
    });

    expect(result.marketplaceRoot).toBe(packageRoot);
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
