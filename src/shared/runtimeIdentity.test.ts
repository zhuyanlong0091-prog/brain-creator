import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeIdentityReader } from "./runtimeIdentity.js";

describe("running process identity", () => {
  it("keeps build identity when an exported source has no git metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-identity-export-"));
    const path = join(dir, "build-identity.json");
    try {
      writeFileSync(path, JSON.stringify({ packageVersion: "2.1.1", commit: "unknown", dirty: "unknown", buildId: "content-hash", builtAt: "2026-09-08T00:00:00Z" }));
      const read = createRuntimeIdentityReader({ metadataPath: path });
      expect(read({ workspace: dir, schemaVersion: 21, provider: "host-agent" })).toMatchObject({ commit: "unknown", dirty: "unknown", buildId: "content-hash" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("pins build identity even if files change while a process is alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-identity-"));
    const path = join(dir, "build-identity.json");
    try {
      writeFileSync(path, JSON.stringify({ packageVersion: "2.1.1", commit: "a".repeat(40), buildId: "first", builtAt: "2026-09-08T00:00:00Z", dirty: false }));
      const read = createRuntimeIdentityReader({ metadataPath: path });
      const first = read({ workspace: dir, schemaVersion: 21, provider: "host-agent" });
      writeFileSync(path, JSON.stringify({ buildId: "replacement" }));
      const next = read({ workspace: dir, schemaVersion: 21, provider: "codex" });
      expect(first.buildId).toBe("first");
      expect(next.buildId).toBe("first");
      expect(next.pid).toBe(process.pid);
      expect(next.startedAt).toBe(first.startedAt);
      expect(next.provider).toBe("codex");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("reports missing build provenance as unknown instead of reading the user's git checkout", () => {
    const read = createRuntimeIdentityReader({ metadataPath: join(tmpdir(), "missing-bc-build.json") });
    expect(read({ workspace: tmpdir(), schemaVersion: 21, provider: "disabled" })).toMatchObject({
      commit: "unknown", buildId: "unknown", builtAt: "unknown", dirty: "unknown",
      schemaVersion: 21, processKind: "cli"
    });
  });
});
