import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  defaultRuntimeConfiguration,
  mergeRuntimeConfiguration,
  readRuntimeConfiguration,
  runtimeEnvironment,
  writeRuntimeConfiguration
} from "./runtimeConfiguration.js";

describe("runtime configuration", () => {
  it("writes and reads an atomic configuration without secret values", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-runtime-config-"));
    try {
      const configuration = mergeRuntimeConfiguration(undefined, {
        bridgeProvider: "codex",
        bridgeCommand: "codex",
        bridgeArgs: ["exec", "--json"],
        connectorConfigs: { feishuAppSecret: "env:BRAIN_CREATOR_FEISHU_APP_SECRET" }
      });
      writeRuntimeConfiguration(workDir, configuration);
      const raw = await readFile(join(workDir, ".brain-creator", "config", "runtime.json"), "utf8");

      expect(raw).toContain("env:BRAIN_CREATOR_FEISHU_APP_SECRET");
      expect(raw).not.toContain("secret-value");
      expect(readRuntimeConfiguration(workDir)).toEqual(configuration);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("keeps explicit environment variables higher priority than file configuration", () => {
    const configuration = mergeRuntimeConfiguration(defaultRuntimeConfiguration(), {
      bridgeProvider: "claude",
      bridgeCommand: "claude-from-file",
      bridgeTimeoutMs: 30_000,
      connectorConfigs: { feishuAppId: "env:FILE_APP_ID" }
    });
    const environment = runtimeEnvironment(configuration, {
      BRAIN_CREATOR_AGENT_PROVIDER: "codex",
      FILE_APP_ID: "app-from-env"
    });

    expect(environment.BRAIN_CREATOR_AGENT_PROVIDER).toBe("codex");
    expect(environment.BRAIN_CREATOR_CLAUDE_COMMAND).toBe("claude-from-file");
    expect(environment.BRAIN_CREATOR_FEISHU_APP_ID).toBe("app-from-env");
    expect(environment.BRAIN_CREATOR_AGENT_TIMEOUT_MS).toBe("30000");
  });

  it("rejects raw connector secrets and invalid timeouts", () => {
    expect(() => mergeRuntimeConfiguration(undefined, {
      connectorConfigs: { feishuAppSecret: "plain-secret" }
    })).toThrow(/env:\/file:/);
    expect(() => mergeRuntimeConfiguration(undefined, {
      bridgeTimeoutMs: 500
    })).toThrow(/between 1000 and 600000/);
  });
});
