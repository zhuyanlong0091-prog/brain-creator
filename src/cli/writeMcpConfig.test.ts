import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMcpProviderArg, runWriteMcpConfigCli, writeBrainCreatorMcpConfig } from "./writeMcpConfig.js";

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
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
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
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
  });

  it("can write a Codex provider MCP config when requested", async () => {
    const targetDir = await tempDir();

    const result = await writeBrainCreatorMcpConfig({ targetDir, provider: "codex" });

    const config = JSON.parse(await readFile(result.path, "utf8"));
    expect(config.mcpServers["brain-creator"].env).toEqual({
      BRAIN_CREATOR_WORKSPACE: ".",
      BRAIN_CREATOR_TOOL_PROFILE: "facade",
      BRAIN_CREATOR_AGENT_PROVIDER: "codex",
      BRAIN_CREATOR_CODEX_COMMAND: "codex",
      BRAIN_CREATOR_CODEX_ARGS: "[\"exec\",\"--json\",\"--ephemeral\",\"--sandbox\",\"workspace-write\",\"--ask-for-approval\",\"never\",\"-C\",\"{cwd}\",\"-\"]",
      BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
    });
  });

  it("can write a host-agent provider MCP config when requested", async () => {
    const targetDir = await tempDir();

    const result = await writeBrainCreatorMcpConfig({ targetDir, provider: "host-agent" });

    const config = JSON.parse(await readFile(result.path, "utf8"));
    expect(config.mcpServers["brain-creator"].env).toEqual({
      BRAIN_CREATOR_WORKSPACE: ".",
      BRAIN_CREATOR_TOOL_PROFILE: "facade",
      BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
      BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
    });
  });

  it("rejects an invalid provider instead of silently falling back to auto", async () => {
    await expect(
      writeBrainCreatorMcpConfig({ targetDir: await tempDir(), provider: "cursor" as never })
    ).rejects.toThrow("Unsupported Brain Creator agent provider: cursor");
    expect(() => parseMcpProviderArg("cursor")).toThrow("Unsupported Brain Creator agent provider: cursor");
  });

  it("prints a concise CLI error for an invalid provider", async () => {
    const messages: string[] = [];

    const exitCode = await runWriteMcpConfigCli(["--provider", "cursor"], {
      cwd: await tempDir(),
      log: () => undefined,
      error: (message) => messages.push(message)
    });

    expect(exitCode).toBe(1);
    expect(messages).toEqual(["Unsupported Brain Creator agent provider: cursor"]);
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-config-"));
  tempDirs.push(dir);
  return dir;
}
