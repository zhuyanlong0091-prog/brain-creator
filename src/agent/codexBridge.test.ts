import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexExecBridge } from "./codexBridge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createCodexExecBridge", () => {
  it("runs a non-interactive Codex-compatible subprocess with the agent prompt over stdin", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "codex-fixture.mjs");
    const transcriptPath = join(workDir, "codex-transcript.txt");
    await writeFile(
      scriptPath,
      [
        "import { writeFile } from 'node:fs/promises';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, [process.argv.slice(2).join(' '), stdin].join('\\n---STDIN---\\n'), 'utf8');`,
        "console.log('codex ok');"
      ].join("\n"),
      "utf8"
    );

    const bridge = createCodexExecBridge({
      command: process.execPath,
      baseArgs: [scriptPath, "-C", "{cwd}", "-"],
      timeoutMs: 5000
    });

    const result = await bridge({
      systemId: "system_1",
      agent: "generator",
      inputSummary: "Generate checkout test",
      args: ["--output", "tests/generated/case.spec.ts"],
      outputPaths: ["tests/generated/case.spec.ts"],
      cwd: workDir
    });

    expect(result).toEqual({ exitCode: 0, stdout: "codex ok\n", stderr: "" });
    const transcript = await readFile(transcriptPath, "utf8");
    expect(transcript).toContain(`-C ${workDir} -`);
    expect(transcript).toContain("Brain Creator generator agent");
    expect(transcript).toContain("tests/generated/case.spec.ts");
  });

  it("preflights by checking the configured command", async () => {
    const bridge = createCodexExecBridge({ command: process.execPath });

    await expect(bridge.preflight?.()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-codex-bridge-"));
  tempDirs.push(dir);
  return dir;
}
