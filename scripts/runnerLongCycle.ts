import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ExecutableCase,
  ExecutionEvidence,
  KnowledgeProject,
  RequirementSet,
  SystemProfile,
  TestIntent
} from "../src/domain/types.js";
import { ShardedFileBrainCreatorRepository } from "../src/domain/repository.js";
import { RequirementSuiteRunService } from "../src/knowledge/requirementSuiteRun.js";
import { runScheduledSuites, type ScheduledRunnerResult } from "../src/runner/runner.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorStoreDir
} from "../src/shared/workspace.js";

const RUNNER_GROUP = "github-actions-runner-long-cycle";
const SYSTEM_ID = "github-actions-runner-system";
const PROJECT_ID = "github-actions-runner-project";
const REQUIREMENT_ID = "github-actions-runner-requirement";
const INTENT_ID = "github-actions-runner-intent";
const CASE_ID = "github-actions-runner-case";
const SOURCE_ID = "github-actions-runner-source";

export type RunnerCycleOptions = {
  workspace: string;
  owner?: string;
  targetIterations?: number;
  minIntervalMs?: number;
  leaseMs?: number;
  leaseRenewalMs?: number;
  maxWallTimeMs?: number;
};

export type RunnerCycleReport = {
  schemaVersion: 1;
  synthetic: true;
  status: "progressed" | "complete" | "no-due-runs" | "failed";
  owner: string;
  groupId: string;
  targetIterations: number;
  completedIterations: number;
  strongEvidenceCount: number;
  activeLeases: number;
  runner: ScheduledRunnerResult;
  generatedAt: string;
};

export async function runRunnerCycle(input: RunnerCycleOptions): Promise<RunnerCycleReport> {
  const workspace = resolve(input.workspace);
  const owner = input.owner?.trim() || "github-actions";
  const requestedTargetIterations = positiveInteger(input.targetIterations ?? 20, "targetIterations");
  const minIntervalMs = nonNegativeInteger(input.minIntervalMs ?? 0, "minIntervalMs");
  const repository = new ShardedFileBrainCreatorRepository(
    resolveBrainCreatorStoreDir(workspace, process.env),
    resolveBrainCreatorDataFile(workspace, process.env)
  );
  const suiteService = new RequirementSuiteRunService(repository);
  const existing = repository.requirementSuiteRuns.find(
    (run) => run.stabilityGroupId === RUNNER_GROUP
  );
  const targetIterations = positiveInteger(
    existing?.stabilityTarget ?? requestedTargetIterations,
    "targetIterations"
  );
  const suite = existing ?? seedRunnerFixture(repository, suiteService, targetIterations, minIntervalMs);
  if (
    suite.stabilitySchedule?.status === "active" &&
    !suite.stabilitySchedule.nextRunAt &&
    !suite.stabilitySchedule.leaseId
  ) {
    suite.stabilitySchedule.nextRunAt = new Date().toISOString();
    repository.persist();
  }
  const runner = await runScheduledSuites({
    controller: suiteService,
    owner,
    knowledgeProjectId: PROJECT_ID,
    systemId: SYSTEM_ID,
    leaseMs: input.leaseMs ?? 120_000,
    leaseRenewalMs: input.leaseRenewalMs ?? 30_000,
    maxWallTimeMs: input.maxWallTimeMs ?? 300_000,
    maxRuns: 1,
    maxCasesPerRun: 1,
    execute: async (runId) => {
      const started = suiteService.beginNext(runId);
      if (!started.caseRun) {
        throw new Error(`Runner suite ${runId} had no executable case to process`);
      }
      const iteration = started.run.stabilityIteration ?? 1;
      const now = new Date().toISOString();
      const evidence: ExecutionEvidence = {
        id: `github-actions-runner-evidence-${iteration}`,
        knowledgeProjectId: PROJECT_ID,
        systemId: SYSTEM_ID,
        executableCaseId: started.caseRun.executableCaseId,
        testCaseId: `github-actions-runner-test-${iteration}`,
        contextPackPath: `synthetic/context-${iteration}.json`,
        status: "passed",
        assuranceLevel: "strong",
        steps: [{
          stepId: `${CASE_ID}-step`,
          order: 1,
          action: "assert",
          instruction: "Verify the scheduled Runner heartbeat.",
          targetSemantic: "runner heartbeat",
          expected: "available",
          actual: "available",
          assertionStatus: "passed",
          sourceRefs: [`runner-fixture:iteration-${iteration}`],
          origin: "observed"
        }],
        tracePaths: [`synthetic/trace-${iteration}.zip`],
        artifactPaths: [`synthetic/evidence-${iteration}.json`],
        consoleErrors: [],
        networkFailures: [],
        actualResult: "Runner heartbeat available",
        createdAt: now,
        completedAt: now
      };
      repository.executionEvidence.push(evidence);
      started.caseRun.executionEvidenceId = evidence.id;
      suiteService.completeCase(runId, started.caseRun.executableCaseId, {
        status: "passed",
        chainRunId: `github-actions-runner-chain-${iteration}`,
        gapIds: []
      });
    }
  });

  const runs = repository.requirementSuiteRuns.filter(
    (run) => run.stabilityGroupId === RUNNER_GROUP
  );
  const completedIterations = runs.filter((run) => run.status === "completed").length;
  const strongEvidenceCount = repository.executionEvidence.filter(
    (evidence) => evidence.systemId === SYSTEM_ID && evidence.assuranceLevel === "strong"
  ).length;
  const activeLeases = runs.filter((run) => Boolean(run.stabilitySchedule?.leaseId)).length;
  const report: RunnerCycleReport = {
    schemaVersion: 1,
    synthetic: true,
    status: completedIterations >= targetIterations
      ? "complete"
      : runner.status === "completed"
        ? "progressed"
        : runner.status === "no-due-runs"
          ? "no-due-runs"
          : "failed",
    owner,
    groupId: RUNNER_GROUP,
    targetIterations,
    completedIterations,
    strongEvidenceCount,
    activeLeases,
    runner,
    generatedAt: new Date().toISOString()
  };
  await assertWorkspaceArtifactSafe(resolveBrainCreatorStoreDir(workspace, process.env));
  await writeFile(join(workspace, "runner-report.json"), JSON.stringify(report, null, 2), "utf8");
  if (runner.status === "failed" || runner.status === "blocked") {
    throw new Error(`GitHub Runner cycle did not complete: ${JSON.stringify(report)}`);
  }
  return report;
}

