import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { EvaluationIntegrityService } from "../evaluation/evaluationIntegrity.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { handleBrainCreatorTool, type BrainCreatorMcpContext } from "./handlers.js";
import { BRAIN_CREATOR_TOOLS } from "./tools.js";

describe("evaluation binding facade", () => {
  it("keeps the optional binding argument in the existing bc_run schema", () => {
    const tool = BRAIN_CREATOR_TOOLS.find((item) => item.name === "bc_run")!;
    expect(tool.inputSchema.parse({ mode: "requirement-suite", evaluationTrialId: "trial" })).toMatchObject({ evaluationTrialId: "trial" });
  });
  it("rejects attaching an existing unbound suite before execution", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeProjects.push({ id: "p", key: "p", name: "P", systemIds: ["s"], defaultLocale: "en", status: "active", createdAt: "", updatedAt: "" });
    const runs = new RequirementSuiteRunService(repository);
    const old = runs.create({ knowledgeProjectId: "p", systemId: "s", cases: [{ executableCaseId: "case", title: "C" }], continueOnBlocked: false });
    const integrity = new EvaluationIntegrityService(repository);
    // Isolate facade ownership selection from the separately tested integrity gate.
    integrity.validateExecutionBinding = () => ({
      valid: true, comparable: true, reasons: [], scenarioIds: [],
      trial: {
        id: "new-trial", comparisonGroupId: "comparison", knowledgeProjectId: "p",
        requirementSourceId: "source", sourceSnapshotId: "snapshot", sourceRevision: 1,
        sourceHash: "hash", provider: "builtin", workspacePath: ".", storePath: "./isolated",
        codeRevision: "revision", runtimeVersions: {}, latestProjectionManifestId: "manifest",
        status: "active", invalidationReasons: [], createdAt: "", updatedAt: ""
      }
    });
    const context = { repository, requirementSuiteRuns: runs, evaluationIntegrity: integrity,
      workDir: ".", knowledgeService: { listExecutableCases: () => [] } } as unknown as BrainCreatorMcpContext;
    const result = await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite", knowledgeProjectId: "p", systemId: "s",
      suiteId: old.id, evaluationTrialId: "new-trial", confirm: true
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("another evaluation trial");
    expect(old.evaluationTrialId).toBeUndefined();
  });
});
