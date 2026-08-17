// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActorJourneyStep,
  ExecutionEvidence,
  ExecutableCase,
  RequirementSuiteRun,
  TestDataProfile,
  TestIntent
} from "../domain/types.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { BrainCreatorService } from "../domain/service.js";
import { KnowledgeService } from "../knowledge/service.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { summarizeStabilityRuns } from "../mcp/handlers.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../mcp/handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("real system regression samples", () => {
  it("traverses SPA navigation, pushState, and a remounted form", async () => {
    const fixture = await startRegressionSystem();
    try {
      const workDir = await tempDir("brain-regression-explore-");
      const context = createBrainCreatorMcpContext({
        workDir,
        dataFilePath: join(workDir, "assets.json")
      });
      const system = context.service.createSystemProfile({
        name: "Recruiting regression fixture",
        environment: "test",
        baseUrl: fixture.baseUrl,
        defaultLocale: "en-US",
        urlAllowlist: [fixture.baseUrl]
      });
      const project = await context.knowledgeService.createProject({
        name: "Recruiting regression knowledge",
        key: "recruiting-regression",
        defaultLocale: "en-US"
      });
      context.knowledgeService.bindSystem(project.id, system.id);

      const result = await context.systemExploration.explore({
        knowledgeProjectId: project.id,
        systemId: system.id,
        interactionMode: "safe",
        budget: {
          maxPages: 4,
          maxDepth: 2,
          maxInteractionsPerPage: 4,
          maxDurationMs: 20_000
        }
      });

      expect(result.exploration.status).toBe("completed");
      expect(result.exploration.navigationEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toUrl: `${fixture.baseUrl}module`,
            text: "Open recruitment module"
          }),
          expect.objectContaining({
            toUrl: `${fixture.baseUrl}module/form`,
            text: "Create demand"
          })
        ])
      );
      expect(result.exploration.interactionTransitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetName: "Employee type",
            status: "observed",
            visibleAdded: expect.arrayContaining(["Replacement employee"])
          })
        ])
      );
      expect(result.brain.pages.map((page) => page.route)).toEqual(
        expect.arrayContaining([`${fixture.baseUrl}module/form`])
      );
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("refreshes auth in Chromium and closes created test data after terminal evidence", async () => {
    const fixture = await startRegressionSystem();
    try {
      const workDir = await tempDir("brain-regression-auth-");
      let refreshCount = 0;
      const context = createBrainCreatorMcpContext({
        workDir,
        dataFilePath: join(workDir, "assets.json"),
        authStateMaterializer: async ({ authProfile }) => {
          const path = `.brain-creator/auth/${authProfile.id}/expired.json`;
          await writeStorageState(join(workDir, path), fixture.host, "expired");
          return { storageStatePath: path, method: "token" };
        },
        authStateRefresher: async ({ authProfile }) => {
          refreshCount += 1;
          const path = `.brain-creator/auth/${authProfile.id}/refreshed.json`;
          await writeStorageState(join(workDir, path), fixture.host, "valid");
          return { storageStatePath: path, provider: "regression-refresh" };
        },
        authStateVerifier: async ({ storageStatePath }) => {
          const executablePath = regressionBrowserPath();
          const browser = await chromium.launch({
            headless: true,
            ...(executablePath ? { executablePath } : {})
          });
          try {
            const page = await browser.newPage({ storageState: storageStatePath });
            const response = await page.goto(`${fixture.baseUrl}dashboard`);
            return response?.status() === 200
              ? { status: "valid" as const, finalUrl: page.url() }
              : { status: "expired" as const, reason: "Regression session expired." };
          } finally {
            await browser.close();
          }
        },
        runner: async () => ({ exitCode: 0, stdout: "passed", stderr: "" })
      });
      const system = context.service.createSystemProfile({
        name: "Recruiting auth fixture",
        environment: "test",
        baseUrl: fixture.baseUrl,
        defaultLocale: "en-US",
        urlAllowlist: [fixture.baseUrl]
      });
      const primary = context.service.createAuthProfile({
        projectId: system.id,
        env: "test",
        role: "recruiter",
        loginMethod: "token",
        secrets: { token: "redacted-test-token" }
      });
      const verifiedPrimary = context.service.verifyAuthProfile(primary.id, {
        targetUrl: fixture.baseUrl,
        finalUrl: `${fixture.baseUrl}dashboard`
      });
      const project = await context.knowledgeService.createProject({
        name: "Recruiting auth knowledge",
        key: "recruiting-auth",
        defaultLocale: "en-US"
      });
      context.knowledgeService.bindSystem(project.id, system.id);
      const testCase = context.service.createTestCase({
        systemId: system.id,
        requirement: "Open the authenticated dashboard",
        scenarios: [{
          id: "dashboard-scenario",
          title: "Dashboard is available",
          priority: "high",
          steps: [{ action: "assert", target: "dashboard", expected: "visible" }]
        }],
        newTerms: [],
        ruleCheckResult: { passed: true, checks: [] }
      });
      context.service.approveTestCase(testCase.id);
      const suite = context.requirementSuiteRuns.create({
        knowledgeProjectId: project.id,
        systemId: system.id,
        authProfileId: verifiedPrimary.id,
        cases: [{ executableCaseId: "auth-case", title: testCase.requirement }],
        continueOnBlocked: false
      });

      const result = await handleBrainCreatorTool(context, "bc_run", {
        mode: "approved-case",
        caseId: testCase.id,
        authProfileId: verifiedPrimary.id,
        requirementSuiteRunId: suite.id,
        executableCaseId: "auth-case"
      });

      if (result.isError) {
        throw new Error(result.content.map((item) => item.type === "text" ? item.text : item.type).join("\n"));
      }
      expect(refreshCount).toBe(1);
      expect(context.runLedger.list({ requirementSuiteRunId: suite.id })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "auth-preflight",
            toStatus: "valid",
            message: expect.stringContaining("regression-refresh"),
            references: expect.objectContaining({ authProfileId: verifiedPrimary.id })
          })
        ])
      );

      const dataFixture = createDataFixture(context.repository, project.id, system.id);
      const prepared = await context.testDataProvider.prepare({
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: dataFixture.executableCase.id,
        confirm: true,
        allowCreate: true
      });
      expect(prepared.status).toBe("needs-agent-execution");
      const created = context.testDataProvider.submit({
        taskId: prepared.task!.id,
        status: "succeeded",
        decision: "create",
        reference: "demand:regression-001",
        value: "Regression demand",
        sourceRefs: ["browser:fixture/create-demand.json"]
      });
      expect(created.lease).toEqual(expect.objectContaining({ decision: "create", status: "active" }));
      context.repository.executionEvidence.push({
        id: "evidence-data-terminal",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: dataFixture.executableCase.id,
        testCaseId: "data-test-case",
        contextPackPath: "context.json",
        status: "passed",
        assuranceLevel: "strong",
        steps: [],
        tracePaths: ["trace/data.zip"],
        artifactPaths: ["browser:fixture/create-demand.json"],
        consoleErrors: [],
        networkFailures: [],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      const cleanup = await context.testDataProvider.prepare({
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: dataFixture.executableCase.id,
        confirm: true,
        allowCreate: true
      });
      expect(cleanup.task?.action).toBe("cleanup");
      const released = context.testDataProvider.submit({
        taskId: cleanup.task!.id,
        status: "succeeded",
        sourceRefs: ["browser:fixture/delete-demand.json"]
      });
      expect(released.lease?.status).toBe("released");
      expect(context.repository.testDataLeases.every((lease) => lease.status === "released")).toBe(true);
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("keeps two roles and two requirement scenarios stable across three isolated runs", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new BrainCreatorService(repository);
    const knowledge = new KnowledgeService(repository, await tempDir("brain-regression-stability-knowledge-"));
    const system = service.createSystemProfile({
      name: "Multi-role stability fixture",
      environment: "test",
      baseUrl: "https://stability.regression.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://stability.regression.test"]
    });
    const project = await knowledge.createProject({
      name: "Multi-requirement stability",
      key: "multi-requirement-stability",
      defaultLocale: "en-US"
    });
    knowledge.bindSystem(project.id, system.id);
    const actorJourney: ActorJourneyStep[] = [
      { id: "actor-recruiter", order: 1, role: "recruiter", authProfileId: "auth-recruiter", sourceRefs: ["rule:role-order"] },
      { id: "actor-approver", order: 2, role: "approver", authProfileId: "auth-approver", afterStepId: "actor-recruiter", sourceRefs: ["rule:role-order"] }
    ];
    const evidence: ExecutionEvidence[] = [];
    const runs: RequirementSuiteRun[] = [];
    const suiteRuns = new RequirementSuiteRunService(repository);
    for (const iteration of [1, 2, 3]) {
      const run = suiteRuns.create({
        knowledgeProjectId: project.id,
        systemId: system.id,
        actorJourney: actorJourney.map((step) => ({
          role: step.role,
          authProfileId: step.authProfileId,
          afterStepId: step.afterStepId,
          sourceRefs: step.sourceRefs
        })),
        cases: [
          { executableCaseId: `req-hiring-${iteration}`, title: "REQ-HIRING candidate flow" },
          { executableCaseId: `req-offer-${iteration}`, title: "REQ-OFFER approval flow" }
        ],
        continueOnBlocked: false,
        stabilityGroupId: "multi-requirement-stability",
        stabilityIteration: iteration,
        stabilityTarget: 3
      });
      run.status = "completed";
      run.passed = 2;
      for (const caseRun of run.caseRuns) {
        caseRun.status = "passed";
        const item: ExecutionEvidence = {
          id: `evidence-${iteration}-${caseRun.executableCaseId}`,
          knowledgeProjectId: project.id,
          systemId: system.id,
          executableCaseId: caseRun.executableCaseId,
          testCaseId: `test-${caseRun.executableCaseId}`,
          contextPackPath: `context/${caseRun.executableCaseId}.json`,
          status: "passed",
          assuranceLevel: "strong",
          actorJourney,
          coverage: { required: [], verified: [], missing: [] },
          steps: [],
          tracePaths: [`trace/${caseRun.executableCaseId}.zip`],
          artifactPaths: [`evidence/${caseRun.executableCaseId}.json`],
          consoleErrors: [],
          networkFailures: [],
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        };
        evidence.push(item);
        caseRun.executionEvidenceId = item.id;
      }
      runs.push(run);
    }
    repository.executionEvidence.push(...evidence);

    const stable = summarizeStabilityRuns(runs, repository.executionEvidence);
    expect(stable).toEqual([
      expect.objectContaining({
        target: 3,
        iterations: 3,
        completed: 3,
        strongVerified: 3,
        verdict: "stable"
      })
    ]);

    evidence.at(-1)!.assuranceLevel = "limited";
    const degraded = summarizeStabilityRuns(runs, repository.executionEvidence);
    expect(degraded[0]).toEqual(expect.objectContaining({
      strongVerified: 2,
      verdict: "unstable"
    }));
  });
});