function seedRunnerFixture(
  repository: ShardedFileBrainCreatorRepository,
  suiteService: RequirementSuiteRunService,
  targetIterations: number,
  minIntervalMs: number
) {
  const now = new Date().toISOString();
  const system: SystemProfile = {
    id: SYSTEM_ID,
    name: "GitHub Actions Runner fixture",
    environment: "synthetic",
    baseUrl: "https://runner-fixture.invalid",
    defaultLocale: "en-US",
    urlAllowlist: ["https://runner-fixture.invalid"],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  };
  const project: KnowledgeProject = {
    id: PROJECT_ID,
    key: "github-actions-runner",
    name: "GitHub Actions Runner fixture",
    defaultLocale: "en-US",
    status: "active",
    systemIds: [SYSTEM_ID],
    createdAt: now,
    updatedAt: now
  };
  const requirement: RequirementSet = {
    id: REQUIREMENT_ID,
    knowledgeProjectId: PROJECT_ID,
    sourceId: SOURCE_ID,
    version: 1,
    title: "Runner heartbeat requirement",
    summary: "The scheduled Runner records one strong evidence result per iteration.",
    contentHash: "github-actions-runner-requirement-v1",
    status: "approved",
    affectedNodeIds: [],
    createdAt: now,
    updatedAt: now
  };
  const intent: TestIntent = {
    id: INTENT_ID,
    knowledgeProjectId: PROJECT_ID,
    requirementSetId: REQUIREMENT_ID,
    title: "Record a strong Runner iteration",
    module: "Runner",
    priority: "P1",
    objective: "Record one auditable strong-evidence Runner iteration.",
    preconditions: [],
    expectedResults: ["The iteration is completed with strong evidence."],
    requirementRefs: [`requirement:${REQUIREMENT_ID}`],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "approved",
    createdAt: now,
    updatedAt: now
  };
  const executableCase: ExecutableCase = {
    id: CASE_ID,
    knowledgeProjectId: PROJECT_ID,
    requirementSetId: REQUIREMENT_ID,
    testIntentId: INTENT_ID,
    systemId: SYSTEM_ID,
    title: "Record a strong Runner iteration",
    status: "ready",
    preconditions: [],
    steps: [{
      id: `${CASE_ID}-step`,
      order: 1,
      action: "assert",
      instruction: "Verify the scheduled Runner heartbeat.",
      targetSemantic: "runner heartbeat",
      assertion: { type: "state", strength: "strong", expected: "available" },
      origin: "source",
      sourceRefs: [`requirement:${REQUIREMENT_ID}`]
    }],
    dataProfileIds: [],
    gapIds: [],
    createdAt: now,
    updatedAt: now
  };
  repository.systemProfiles.push(system);
  repository.knowledgeProjects.push(project);
  repository.requirementSets.push(requirement);
  repository.testIntents.push(intent);
  repository.executableCases.push(executableCase);
  repository.persist();
  const suite = suiteService.create({
    knowledgeProjectId: PROJECT_ID,
    systemId: SYSTEM_ID,
    requirementSetIds: [REQUIREMENT_ID],
    cases: [{ executableCaseId: CASE_ID, title: executableCase.title }],
    continueOnBlocked: false,
    stabilityGroupId: RUNNER_GROUP,
    stabilityIteration: 1,
    stabilityTarget: targetIterations,
    stabilityPolicy: {
      targetIterations,
      minIterations: targetIterations,
      minIntervalMs,
      requireStrongEvidence: true,
      maxDurationMs: 300_000
    }
  });
  suite.stabilitySchedule = {
    ...suite.stabilitySchedule!,
    nextRunAt: now
  };
  repository.persist();
  return suite;
}

