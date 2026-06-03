import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeSubagentBridge } from "./claudeBridge.js";

const tempDirs: string[] = [];
const itOnWindows = process.platform === "win32" ? it : it.skip;

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
    expect(transcript).toContain("non-interactive");
    expect(transcript).toContain("## Scenario:");
    expect(transcript).toContain("skip browser exploration");
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

  itOnWindows("runs Windows command shims through a shell while preserving stdin", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "shim-target.mjs");
    const shimPath = join(workDir, "claude.cmd");
    const transcriptPath = join(workDir, "shim-transcript.txt");
    await writeFile(
      scriptPath,
      [
        "import { writeFile } from 'node:fs/promises';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, stdin, 'utf8');`,
        "console.log('shim ok');"
      ].join("\n"),
      "utf8"
    );
    await writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");

    const bridge = createClaudeSubagentBridge({
      command: shimPath,
      timeoutMs: 5000
    });

    const result = await bridge({
      systemId: "system_1",
      agent: "generator",
      inputSummary: "Generate robot checkout test",
      args: [],
      outputPaths: [],
      cwd: workDir
    });

    expect(result).toEqual({ exitCode: 0, stdout: "shim ok\n", stderr: "" });
    expect(await readFile(transcriptPath, "utf8")).toContain("#playwright-test-generator");
  });

  itOnWindows("resolves a Claude command shim from PATH on Windows-style npm installs", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "path-target.mjs");
    const shimPath = join(workDir, "claude.cmd");
    const transcriptPath = join(workDir, "path-transcript.txt");
    await writeFile(
      scriptPath,
      [
        "import { writeFile } from 'node:fs/promises';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, stdin, 'utf8');`,
        "console.log('path shim ok');"
      ].join("\n"),
      "utf8"
    );
    await writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    const previousPath = process.env.PATH;
    process.env.PATH = [workDir, previousPath].filter(Boolean).join(delimiter);

    try {
      const bridge = createClaudeSubagentBridge({
        command: "claude",
        timeoutMs: 5000
      });

      const result = await bridge({
        systemId: "system_1",
        agent: "healer",
        inputSummary: "Heal robot checkout test",
        args: [],
        outputPaths: [],
        cwd: workDir
      });

      expect(result).toEqual({ exitCode: 0, stdout: "path shim ok\n", stderr: "" });
      expect(await readFile(transcriptPath, "utf8")).toContain("#playwright-test-healer");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("adds generator-specific instructions for writing runnable Playwright files", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "generator-prompt-fixture.mjs");
    const transcriptPath = join(workDir, "generator-transcript.txt");
    await writeFile(
      scriptPath,
      [
        "import { writeFile } from 'node:fs/promises';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, stdin, 'utf8');`,
        "console.log('ok');"
      ].join("\n"),
      "utf8"
    );

    const bridge = createClaudeSubagentBridge({
      command: process.execPath,
      baseArgs: [scriptPath],
      timeoutMs: 5000
    });

    await bridge({
      systemId: "system_1",
      agent: "generator",
      inputSummary: "Generate checkout test",
      args: ["--spec", "specs/case.md", "--seed", "tests/seed.spec.ts", "--output", "tests/generated/case.spec.ts"],
      outputPaths: ["tests/generated/case.spec.ts"],
      cwd: workDir
    });

    const transcript = await readFile(transcriptPath, "utf8");
    expect(transcript).toContain("complete TypeScript Playwright test file");
    expect(transcript).toContain("@playwright/test");
    expect(transcript).toContain("Write the file");
    expect(transcript).toContain("tests/generated/case.spec.ts");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-claude-bridge-"));
  tempDirs.push(dir);
  return dir;
}