async function startRegressionSystem() {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/dashboard") {
      const valid = request.headers.cookie?.includes("session=valid");
      response.writeHead(valid ? 200 : 401);
      response.end(valid ? "<title>Dashboard</title><h1>Dashboard</h1>" : "<title>Login</title><h1>Login required</h1>");
      return;
    }
    if (path === "/module/form") {
      response.writeHead(200);
      response.end(`
        <title>Create demand</title>
        <main id="app"><label>Employee type<select id="employee-type"><option value="employee">Employee</option><option value="intern">Intern</option></select></label></main>
        <script>
          document.querySelector('#employee-type').onchange = (event) => {
            if (event.target.value === 'intern') document.querySelector('#app').innerHTML = '<label>Employee type<select id="employee-type"><option value="intern" selected>Intern</option></select></label><input aria-label="Replacement employee" id="replacement"><span>Form remounted</span>';
          };
        </script>`);
      return;
    }
    if (path === "/module") {
      response.writeHead(200);
      response.end(`
        <title>Recruitment module</title>
        <main id="app"><a href="/module/form">Create demand</a><button id="create-demand" aria-expanded="false" aria-controls="demand-form">Create demand in SPA</button></main>
        <script>
          document.querySelector('#create-demand').onclick = () => {
            history.pushState({}, '', '/module/form');
            document.querySelector('#app').innerHTML = '<label>Employee type<select id="employee-type"><option value="employee">Employee</option><option value="intern">Intern</option></select></label>';
            document.querySelector('#employee-type').onchange = (event) => {
              if (event.target.value === 'intern') document.querySelector('#app').innerHTML = '<label>Employee type<select id="employee-type"><option value="intern" selected>Intern</option></select></label><input aria-label="Replacement employee" id="replacement"><span>Form remounted</span>';
            };
          };
        </script>`);
      return;
    }
    response.writeHead(200);
    response.end('<title>Recruiting home</title><a href="/module">Open recruitment module</a>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    host: "127.0.0.1",
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function writeStorageState(path: string, host: string, value: "expired" | "valid") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    cookies: [{ name: "session", value, domain: host, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }],
    origins: []
  }), "utf8");
}

