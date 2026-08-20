import { describe, expect, it, vi } from "vitest";
import { runBrainCreatorCli, type BrainCreatorCliDependencies } from "./brainCreator.js";

function createIo() {
  return {
    stdout: vi.fn<(message: string) => void>(),
    stderr: vi.fn<(message: string) => void>()
  };
}

function dependencies(
  overrides: Partial<BrainCreatorCliDependencies> = {}
): BrainCreatorCliDependencies {
  return {
    installAssets: vi.fn(async () => ({
      targetDir: "C:\\project",
      installed: ["skill"],
      skipped: []
    })),
    writeMcpConfig: vi.fn(async () => ({
      path: "C:\\project\\.mcp.json",
      status: "created" as const
    })),
    inspectMcpConfig: vi.fn(async () => ({
      path: "C:\\project\\.mcp.json",
      exists: true,
      server: { command: "npx", args: ["brain-creator-mcp"], env: {} }
    })),
    installCodexPlugin: vi.fn(async () => ({
      marketplaceRoot: "C:\\project\\node_modules\\brain-creator",
      mcpConfigPath: "C:\\project\\.mcp.json"
    })),
    buildDoctorReport: vi.fn(() => ({ ok: true, checks: [] }) as never),
    formatDoctorReport: vi.fn(() => "Brain Creator doctor: ready"),
    startMcp: vi.fn(async () => undefined),
    exportSuite: vi.fn(async () => ({
      status: "exported" as const,
      outputPath: "C:\\project\\suite.zip",
      suiteRunId: "suite_1",
      artifactCount: 1,
      missingArtifacts: []
    })),
    migrateArtifacts: vi.fn(async () => ({
      status: "planned" as const,
      migrationId: "artifact-migration-1",
      entries: 2,
      unresolved: 0
    })),
    rollbackArtifactMigration: vi.fn(async () => ({
      status: "rolled-back" as const,
      migrationId: "artifact-migration-1",
      restored: 2
    })),
    retainArtifacts: vi.fn(async () => ({
      status: "planned" as const,
      entries: 1,
      bytes: 128
    })),
    ...overrides
  };
}

