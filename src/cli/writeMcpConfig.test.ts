import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeBrainCreatorMcpConfig } from "./writeMcpConfig.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeBrainCreatorMcpConfig", () => {
  it("creates a business project MCP config for Brain Creator", async () => {
    const targetDir = await tempDir();

    const result = await writeBrainCreatorMcpConfig({ targetDir });

    expect(result.path).toBe(join(targetDir, ".mcp.json"));
    expect(result.status).toBe("created");
    const config = JSON.parse(await readFile(result.path, "utf8"));
    expect(config.mcpServers["brain-creator"]).toEqual({
      command: "npx",
      args: ["brain-creator-mcp"],
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
  });

  it("preserves existing MCP servers when adding Brain Creator", async () => {
    const targetDir = await tempDir();
    const configPath = join(targetDir, ".mcp.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            "playwright-test": {
              command: "cmd",
              args: ["/c", "npx", "playwright", "run-test-mcp-server"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await writeBrainCreatorMcpConfig({ targetDir });

    expect(result.status).toBe("updated");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.mcpServers["playwright-test"]).toEqual({
      command: "cmd",
      args: ["/c", "npx", "playwright", "run-test-mcp-server"]
    });
    expect(config.mcpServers["brain-creator"].command).toBe("npx");
    expect(config.mcpServers["brain-creator"].args).toEqual(["brain-creator-mcp"]);
  });

  it("can write a global-install MCP config when requested", async () => {
    const targetDir = await tempDir();

    const result = await writeBrainCreatorMcpConfig({ targetDir, commandMode: "global" });

    const config = JSON.parse(await readFile(result.path, "utf8"));
    expect(config.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-config-"));
  tempDirs.push(dir);
  return dir;
}