async function assertWorkspaceArtifactSafe(storeDir: string) {
  const files = await listFiles(storeDir);
  const credentialPattern = /(?:password|access_token|refresh_token|serviceTicket|samlResponse|authorization|bearer)\s*["']?\s*[:=]\s*["']([^"']+)/iu;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (credentialPattern.test(content)) {
      throw new Error(`Runner state contains credential-like material and cannot be uploaded: ${file}`);
    }
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function numberOption(args: string[], name: string, fallback: number) {
  const value = optionValue(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function parseOptions(args: string[]): RunnerCycleOptions {
  const allowed = new Set([
    "--workspace",
    "--owner",
    "--target-iterations",
    "--min-interval-ms",
    "--lease-ms",
    "--lease-renewal-ms",
    "--max-wall-time-ms"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index])) throw new Error(`Unknown option: ${args[index]}`);
    index += 1;
  }
  const workspace = optionValue(args, "--workspace") ?? process.env.BRAIN_CREATOR_RUNNER_WORKSPACE ?? process.cwd();
  return {
    workspace,
    owner: optionValue(args, "--owner") ?? process.env.BRAIN_CREATOR_RUNNER_OWNER ?? "github-actions",
    targetIterations: numberOption(args, "--target-iterations", Number(process.env.BRAIN_CREATOR_RUNNER_TARGET ?? 20)),
    minIntervalMs: numberOption(args, "--min-interval-ms", Number(process.env.BRAIN_CREATOR_RUNNER_MIN_INTERVAL_MS ?? 0)),
    leaseMs: numberOption(args, "--lease-ms", Number(process.env.BRAIN_CREATOR_RUNNER_LEASE_MS ?? 120_000)),
    leaseRenewalMs: numberOption(args, "--lease-renewal-ms", Number(process.env.BRAIN_CREATOR_RUNNER_LEASE_RENEWAL_MS ?? 30_000)),
    maxWallTimeMs: numberOption(args, "--max-wall-time-ms", Number(process.env.BRAIN_CREATOR_RUNNER_MAX_WALL_TIME_MS ?? 300_000))
  };
}

if (process.argv[1]?.endsWith("runnerLongCycle.ts")) {
  runRunnerCycle(parseOptions(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
