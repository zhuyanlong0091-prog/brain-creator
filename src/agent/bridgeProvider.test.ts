import { describe, expect, it } from "vitest";
import { createConfiguredAgentBridge, parseAgentArgs } from "./bridgeProvider.js";

describe("createConfiguredAgentBridge", () => {
  it("keeps legacy BRAIN_CREATOR_AGENT_COMMAND as a Claude provider", async () => {
    const bridge = createConfiguredAgentBridge({
      env: {
        BRAIN_CREATOR_AGENT_COMMAND: process.execPath,
        BRAIN_CREATOR_AGENT_ARGS: '["--print"]'
      }
    });

    expect(bridge?.provider).toBe("claude");
    await expect(bridge?.preflight?.()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("creates a Codex provider when requested explicitly", async () => {
    const bridge = createConfiguredAgentBridge({
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "codex",
        BRAIN_CREATOR_CODEX_COMMAND: process.execPath,
        BRAIN_CREATOR_CODEX_ARGS: '["--version"]'
      }
    });

    expect(bridge?.provider).toBe("codex");
    await expect(bridge?.preflight?.()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("returns no bridge when disabled", () => {
    const bridge = createConfiguredAgentBridge({
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "disabled",
        BRAIN_CREATOR_AGENT_COMMAND: process.execPath
      }
    });

    expect(bridge).toBeUndefined();
  });

  it("creates a host-agent bridge that preflights without subprocess execution", async () => {
    const bridge = createConfiguredAgentBridge({
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "host-agent"
      }
    });

    expect(bridge?.provider).toBe("host-agent");
    await expect(bridge?.preflight?.()).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      bridge?.({
        systemId: "system_1",
        agent: "generator",
        inputSummary: "Generate checkout test",
        args: [],
        outputPaths: []
      })
    ).resolves.toEqual(
      expect.objectContaining({
        exitCode: 1,
        stderr: expect.stringContaining("bc_prepare_agent_task")
      })
    );
  });

  it("parses JSON and shell-style bridge args", () => {
    expect(parseAgentArgs('["exec","--json"]')).toEqual(["exec", "--json"]);
    expect(parseAgentArgs("exec --json -")).toEqual(["exec", "--json", "-"]);
  });
});
