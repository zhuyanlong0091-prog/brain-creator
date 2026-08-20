import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("runtime configuration MCP process", () => {
  it("reloads runtime configuration while keeping the MCP process alive", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-runtime-process-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--loader", "ts-node/esm", "src/cli/brainCreatorMcp.ts"],
      cwd: process.cwd(),
      env: {
        ...process.env as Record<string, string>,
        BRAIN_CREATOR_WORKSPACE: workDir,
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "disabled"
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "brain-creator-runtime-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const pid = transport.pid;
      expect(pid).toEqual(expect.any(Number));

      const update = await client.callTool({
        name: "bc_configure",
        arguments: { target: "runtime", operation: "update", bridgeProvider: "disabled" }
      });
      expect(JSON.stringify(update)).toContain("config-reloaded");

      const reload = await client.callTool({
        name: "bc_configure",
        arguments: { target: "runtime", operation: "reload-config" }
      });
      expect(JSON.stringify(reload)).toContain("config-reloaded");
      expect(transport.pid).toBe(pid);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      await rm(workDir, { recursive: true, force: true });
    }
  }, 30_000);
});