function regressionBrowserPath() {
  const candidates = process.platform === "win32"
    ? [
        process.env.BRAIN_CREATOR_TEST_BROWSER_PATH,
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    : [process.env.BRAIN_CREATOR_TEST_BROWSER_PATH];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createDataFixture(repository: InMemoryBrainCreatorRepository, projectId: string, systemId: string) {
  const profile: TestDataProfile = {
    id: "profile-regression-demand",
    knowledgeProjectId: projectId,
    requirementSetId: "requirement-regression",
    name: "Regression demand",
    field: "Demand",
    strategy: "existing-reference",
    constraints: ["status=active"],
    seed: "regression-demand",
    sourceRefs: ["requirement:regression-demand"],
    createdAt: new Date().toISOString()
  };
  const executableCase: ExecutableCase = {
    id: "executable-regression-data",
    knowledgeProjectId: projectId,
    requirementSetId: "requirement-regression",
    testIntentId: "intent-regression-data",
    systemId,
    title: "Create and clean a demand",
    status: "blocked",
    preconditions: [],
    steps: [{
      id: "step-demand",
      order: 1,
      action: "select",
      instruction: "Select the demand",
      targetSemantic: "Demand",
      dataProfileId: profile.id,
      origin: "source",
      sourceRefs: ["requirement:regression-demand"]
    }],
    dataProfileIds: [profile.id],
    dataPlan: {
      verdict: "blocked",
      reasons: ["Demand needs lookup or creation."],
      operations: [{
        profileId: profile.id,
        field: profile.field,
        strategy: profile.strategy,
        decision: "lookup",
        status: "needs-resolution",
        lookupQuery: "status=active",
        dependsOnProfileIds: [],
        cleanup: "delete-created",
        constraints: profile.constraints,
        sourceRefs: profile.sourceRefs
      }],
      dependencyOrder: [profile.id],
      requiresConfirmation: false,
      requiresCleanup: true,
      sourceRefs: profile.sourceRefs
    },
    gapIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  repository.testDataProfiles.push(profile);
  const intent: TestIntent = {
    id: executableCase.testIntentId,
    knowledgeProjectId: projectId,
    requirementSetId: executableCase.requirementSetId,
    title: executableCase.title,
    module: "Recruiting",
    priority: "P1",
    objective: executableCase.title,
    preconditions: [],
    expectedResults: ["The demand is available."],
    requirementRefs: profile.sourceRefs,
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "blocked",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  repository.testIntents.push(intent);
  repository.executableCases.push(executableCase);
  return { executableCase };
}
