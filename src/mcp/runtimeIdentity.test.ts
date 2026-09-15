import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

it("returns running identity before system selection in both status response modes", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "bc-status-identity-"));
  try {
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    for (const responseMode of ["full", "summary"]) {
      const response = await handleBrainCreatorTool(context, "bc_status", { responseMode });
      const block = response.content[0];
      if (block.type !== "text") throw new Error("Expected text envelope");
      const payload = JSON.parse(block.text);
      expect(payload.success).toBe(true);
      expect(payload.data.runtimeIdentity).toMatchObject({ pid: process.pid, workspace: workDir, schemaVersion: 21, processKind: "mcp" });
    }
  } finally { await rm(workDir, { recursive: true, force: true }); }
});
