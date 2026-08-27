// @vitest-environment node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  Gap,
  KnowledgeProject,
  SystemProfile,
  TestIntent
} from "../domain/types.js";
import { KnowledgeService } from "./service.js";
import { TestDataProviderService } from "./testDataProvider.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("TestDataProviderService", () => {
  it("previews unresolved lookup work without creating a task", async () => {
    const fixture = await providerFixture();

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: false
    });

    expect(result.status).toBe("preview");
    expect(result.operations).toEqual([
      expect.objectContaining({
        profileId: "profile-customer",
        field: "Customer",
        lookupQuery: "status=active",
        allowedDecisions: ["reuse"]
      })
    ]);
    expect(fixture.repository.testDataTasks).toHaveLength(0);
  });

  it("automatically resolves deterministic generated data without touching the target system", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-name",
        field: "Name",
        strategy: "generated",
        decision: "generate",
        status: "proposed",
        value: "bc-name-1234",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["test-data-profile:profile-name"]
      }],
      dependencyOrder: ["profile-name"],
      requiresConfirmation: true,
      confirmedAt: new Date(0).toISOString(),
      requiresCleanup: false,
      sourceRefs: ["test-data-profile:profile-name"]
    };
    fixture.executableCase.steps = [{
      id: "step-name",
      order: 1,
      action: "fill",
      instruction: "Fill Name",
      targetSemantic: "Name",
      dataProfileId: "profile-name",
      value: undefined,
      origin: "source",
      sourceRefs: ["requirement:customer"]
    }];

    const result = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      automatic: true
    });

    expect(result).toEqual({
      status: "ready",
      operations: [],
      autoResolvedProfileIds: ["profile-name"]
    });
    expect(fixture.repository.testDataTasks).toHaveLength(0);
    expect(fixture.executableCase.dataPlan?.operations[0]).toEqual(
      expect.objectContaining({
        decision: "use-fixed",
        status: "ready",
        value: "bc-name-1234"
      })
    );
    expect(fixture.executableCase.steps[0].value).toBe("bc-name-1234");
  });

  it("does not let automatic resolution bypass the data-plan confirmation gate", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-name",
        field: "Name",
        strategy: "generated",
        decision: "generate",
        status: "proposed",
        value: "bc-name-1234",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["test-data-profile:profile-name"]
      }],
      dependencyOrder: ["profile-name"],
      requiresConfirmation: true,
      requiresCleanup: false,
      sourceRefs: ["test-data-profile:profile-name"]
    };

    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: fixture.system.id,
        executableCaseId: fixture.executableCase.id,
        confirm: true,
        automatic: true
      })
    ).rejects.toThrow("must be confirmed");
  });

  it("creates one idempotent host-agent task with auditable input artifacts", async () => {
    const fixture = await providerFixture();
    const input = {
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    } as const;

    const first = await fixture.provider.prepare(input);
    const second = await fixture.provider.prepare(input);

    expect(first.status).toBe("needs-agent-execution");
    expect(second.task?.id).toBe(first.task?.id);
    expect(fixture.repository.testDataTasks).toHaveLength(1);
    expect(first.task).toEqual(
      expect.objectContaining({
        action: "lookup-or-create",
        allowCreate: true,
        cleanup: "delete-created",
        status: "pending"
      })
    );
    await access(first.task!.contextPath);
    await access(first.task!.promptPath);
    expect(await readFile(first.task!.promptPath, "utf8")).toContain(
      "Do not create data unless lookup cannot satisfy the request"
    );
  });

  it("rejects creation unless the caller explicitly allowed it", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(() =>
      fixture.provider.submit({
        taskId: prepared.task!.id,
        status: "succeeded",
        decision: "create",
        reference: "customer:new-1",
        value: "New Customer",
        sourceRefs: ["browser:evidence/customer-new-1.json"]
      })
    ).toThrow("not allowed");
  });

  it("resolves the executable case from a reused data reference and records a lease", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:42",
      value: "Existing Customer",
      sourceRefs: ["api:customers/42"]
    });

    expect(result.task.status).toBe("submitted");
    expect(result.lease).toEqual(
      expect.objectContaining({
        decision: "reuse",
        reference: "customer:42",
        cleanup: "none",
        status: "active",
        sourceRefs: ["api:customers/42"]
      })
    );
    expect(result.executableCase.dataPlan).toEqual(
      expect.objectContaining({ verdict: "ready" })
    );
    expect(result.executableCase.status).toBe("ready");
    expect(fixture.repository.gaps[0].status).toBe("resolved");

    fixture.repository.executionEvidence.push({
      id: "evidence-reuse-terminal",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-reuse-terminal",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });
    const reacquire = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.lease!.status).toBe("released");
    expect(reacquire).toEqual(
      expect.objectContaining({
        status: "needs-agent-execution",
        task: expect.objectContaining({
          action: "lookup-or-create",
          profileId: "profile-customer",
          status: "pending"
        })
      })
    );
  });

  it("keeps a case stale after its data is resolved", async () => {
    const fixture = await providerFixture();
    fixture.executableCase.status = "stale";
    fixture.executableCase.staleReason = "System Brain transition changed";
    fixture.executableCase.staleByChangeSetId = "change-set-1";
    fixture.repository.testIntents[0].status = "stale";

    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const result = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:stale-case",
      sourceRefs: ["api:customers/stale-case"]
    });

    expect(result.executableCase.status).toBe("stale");
    expect(fixture.repository.testIntents[0].status).toBe("stale");
  });

  it("requires cleanup policy and evidence for created data", async () => {
    const fixture = await providerFixture({ cleanup: "none" });
    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: fixture.system.id,
        executableCaseId: fixture.executableCase.id,
        confirm: true,
        allowCreate: true
      })
    ).rejects.toThrow("cleanup policy");

    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(() =>
      fixture.provider.submit({
        taskId: prepared.task!.id,
        status: "succeeded",
        decision: "reuse",
        reference: "customer:42",
        sourceRefs: []
      })
    ).toThrow("source evidence");
  });

  it("creates a provider gap when the host agent cannot prepare data", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "failed",
      error: "Customer API is unavailable",
      sourceRefs: ["network:customers-timeout"]
    });

    expect(result.task.status).toBe("failed");
    expect(result.gap).toEqual(
      expect.objectContaining({
        sourceType: "test-data-provider",
        sourceId: prepared.task!.id,
        status: "open",
        reason: expect.stringContaining("Customer API is unavailable")
      })
    );
    expect(fixture.executableCase.status).toBe("blocked");

    const retry = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const recovered = fixture.provider.submit({
      taskId: retry.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:42",
      sourceRefs: ["api:customers/42"]
    });

    expect(result.gap!.status).toBe("resolved");
    expect(recovered.executableCase.status).toBe("ready");
  });

  it("prepares cleanup after terminal execution and releases created data", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const submitted = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:new-3",
      value: "New Customer",
      sourceRefs: ["browser:create/customer-new-3.json"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-1",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-1",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(cleanup.task).toEqual(
      expect.objectContaining({
        action: "cleanup",
        leaseId: submitted.lease!.id,
        status: "pending"
      })
    );
    const completed = fixture.provider.submit({
      taskId: cleanup.task!.id,
      status: "succeeded",
      sourceRefs: ["browser:cleanup/customer-new-3.json"]
    });
    expect(completed.lease).toEqual(
      expect.objectContaining({ status: "released", releasedAt: expect.any(String) })
    );
  });

  it("releases reused data during cleanup without dispatching a new lookup", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const submitted = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "reuse",
      reference: "customer:existing-1",
      sourceRefs: ["api:customers/existing-1"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-reuse-1",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-reuse-1",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      phase: "cleanup"
    });

    expect(cleanup).toEqual({ status: "ready", operations: [] });
    expect(submitted.lease).toEqual(
      expect.objectContaining({
        status: "released",
        releasedAt: expect.any(String)
      })
    );
    expect(fixture.repository.testDataTasks).toHaveLength(1);
  });

  it("marks cleanup failures separately from product defects", async () => {
    const fixture = await providerFixture();
    const prepared = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true,
      allowCreate: true
    });
    const submitted = fixture.provider.submit({
      taskId: prepared.task!.id,
      status: "succeeded",
      decision: "create",
      reference: "customer:new-4",
      sourceRefs: ["api:create/customer-new-4"]
    });
    fixture.repository.executionEvidence.push({
      id: "evidence-2",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "case-2",
      contextPackPath: "context.json",
      status: "failed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    const cleanup = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    const result = fixture.provider.submit({
      taskId: cleanup.task!.id,
      status: "failed",
      error: "Delete endpoint returned 409",
      sourceRefs: ["api:cleanup/customer-new-4"]
    });

    expect(submitted.lease!.id).toBe(result.lease!.id);
    expect(result.lease!.status).toBe("cleanup-failed");
    expect(result.gap).toEqual(
      expect.objectContaining({ sourceType: "test-data-cleanup" })
    );

    const retry = await fixture.provider.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(retry.task).toEqual(
      expect.objectContaining({
        action: "cleanup",
        leaseId: submitted.lease!.id,
        status: "pending"
      })
    );
    expect(retry.task!.id).not.toBe(cleanup.task!.id);

    fixture.provider.submit({
      taskId: retry.task!.id,
      status: "succeeded",
      sourceRefs: ["api:cleanup/customer-new-4-retry"]
    });
    expect(result.gap!.status).toBe("resolved");
  });

  it("rejects a case from another system", async () => {
    const fixture = await providerFixture();

    await expect(
      fixture.provider.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: "system-other",
        executableCaseId: fixture.executableCase.id,
        confirm: true
      })
    ).rejects.toThrow("system");
  });
});

