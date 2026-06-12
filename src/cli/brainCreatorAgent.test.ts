import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("brain-creator-agent CLI", () => {
  it("prints usage when no natural-language request is provided", async () => {
    const result = await runNode(["--loader", "ts-node/esm", "src/cli/brainCreatorAgent.ts"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: brain-creator-agent");
  });
});

function runNode(args: string[]) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
