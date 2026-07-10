import { describe, expect, it } from "vitest";
import {
  installBrainCreatorCodexPlugin,
  runInstallCodexPluginCli
} from "./installCodexPlugin.js";

describe("install Codex plugin CLI", () => {
  it("registers the package root as a Codex marketplace and installs Brain Creator", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    const result = await installBrainCreatorCodexPlugin({
      packageRoot: "C:/project/node_modules/brain-creator",
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return { stdout: "ok", stderr: "" };
      }
    });

    expect(result.marketplaceRoot).toBe("C:\\project\\node_modules\\brain-creator");
    expect(calls).toEqual([
      {
        command: "codex",
        args: ["plugin", "marketplace", "add", "C:\\project\\node_modules\\brain-creator"],
        cwd: "C:\\project\\node_modules\\brain-creator"
      },
      {
        command: "codex",
        args: ["plugin", "add", "brain-creator@personal"],
        cwd: "C:\\project\\node_modules\\brain-creator"
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
});