describe("Brain Creator CLI", () => {
  it.each([["--version"], ["-v"], ["version"]])(
    "prints the package version for %s",
    async (...args) => {
      const io = createIo();

      expect(await runBrainCreatorCli(args, io, dependencies())).toBe(0);
      expect(io.stdout).toHaveBeenCalledWith("2.1.1");
      expect(io.stderr).not.toHaveBeenCalled();
    }
  );

  it.each([[], ["--help"], ["-h"], ["help"]])(
    "prints task-oriented help for %j",
    async (...args) => {
      const io = createIo();

      expect(await runBrainCreatorCli(args, io, dependencies())).toBe(0);
      const output = io.stdout.mock.calls.flat().join("\n");
      expect(output).toContain("brain-creator init");
      expect(output).toContain("brain-creator doctor");
      expect(output).toContain("brain-creator config");
      expect(output).toContain("brain-creator plugin install");
      expect(output).toContain("brain-creator export");
      expect(output).toContain("brain-creator artifacts");
      expect(output).toContain("brain-creator mcp");
      expect(output).not.toContain("brain-creator-install-assets");
      expect(io.stderr).not.toHaveBeenCalled();
    }
  );

  it("documents legacy executable aliases separately", async () => {
    const io = createIo();

    expect(await runBrainCreatorCli(["help", "legacy"], io, dependencies())).toBe(0);
    const output = io.stdout.mock.calls.flat().join("\n");
    expect(output).toContain("brain-creator-install-assets");
    expect(output).toContain("brain-creator-write-mcp-config");
    expect(output).toContain("Compatibility aliases");
  });

  it.each(["init", "doctor", "config", "plugin", "export", "artifacts", "mcp"])(
    "prints focused help for the %s command",
    async (command) => {
      const io = createIo();

      expect(await runBrainCreatorCli([command, "--help"], io, dependencies())).toBe(0);
      expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining(`brain-creator ${command}`));
      expect(io.stderr).not.toHaveBeenCalled();
    }
  );

  it("initializes assets and MCP config in one idempotent command", async () => {
    const io = createIo();
    const deps = dependencies();

    expect(
      await runBrainCreatorCli(
        ["init", "--target", "C:\\project", "--provider", "codex", "--force"],
        io,
        deps
      )
    ).toBe(0);
    expect(deps.installAssets).toHaveBeenCalledWith({
      targetDir: "C:\\project",
      force: true
    });
    expect(deps.writeMcpConfig).toHaveBeenCalledWith({
      targetDir: "C:\\project",
      commandMode: "local",
      provider: "codex"
    });
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining("initialization complete"));
  });

  it("can initialize the Codex plugin only with host-agent execution", async () => {
    const io = createIo();
    const deps = dependencies();

    expect(
      await runBrainCreatorCli(
        ["init", "--target", "C:\\project", "--with-plugin", "--provider", "host-agent"],
        io,
        deps
      )
    ).toBe(0);
    expect(deps.installCodexPlugin).toHaveBeenCalledWith({ workspaceDir: "C:\\project" });
    expect(deps.writeMcpConfig).not.toHaveBeenCalled();

    const rejectedIo = createIo();
    expect(
      await runBrainCreatorCli(
        ["init", "--with-plugin", "--provider", "claude"],
        rejectedIo,
        dependencies()
      )
    ).toBe(1);
    expect(rejectedIo.stderr).toHaveBeenCalledWith(
      expect.stringContaining("--with-plugin requires --provider host-agent")
    );
  });

  it("shows redacted config by default and writes only when explicitly requested", async () => {
    const io = createIo();
    const deps = dependencies();

    expect(await runBrainCreatorCli(["config", "--json"], io, deps)).toBe(0);
    expect(deps.inspectMcpConfig).toHaveBeenCalledWith({ targetDir: undefined });
    expect(deps.writeMcpConfig).not.toHaveBeenCalled();
    expect(JSON.parse(io.stdout.mock.calls[0][0])).toEqual(
      expect.objectContaining({ success: true, command: "config show" })
    );

    expect(
      await runBrainCreatorCli(
        ["config", "write", "--provider", "claude", "--global"],
        createIo(),
        deps
      )
    ).toBe(0);
    expect(deps.writeMcpConfig).toHaveBeenCalledWith({
      targetDir: undefined,
      commandMode: "global",
      provider: "claude"
    });
  });

  it("runs doctor, MCP, and Codex plugin through the consolidated router", async () => {
    const deps = dependencies();
    const doctorIo = createIo();

    expect(await runBrainCreatorCli(["doctor", "--json"], doctorIo, deps)).toBe(0);
    expect(JSON.parse(doctorIo.stdout.mock.calls[0][0])).toEqual(
      expect.objectContaining({ success: true, command: "doctor" })
    );
    expect(await runBrainCreatorCli(["mcp"], createIo(), deps)).toBe(0);
    expect(deps.startMcp).toHaveBeenCalledOnce();
    expect(
      await runBrainCreatorCli(
        ["plugin", "install", "--target", "C:\\project"],
        createIo(),
        deps
      )
    ).toBe(0);
    expect(deps.installCodexPlugin).toHaveBeenCalledWith({ workspaceDir: "C:\\project" });
  });

  it("exports a Suite archive through the consolidated CLI", async () => {
    const io = createIo();
    const deps = dependencies();

    expect(
      await runBrainCreatorCli(
        ["export", "--suite", "suite_1", "--target", "C:\\project", "--output", "exports\\suite.zip"],
        io,
        deps
      )
    ).toBe(0);
    expect(deps.exportSuite).toHaveBeenCalledWith({
      suiteRunId: "suite_1",
      targetDir: "C:\\project",
      outputPath: "exports\\suite.zip"
    });
  });

  it("plans artifact migration by default and only applies with confirmation", async () => {
    const deps = dependencies();

    expect(await runBrainCreatorCli(
      ["artifacts", "migrate", "--target", "C:\\project", "--json"],
      createIo(),
      deps
    )).toBe(0);
    expect(deps.migrateArtifacts).toHaveBeenCalledWith({
      targetDir: "C:\\project",
      confirm: false
    });

    expect(await runBrainCreatorCli(
      ["migrate", "artifacts", "--target", "C:\\project", "--confirm"],
      createIo(),
      deps
    )).toBe(0);
    expect(deps.migrateArtifacts).toHaveBeenLastCalledWith({
      targetDir: "C:\\project",
      confirm: true
    });
  });

  it("requires confirmation for rollback and supports retention dry-run", async () => {
    const deps = dependencies();
    const rejected = createIo();
    expect(await runBrainCreatorCli(
      ["artifacts", "rollback", "--migration", "artifact-migration-1"],
      rejected,
      deps
    )).toBe(1);
    expect(rejected.stderr).toHaveBeenCalledWith(expect.stringContaining("--confirm"));

    expect(await runBrainCreatorCli(
      ["artifacts", "retention", "--older-than-days", "30", "--system", "system_orders"],
      createIo(),
      deps
    )).toBe(0);
    expect(deps.retainArtifacts).toHaveBeenCalledWith({
      targetDir: undefined,
      olderThanDays: 30,
      systemId: "system_orders",
      confirm: false
    });
  });

  it("returns a structured error for invalid commands", async () => {
    const io = createIo();

    expect(await runBrainCreatorCli(["unknown", "--json"], io, dependencies())).toBe(1);
    expect(JSON.parse(io.stderr.mock.calls[0][0])).toEqual({
      success: false,
      command: "unknown",
      error: "Unknown command: unknown"
    });
  });
});