async function providerFixture(input: { cleanup?: "none" | "delete-created" | "restore" } = {}) {
  const repository = new InMemoryBrainCreatorRepository();
  const root = await tempDir();
  const project: KnowledgeProject = {
    id: "knowledge-customer",
    key: "customer",
    name: "Customer",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-customer"],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const system: SystemProfile = {
    id: "system-customer",
    name: "Customer Portal",
    environment: "test",
    baseUrl: "https://customer.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://customer.example.test"],
    status: "succeeded",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const intent: TestIntent = {
    id: "intent-customer",
    knowledgeProjectId: project.id,
    requirementSetId: "requirement-customer",
    title: "Use an active customer",
    module: "Customer",
    priority: "P1",
    objective: "Verify a workflow using an active customer.",
    preconditions: [],
    expectedResults: ["The active customer is accepted."],
    requirementRefs: ["requirement:customer"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "blocked",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const gap: Gap = {
    id: "gap-customer-data",
    projectId: project.id,
    sourceType: "test-data-plan",
    sourceId: "executable-customer",
    reason: "Customer requires an existing reference.",
    severity: "high",
    owner: "qa",
    status: "open",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  const executableCase: ExecutableCase = {
    id: "executable-customer",
    knowledgeProjectId: project.id,
    requirementSetId: intent.requirementSetId,
    testIntentId: intent.id,
    systemId: system.id,
    title: intent.title,
    status: "blocked",
    preconditions: [],
    steps: [{
      id: "step-customer",
      order: 1,
      action: "select",
      instruction: "Select Customer",
      targetSemantic: "Customer",
      dataProfileId: "profile-customer",
      origin: "source",
      sourceRefs: ["requirement:customer"]
    }],
    dataProfileIds: ["profile-customer"],
    dataPlan: {
      verdict: "blocked",
      reasons: ["Customer requires lookup before execution."],
      operations: [{
        profileId: "profile-customer",
        field: "Customer",
        strategy: "existing-reference",
        decision: "lookup",
        status: "needs-resolution",
        lookupQuery: "status=active",
        dependsOnProfileIds: [],
        cleanup: input.cleanup ?? "delete-created",
        constraints: ["status must be active"],
        sourceRefs: ["requirement:customer"]
      }],
      dependencyOrder: ["profile-customer"],
      requiresConfirmation: true,
      requiresCleanup: false,
      sourceRefs: ["requirement:customer"]
    },
    gapIds: [gap.id],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  repository.knowledgeProjects.push(project);
  repository.systemProfiles.push(system);
  repository.testIntents.push(intent);
  repository.gaps.push(gap);
  repository.executableCases.push(executableCase);
  const knowledgeService = new KnowledgeService(repository, join(root, "knowledge"));
  const provider = new TestDataProviderService(
    repository,
    knowledgeService,
    join(root, "runtime")
  );
  return { repository, project, system, intent, executableCase, provider };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-data-provider-"));
  tempDirs.push(dir);
  return dir;
}
