import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("brain-creator-mcp CLI", () => {
  it("starts with an explicit business workspace even when cwd is a different directory", async () => {
    const businessWorkspace = await tempDir();
    const processCwd = await tempDir();
    const cliPath = resolve("src/cli/brainCreatorMcp.ts");
    const loaderPath = pathToFileURL(resolve("node_modules/ts-node/esm.mjs")).href;
    const child = spawn(
      process.execPath,
      ["--loader", loaderPath, cliPath],
      {
        cwd: processCwd,
        env: {
          ...process.env,
          BRAIN_CREATOR_WORKSPACE: businessWorkspace
        },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    const stderrChunks: string[] = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString()));
    await wait(300);
    const stillRunning = child.exitCode === null;
    const closed = waitForClose(child);
    child.kill();
    child.stdin.end();
    await closed;

    expect(processCwd).not.toBe(businessWorkspace);
    expect(stillRunning).toBe(true);
    expect(stderrChunks.join("")).not.toContain("Error");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-cli-"));
  tempDirs.push(dir);
  return dir;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForClose(child: ChildProcess) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
}
