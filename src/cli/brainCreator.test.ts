import { describe, expect, it, vi } from "vitest";
import { runBrainCreatorCli } from "./brainCreator.js";

function createIo() {
  return {
    stdout: vi.fn<(message: string) => void>(),
    stderr: vi.fn<(message: string) => void>()
  };
}

describe("Brain Creator CLI", () => {
  it.each([["--version"], ["-v"], ["version"]])(
    "prints the package version for %s",
    (...args) => {
      const io = createIo();

      expect(runBrainCreatorCli(args, io)).toBe(0);
      expect(io.stdout).toHaveBeenCalledWith("2.0.5");
      expect(io.stderr).not.toHaveBeenCalled();
    }
  );

  it.each([[], ["--help"], ["-h"]])("prints help for %j", (...args) => {
    const io = createIo();

    expect(runBrainCreatorCli(args, io)).toBe(0);
    const output = io.stdout.mock.calls.flat().join("\n");
    expect(output).toContain("brain-creator --version");
    expect(output).toContain("brain-creator-mcp");
    expect(output).toContain("brain-creator-doctor");
    expect(output).toContain("brain-creator-install-assets");
    expect(output).toContain("brain-creator-write-mcp-config");
    expect(output).toContain("brain-creator-install-codex-plugin");
    expect(io.stderr).not.toHaveBeenCalled();
  });

  it("rejects unknown arguments", () => {
    const io = createIo();

    expect(runBrainCreatorCli(["unknown"], io)).toBe(1);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("Unknown argument: unknown"));
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("brain-creator --help"));
    expect(io.stdout).not.toHaveBeenCalled();
  });
});
