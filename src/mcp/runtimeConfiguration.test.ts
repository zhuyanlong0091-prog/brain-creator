import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

describe("runtime configuration facade", () => {
  it("updates and reloads runtime configuration without replacing the MCP context", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-runtime-facade-"));
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "disabled";
    try {
      const context = createBrainCreatorMcpContext({
        workDir,
        dataFilePath: join(workDir, "assets.json")
      });
      const result = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "update",
        bridgeProvider: "disabled",
        connectorConfigs: { feishuAppSecret: "env:BRAIN_CREATOR_FEISHU_APP_SECRET" }
      }));

      expect(result).toEqual(expect.objectContaining({
        status: "config-reloaded",
        connectorStatus: "host-agent-fallback",
        registeredAuthProviders: expect.arrayContaining(["oauth", "cas", "saml"])
      }));
      expect(context.runtimeConfiguration?.bridgeProvider).toBe("disabled");
      expect(await readFile(context.runtimeConfigurationPath, "utf8")).toContain("env:BRAIN_CREATOR_FEISHU_APP_SECRET");

      const restored = JSON.parse(await readFile(context.runtimeConfigurationPath, "utf8"));
      restored.bridgeProvider = "disabled";
      await writeFile(context.runtimeConfigurationPath, JSON.stringify(restored), "utf8");
      const reloaded = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "reload-config"
      }));
      expect(reloaded.status).toBe("config-reloaded");
    } finally {
      if (previousProvider === undefined) delete process.env.BRAIN_CREATOR_AGENT_PROVIDER;
      else process.env.BRAIN_CREATOR_AGENT_PROVIDER = previousProvider;
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("keeps the active runtime configuration when the candidate bridge fails preflight", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-runtime-failure-"));
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    const previousCommand = process.env.BRAIN_CREATOR_AGENT_COMMAND;
    const previousArgs = process.env.BRAIN_CREATOR_AGENT_ARGS;
    const previousTimeout = process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "disabled";
    try {
      const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "update",
        bridgeProvider: "disabled"
      });
      delete process.env.BRAIN_CREATOR_AGENT_PROVIDER;
      delete process.env.BRAIN_CREATOR_AGENT_COMMAND;
      delete process.env.BRAIN_CREATOR_AGENT_ARGS;
      delete process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS;

      const failed = envelopeOf(await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "update",
        bridgeProvider: "claude",
        bridgeCommand: "brain-creator-command-that-does-not-exist"
      }));

      expect(failed.success).toBe(false);
      expect(failed.error.code).toBe("BC_RUNTIME_PREFLIGHT_FAILED");
      expect(context.runtimeConfiguration?.bridgeProvider).toBe("disabled");
    } finally {
      if (previousProvider === undefined) delete process.env.BRAIN_CREATOR_AGENT_PROVIDER;
      else process.env.BRAIN_CREATOR_AGENT_PROVIDER = previousProvider;
      if (previousCommand === undefined) delete process.env.BRAIN_CREATOR_AGENT_COMMAND;
      else process.env.BRAIN_CREATOR_AGENT_COMMAND = previousCommand;
      if (previousArgs === undefined) delete process.env.BRAIN_CREATOR_AGENT_ARGS;
      else process.env.BRAIN_CREATOR_AGENT_ARGS = previousArgs;
      if (previousTimeout === undefined) delete process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS;
      else process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS = previousTimeout;
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const envelope = envelopeOf(result);
  if (!envelope.success) throw new Error(JSON.stringify(envelope));
  return envelope.data;
}

function envelopeOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  return JSON.parse(text);
}
