import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeSubagentBridge } from "./claudeBridge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createClaudeSubagentBridge", () => {
  it("runs a real subprocess with a Claude subagent prompt over stdin", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "bridge-fixture.mjs");
    const transcriptPath = join(workDir, "transcript.txt");
    const specPath = join(workDir, "specs", "robot.md");
    await writeFile(
      scriptPath,
      [
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import { dirname } from 'node:path';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, [process.argv.slice(2).join(' '), stdin].join('\\n---STDIN---\\n'), 'utf8');`,
        `await mkdir(dirname(${JSON.stringify(specPath)}), { recursive: true });`,
        `await writeFile(${JSON.stringify(specPath)}, '## Scenario: Robot checkout\\nPriority: critical', 'utf8');`,
        "console.log('planner ok');"
      ].join("\n"),
      "utf8"
    );

    const bridge = createClaudeSubagentBridge({
      command: process.execPath,
      baseArgs: [scriptPath],
      timeoutMs: 5000
    });

    const result = await bridge({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "Plan robot checkout",
      args: ["--prompt", "specs/_context/system-prompt.md", "--output", specPath],
      outputPaths: [specPath],
      cwd: workDir
    });

    const transcript = await readFile(transcriptPath, "utf8");
    expect(result).toEqual({ exitCode: 0, stdout: "planner ok\n", stderr: "" });
    expect(transcript).toContain("#playwright-test-planner");
    expect(transcript).toContain("Plan robot checkout");
    expect(transcript).toContain(`--output ${specPath}`);
    expect(await readFile(specPath, "utf8")).toContain("Robot checkout");
  });

  it("returns subprocess failures with stderr for AgentRun logging", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "fail-fixture.mjs");
    await writeFile(scriptPath, "console.error('planner failed'); process.exit(7);", "utf8");
    const bridge = createClaudeSubagentBridge({
      command: process.execPath,
      baseArgs: [scriptPath],
      timeoutMs: 5000
    });

    const result = await bridge({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "Plan robot checkout",
      args: [],
      outputPaths: [],
      cwd: workDir
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("planner failed");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-claude-bridge-"));
  tempDirs.push(dir);
  return dir;
}
