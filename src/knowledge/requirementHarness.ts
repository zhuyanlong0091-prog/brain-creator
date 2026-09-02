import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrainEvalResult, BrainTask, BrainContextPack } from "../brain/types.js";
import type { HarnessRuntime } from "../brain/harness.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  BusinessObjectModel,
  DecisionTableModel,
  Gap,
  KnowledgeNodeType,
  RequirementContentBlock,
  StateMachineModel,
  WorkflowModel
} from "../domain/types.js";
import { id } from "../shared/id.js";
import {
  REQUIREMENT_ANALYSIS_POLICY,
  type RequirementAnalysis,
  type RequirementClause,
  type RequirementClauseKind
} from "./policies.js";
import { buildProcessModels } from "./processModels.js";

export type RequirementHarnessStage =
  | "document-mapper"
  | "clause-analyst"
  | "business-modeler"
  | "coverage-critic";

export type DocumentMapperOutput = {
  policyId?: string;
  policyVersion?: string;
  goals: string[];
  scope: string[];
  modules: string[];
  actors: string[];
  businessObjects: string[];
  attachmentRefs: string[];
  risks: string[];
  sourceRefs: string[];
};

export type ClauseAnalystOutput = {
  module: string;
  clauses: Array<{
    id: string;
    index: number;
    text: string;
    sourceRefs: string[];
    module: string;
    kind: RequirementClauseKind;
    origin: "explicit" | "derived";
    confidence: number;
    status: "draft" | "confirmed" | "conflicted";
    nodeTypes: KnowledgeNodeType[];
  }>;
  openQuestions: string[];
};

type HostWorkflowModel = Omit<WorkflowModel, "id" | "knowledgeProjectId" | "requirementSetId" | "status" | "createdAt" | "updatedAt"> & {
  localId: string;
};

type HostStateMachineModel = Omit<StateMachineModel, "id" | "knowledgeProjectId" | "requirementSetId" | "status" | "createdAt" | "updatedAt"> & {
  localId: string;
};

export type BusinessModelerOutput = {
  businessObjectModels: Array<Omit<BusinessObjectModel, "id" | "requirementSetId" | "semanticConceptId" | "status"> & {
    localId: string;
  }>;
  workflowModels: HostWorkflowModel[];
  stateMachineModels: HostStateMachineModel[];
  decisionTableModels: Array<Omit<DecisionTableModel, "id" | "requirementSetId" | "status"> & {
    localId: string;
  }>;
  invariants: string[];
};

export type CoverageCriticOutput = {
  verdict: "pass" | "needs-review" | "retry" | "blocked";
  score: number;
  reasons: string[];
  missingMainFlows: string[];
  missingBranches: string[];
  missingExceptions: string[];
  missingActors: string[];
  missingEndStates: string[];
  contradictions: string[];
  unsupportedInferences: string[];
  requiredActions: string[];
  evidenceRefs: string[];
};

export type RequirementModelBundle = {
  businessObjectModels: BusinessObjectModel[];
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  decisionTableModels: DecisionTableModel[];
};

export type RequirementHostHarnessResult = {
  analysis: RequirementAnalysis;
  models: RequirementModelBundle;
  evaluation: BrainEvalResult;
  critic: CoverageCriticOutput;
};

export type RequirementHostHarnessResponse = {
  status: "needs-host-analysis" | "completed" | "blocked";
  stage?: RequirementHarnessStage;
  retry?: boolean;
  task: BrainTask;
  prompt?: string;
  requiredOutput?: string;
  result?: RequirementHostHarnessResult;
  gap?: Gap;
};

type StageOutputs = Partial<{
  "document-mapper": DocumentMapperOutput;
  "clause-analyst": ClauseAnalystOutput;
  "business-modeler": BusinessModelerOutput;
  "coverage-critic": CoverageCriticOutput;
}>;

export const REQUIREMENT_HOST_HARNESS_STAGES: readonly RequirementHarnessStage[] = [
  "document-mapper",
  "clause-analyst",
  "business-modeler",
  "coverage-critic"
];

const STAGES = [...REQUIREMENT_HOST_HARNESS_STAGES];

const MAX_CONTEXT_CHARS = 50_000;
const CLAUSE_KINDS: readonly RequirementClauseKind[] = [
  "goal", "actor", "object", "action", "field", "rule", "condition", "workflow", "state",
  "permission", "integration", "exception", "data-constraint"
];
const KNOWLEDGE_NODE_TYPES: readonly KnowledgeNodeType[] = [
  "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
  "integration", "data-constraint", "term", "requirement"
];

export function requirementHostHarnessArchitecture() {
  return {
    stages: [...REQUIREMENT_HOST_HARNESS_STAGES],
    isolatedCritic: REQUIREMENT_HOST_HARNESS_STAGES.at(-1) === "coverage-critic",
    normalAgentCallBudget: REQUIREMENT_HOST_HARNESS_STAGES.length,
    structuredRetryBudget: 1,
    contextCharBudget: MAX_CONTEXT_CHARS
  };
}

export class RequirementAnalysisHostHarness {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly harness: HarnessRuntime,
    private readonly knowledgeDir: string
  ) {}

  async start(requirementSetId: string): Promise<RequirementHostHarnessResponse> {
    const requirementSet = this.requirementSet(requirementSetId);
    const pending = this.repository.brainTasks.find(
      (task) =>
        task.requirementSetId === requirementSetId &&
        task.operation.startsWith("requirement-analysis:") &&
        task.state === "waiting-provider"
    );
    if (pending) return this.taskPackage(pending, stageFromTask(pending));
    const session = this.harness.createSession({
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      currentRequirementSetId: requirementSet.id,
      provider: "host-agent"
    });
    return this.createStageTask(requirementSet.id, "document-mapper", session.id, false);
  }

  async startFromHostSkill(analysis: RequirementAnalysis): Promise<RequirementHostHarnessResponse> {
    const requirementSet = this.requirementSet(analysis.requirementSetId);
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId)!;
    const session = this.harness.createSession({
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      currentRequirementSetId: requirementSet.id,
      provider: "host-skill"
    });
    const sourceRefs = unique(analysis.clauses.flatMap((clause) => clause.sourceRefs));
    const mapper: DocumentMapperOutput = {
      policyId: analysis.policyId,
      policyVersion: analysis.policyVersion,
      goals: analysis.clauses.filter((clause) => clause.kind === "goal").map((clause) => clause.text),
      scope: unique(analysis.clauses.map((clause) => clause.module)),
      modules: unique([analysis.module, ...analysis.clauses.map((clause) => clause.module)]),
      actors: unique(analysis.nodes.filter((node) => node.type === "actor").map((node) => node.title)),
      businessObjects: unique(analysis.nodes.filter((node) => node.type === "object").map((node) => node.title)),
      attachmentRefs: this.repository.attachmentAnalyses
        .filter((item) => item.requirementSetId === requirementSet.id && item.status === "confirmed")
        .map((item) => `attachment-analysis:${item.id}`),
      risks: analysis.risks,
      sourceRefs
    };
    const analyst: ClauseAnalystOutput = {
      module: analysis.module,
      clauses: analysis.clauses.map(({ sourceRef: _sourceRef, policyId: _policyId, policyVersion: _policyVersion, ...clause }) => clause),
      openQuestions: analysis.openQuestions
    };
    const allowedPrefixes = this.allowedSourcePrefixes(requirementSet.id);
    for (const [stage, output] of [["document-mapper", mapper], ["clause-analyst", analyst]] as const) {
      const validation = validateStageOutput(stage, output, allowedPrefixes);
      if (!validation.ok) {
        throw new Error(`Host Skill ${stage} normalization failed: ${validation.errors.join("; ")}`);
      }
      await this.seedStageTask(requirementSet.id, stage, session.id, source, output);
    }
    return this.createStageTask(requirementSet.id, "business-modeler", session.id, false);
  }

  async submit(input: { taskId: string; output: unknown }): Promise<RequirementHostHarnessResponse> {
    const task = this.harness.getTask(input.taskId);
    if (!task || !task.operation.startsWith("requirement-analysis:")) {
      throw new Error("Requirement Host Harness task not found");
    }
    if (task.state !== "waiting-provider") {
      throw new Error(`Requirement Host Harness task is not waiting for output: ${task.state}`);
    }
    const stage = stageFromTask(task);
    const validation = validateStageOutput(stage, input.output, this.allowedSourcePrefixes(task.requirementSetId!));
    if (!validation.ok) return this.handleInvalidOutput(task, stage, validation.errors);

    const output = input.output as StageOutputs[RequirementHarnessStage];
    const artifactPath = await this.writeStageOutput(task, stage, output);
    if (stage !== "coverage-critic") {
      this.harness.completeDeferredTask(task.id, stagePassEvaluation(stage, output), [artifactPath]);
      return this.createStageTask(task.requirementSetId!, STAGES[STAGES.indexOf(stage) + 1], task.sessionId!, false);
    }
    this.harness.setOutputRefs(task.id, [artifactPath]);
    const outputs = {
      ...(await this.readStageOutputs(task.sessionId!)),
      "coverage-critic": output as CoverageCriticOutput
    } as Required<StageOutputs>;
    const result = this.assembleResult(task.requirementSetId!, outputs, task.sessionId!);
    if (result.evaluation.verdict === "retry") {
      return this.handleInvalidOutput(task, stage, result.evaluation.reasons.length > 0
        ? result.evaluation.reasons
        : ["Coverage Critic requested one retry"]);
    }
    this.harness.completeDeferredTask(task.id, result.evaluation, [artifactPath]);
    if (result.evaluation.verdict === "blocked") {
      const gap = this.createGap(
        task.requirementSetId!,
        stage,
        result.evaluation.reasons,
        "Requirement analysis was blocked by the Coverage Critic"
      );
      return { status: "blocked", stage, task: this.harness.getTask(task.id)!, result, gap };
    }
    return { status: "completed", task: this.harness.getTask(task.id)!, result };
  }

  async latestCompletedResult(requirementSetId: string) {
    const criticTask = this.repository.brainTasks
      .filter(
        (task) =>
          task.requirementSetId === requirementSetId &&
          task.operation === "requirement-analysis:coverage-critic" &&
          task.outputRefs.length > 0 &&
          task.sessionId
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!criticTask?.sessionId) return undefined;
    const outputs = await this.readStageOutputs(criticTask.sessionId);
    if (!STAGES.every((stage) => outputs[stage])) return undefined;
    return this.assembleResult(requirementSetId, outputs as Required<StageOutputs>, criticTask.sessionId);
  }

  private async handleInvalidOutput(
    task: BrainTask,
    stage: RequirementHarnessStage,
    errors: string[]
  ): Promise<RequirementHostHarnessResponse> {
    const attempts = this.repository.brainTasks.filter(
      (candidate) => candidate.sessionId === task.sessionId && candidate.operation === task.operation
    ).length;
    const evaluation: BrainEvalResult = {
      verdict: attempts === 1 ? "retry" : "blocked",
      score: 0,
      reasons: errors,
      affectedAssetIds: [task.requirementSetId!],
      evidenceRefs: task.inputRefs,
      nextActions: attempts === 1
        ? [`Retry ${stage} once with output matching the declared schema`]
        : ["Review the requirement source and resume the blocked analysis"]
    };
    this.harness.completeDeferredTask(task.id, evaluation);
    if (attempts === 1) {
      this.harness.transition(task.id, "failed", "Invalid structured output; one retry was scheduled");
      return this.createStageTask(task.requirementSetId!, stage, task.sessionId!, true);
    }
    const gap = this.createGap(task.requirementSetId!, stage, errors);
    return { status: "blocked", stage, task: this.harness.getTask(task.id)!, gap };
  }

  private async createStageTask(
    requirementSetId: string,
    stage: RequirementHarnessStage,
    sessionId: string,
    retry: boolean
  ): Promise<RequirementHostHarnessResponse> {
    const requirementSet = this.requirementSet(requirementSetId);
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId)!;
    const outputs = await this.readStageOutputs(sessionId);
    const contextPack = buildContextPack(stage, requirementSet.id, source, this.repository.attachmentAnalyses.filter(
      (analysis) => analysis.requirementSetId === requirementSetId && analysis.status === "confirmed"
    ), outputs);
    const task = this.harness.startDeferredTask({
      brain: "requirement",
      operation: `requirement-analysis:${stage}`,
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId,
      sessionId,
      inputSummary: `${retry ? "Retry" : "Run"} ${stage} for ${requirementSet.title}`,
      inputRefs: contextPack.references.map((reference) => reference.ref),
      contextPack,
      provider: "host-agent",
      policy: {
        allowedActions: ["analyze-requirement"],
        forbiddenActions: ["observe-system", "modify-source", "approve-baseline"],
        allowWrites: false,
        requireApproval: false
      },
      budget: {
        maxAgentCalls: 1,
        maxHealAttempts: 0,
        maxWrites: 0,
        maxDurationMs: 300_000,
        maxContextChars: MAX_CONTEXT_CHARS
      },
      approved: true
    });
    return this.taskPackage(task, stage, retry);
  }

  private async seedStageTask(
    requirementSetId: string,
    stage: RequirementHarnessStage,
    sessionId: string,
    source: {
      id: string;
      title: string;
      content: string;
      blocks: RequirementContentBlock[];
      attachments: Array<{ id?: string; name: string; status?: string }>;
    },
    output: StageOutputs[RequirementHarnessStage]
  ) {
    const requirementSet = this.requirementSet(requirementSetId);
    const outputs = await this.readStageOutputs(sessionId);
    const contextPack = buildContextPack(
      stage,
      requirementSetId,
      source,
      this.repository.attachmentAnalyses.filter(
        (analysis) => analysis.requirementSetId === requirementSetId && analysis.status === "confirmed"
      ),
      outputs
    );
    const task = this.harness.createTask({
      brain: "requirement",
      operation: `requirement-analysis:${stage}`,
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId,
      sessionId,
      inputSummary: `Normalize ${stage} from Host Skill output`,
      inputRefs: contextPack.references.map((reference) => reference.ref),
      contextPack,
      provider: "host-skill",
      policy: {
        allowedActions: ["normalize-host-skill"],
        forbiddenActions: ["approve-baseline"],
        allowWrites: false,
        requireApproval: false
      },
      budget: { maxAgentCalls: 0, maxHealAttempts: 0, maxWrites: 0, maxDurationMs: 300_000, maxContextChars: MAX_CONTEXT_CHARS }
    });
    this.harness.transition(task.id, "context-ready");
    this.harness.transition(task.id, "executing");
    const artifactPath = await this.writeStageOutput(task, stage, output);
    this.harness.setOutputRefs(task.id, [artifactPath]);
    this.harness.transition(task.id, "evaluating");
    this.harness.applyEval(task.id, stagePassEvaluation(stage, output));
    return this.harness.getTask(task.id)!;
  }

  private taskPackage(task: BrainTask, stage: RequirementHarnessStage, retry = false): RequirementHostHarnessResponse {
    return {
      status: "needs-host-analysis",
      stage,
      retry,
      task,
      prompt: stagePrompt(stage, task.contextPack!),
      requiredOutput: stageOutputTemplate(stage)
    };
  }

  private async writeStageOutput(task: BrainTask, stage: RequirementHarnessStage, output: unknown) {
    const requirementSet = this.requirementSet(task.requirementSetId!);
    const project = this.repository.knowledgeProjects.find((item) => item.id === requirementSet.knowledgeProjectId)!;
    const directory = join(
      this.knowledgeDir,
      project.key,
      "requirements",
      requirementSet.id,
      "host-harness",
      task.sessionId!
    );
    await mkdir(directory, { recursive: true });
    const attempt = this.repository.brainTasks.filter(
      (candidate) => candidate.sessionId === task.sessionId && candidate.operation === task.operation
    ).length;
    const path = join(directory, `${stage}${attempt > 1 ? `-retry-${attempt - 1}` : ""}.json`);
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return path;
  }

  private async readStageOutputs(sessionId: string): Promise<StageOutputs> {
    const outputs: StageOutputs = {};
    const completed = this.repository.brainTasks
      .filter((task) => task.sessionId === sessionId && task.outputRefs.length > 0)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const task of completed) {
      const stage = stageFromTask(task);
      const path = task.outputRefs[0];
      if (!path) continue;
      outputs[stage] = JSON.parse(await readFile(path, "utf8")) as never;
    }
    return outputs;
  }

  private assembleResult(
    requirementSetId: string,
    outputs: Required<StageOutputs>,
    sessionId: string
  ): RequirementHostHarnessResult {
    const requirementSet = this.requirementSet(requirementSetId);
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId)!;
    const policyId = outputs["document-mapper"].policyId ?? REQUIREMENT_ANALYSIS_POLICY.id;
    const policyVersion = outputs["document-mapper"].policyVersion ?? REQUIREMENT_ANALYSIS_POLICY.version;
    const provider = this.repository.brainSessions.find((session) => session.id === sessionId)?.provider === "host-skill"
      ? "host-skill" as const
      : "host-agent" as const;
    const clauses = outputs["clause-analyst"].clauses.map((clause): RequirementClause => ({
      ...clause,
      sourceRef: clause.sourceRefs[0],
      policyId,
      policyVersion
    }));
    const critic = outputs["coverage-critic"];
    const analysis: RequirementAnalysis = {
      requirementSetId,
      policyId,
      policyVersion,
      provider,
      module: outputs["clause-analyst"].module || outputs["document-mapper"].modules[0] || "General",
      clauses,
      nodes: clauses.flatMap((clause) => nodesForClause(requirementSetId, clause, policyId, policyVersion)),
      openQuestions: unique([
        ...outputs["clause-analyst"].openQuestions,
        ...critic.requiredActions
      ]),
      risks: unique(outputs["document-mapper"].risks),
      contradictions: unique(critic.contradictions),
      missingBranches: unique([
        ...critic.missingMainFlows,
        ...critic.missingBranches,
        ...critic.missingExceptions,
        ...critic.missingActors,
        ...critic.missingEndStates
      ])
    };
    const hostModels = normalizeHostModels(requirementSet.knowledgeProjectId, requirementSetId, outputs["business-modeler"]);
    const attachmentModels = buildProcessModels({
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId,
      analyses: this.repository.attachmentAnalyses.filter((item) => item.requirementSetId === requirementSetId)
    });
    const models: RequirementModelBundle = {
      businessObjectModels: hostModels.businessObjectModels,
      workflowModels: [...hostModels.workflowModels, ...attachmentModels.workflowModels],
      stateMachineModels: [...hostModels.stateMachineModels, ...attachmentModels.stateMachineModels],
      decisionTableModels: hostModels.decisionTableModels
    };
    const criticalAttachments = source.attachments.filter(
      (attachment) => isCriticalProcessAttachment(attachment.name) &&
        !this.repository.attachmentAnalyses.some(
          (analysis) =>
            analysis.requirementSetId === requirementSetId &&
            analysis.attachmentId === attachment.id &&
            analysis.status === "confirmed"
        )
    );
    const reasons = unique([
      ...critic.reasons,
      ...critic.unsupportedInferences.map((value) => `Unsupported inference: ${value}`),
      ...criticalAttachments.map((attachment) =>
        `A critical process attachment has not been confirmed: ${attachment.name}`
      )
    ]);
    const verdict: BrainEvalResult["verdict"] = criticalAttachments.length > 0 || critic.verdict === "blocked"
      ? "blocked"
      : critic.verdict === "retry"
        ? "retry"
        : critic.verdict === "needs-review" || critic.unsupportedInferences.length > 0
          ? "needs-review"
          : "pass";
    const evaluation: BrainEvalResult = {
      verdict,
      score: verdict === "blocked" ? Math.min(critic.score, 0.5) : critic.score,
      reasons,
      affectedAssetIds: [requirementSetId],
      evidenceRefs: unique([
        ...critic.evidenceRefs,
        ...clauses.flatMap((clause) => clause.sourceRefs)
      ]),
      nextActions: verdict === "pass" ? ["Review the generated requirement baseline"] : critic.requiredActions
    };
    return { analysis, models, evaluation, critic };
  }

  private createGap(
    requirementSetId: string,
    stage: RequirementHarnessStage,
    errors: string[],
    summary = "Structured output remained invalid after one retry"
  ) {
    const requirementSet = this.requirementSet(requirementSetId);
    const now = new Date().toISOString();
    const gap: Gap = {
      id: id("gap"),
      projectId: requirementSet.knowledgeProjectId,
      sourceType: "requirement-host-harness",
      sourceId: requirementSet.id,
      reason: `${summary} at ${stage}: ${errors.join("; ")}`,
      severity: "high",
      owner: "requirement-brain",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    this.repository.persist();
    return gap;
  }

  private requirementSet(requirementSetId: string) {
    const requirementSet = this.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!requirementSet) throw new Error("Requirement set not found");
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId);
    if (!source) throw new Error("Requirement source not found");
    return requirementSet;
  }

  private allowedSourcePrefixes(requirementSetId: string) {
    const requirementSet = this.requirementSet(requirementSetId);
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId)!;
    return [
      `source:${source.id}#`,
      ...this.repository.attachmentAnalyses
        .filter((item) => item.requirementSetId === requirementSetId && item.status === "confirmed")
        .flatMap((analysis) => [
          `attachment-analysis:${analysis.id}`,
          ...analysis.sourceRefs
        ])
    ];
  }
}

function buildContextPack(
  stage: RequirementHarnessStage,
  requirementSetId: string,
  source: {
    id: string;
    title: string;
    content: string;
    blocks: RequirementContentBlock[];
    attachments: Array<{ id?: string; name: string; status?: string }>;
  },
  attachmentAnalyses: Array<{ id: string; kind: string; markdown: string; nodes: unknown[]; edges: unknown[]; sourceRefs: string[] }>,
  outputs: StageOutputs
): BrainContextPack {
  const sourceLines = source.content.split(/\r?\n/).map((line, index) =>
    `source:${source.id}#line:${index + 1} ${line}`
  );
  const structured = JSON.stringify({
    documentMap: outputs["document-mapper"],
    clauseAnalysis: outputs["clause-analyst"],
    businessModels: outputs["business-modeler"]
  }, null, 2);
  const attachmentEvidence = JSON.stringify(attachmentAnalyses.map((analysis) => ({
    ref: `attachment-analysis:${analysis.id}`,
    kind: analysis.kind,
    markdown: analysis.markdown,
    nodes: analysis.nodes,
    edges: analysis.edges,
    sourceRefs: analysis.sourceRefs
  })), null, 2);
  const documentBlocks = JSON.stringify(source.blocks.map((block) => ({
    id: block.id,
    type: block.type,
    text: block.text,
    level: block.level,
    order: block.order,
    sourceRef: block.sourceRef,
    sourceRefs: block.sourceRefs,
    table: block.table,
    image: block.image
  })), null, 2);
  const fixed = [
    `Requirement: ${source.title}`,
    `Stage: ${stage}`,
    "Confirmed attachment evidence:",
    attachmentEvidence,
    "Document block AST:",
    documentBlocks,
    "Structured outputs from completed independent stages:",
    structured
  ].join("\n");
  if (fixed.length + 32 > MAX_CONTEXT_CHARS) {
    throw new Error(
      "Structured requirement context exceeds the Harness budget; key flows and sourceRefs will not be silently truncated"
    );
  }
  const sourceBudget = Math.max(0, MAX_CONTEXT_CHARS - fixed.length - 64);
  const fullSource = sourceLines.join("\n");
  const truncated = fullSource.length > sourceBudget;
  const sourceContent = truncated
    ? `${fullSource.slice(0, sourceBudget)}\n[cold requirement content truncated]`
    : fullSource;
  const content = `${fixed}\nSource content:\n${sourceContent}`;
  const references = unique([
    ...sourceLines.map((_, index) => `source:${source.id}#line:${index + 1}`),
    ...attachmentAnalyses.flatMap((analysis) => [`attachment-analysis:${analysis.id}`, ...analysis.sourceRefs])
  ]).map((ref) => ({ ref, kind: "requirement" as const }));
  return {
    taskId: "pending",
    purpose: "requirement",
    summary: `${stage} for ${source.title}`,
    references,
    content,
    estimatedChars: content.length,
    truncated
  };
}

function stagePrompt(stage: RequirementHarnessStage, context: BrainContextPack) {
  const instructions: Record<RequirementHarnessStage, string> = {
    "document-mapper": "Map goals, scope, modules, actors, business objects, attachments, and risks.",
    "clause-analyst": "Extract atomic explicit or derived clauses with confidence and exact sourceRefs.",
    "business-modeler": "Build object lifecycle, workflow, state-machine, decision-table, and invariant models.",
    "coverage-critic": "Independently audit the structured models for missing flows, branches, exceptions, actors, end states, contradictions, and unsupported inferences. Do not trust designer conclusions."
  };
  return [
    instructions[stage],
    "Return JSON only. Do not include system observations or approve the requirement baseline.",
    `Required output shape:\n${stageOutputTemplate(stage)}`,
    "Context:",
    context.content
  ].join("\n\n");
}

function stageOutputTemplate(stage: RequirementHarnessStage) {
  const templates: Record<RequirementHarnessStage, unknown> = {
    "document-mapper": {
      goals: ["string"],
      scope: ["string"],
      modules: ["string"],
      actors: ["string"],
      businessObjects: ["string"],
      attachmentRefs: ["attachment-analysis:<id>"],
      risks: ["string"],
      sourceRefs: ["source:<id>#line:<n>"]
    },
    "clause-analyst": {
      module: "string",
      clauses: [{
        id: "stable-local-id",
        index: 1,
        text: "atomic requirement statement",
        sourceRefs: ["source:<id>#line:<n>"],
        module: "string",
        kind: "goal|actor|object|action|field|rule|condition|workflow|state|permission|integration|exception|data-constraint",
        origin: "explicit|derived",
        confidence: 1,
        status: "draft|confirmed|conflicted",
        nodeTypes: ["module|actor|object|field|rule|workflow|state|permission|integration|data-constraint|term|requirement"]
      }],
      openQuestions: ["string"]
    },
    "business-modeler": {
      businessObjectModels: [{
        localId: "stable-local-id",
        name: "string",
        actors: ["string"],
        fields: ["string"],
        states: ["string"],
        invariants: ["string"],
        sourceRefs: ["source:<id>#line:<n>"]
      }],
      workflowModels: [{
        localId: "stable-local-id",
        title: "string",
        actors: ["string"],
        steps: [{ id: "step-id", label: "string", actor: "string", sourceRefs: ["source ref"] }],
        transitions: [{ id: "transition-id", from: "step-id", to: "step-id", sourceRefs: ["source ref"] }],
        startStepIds: ["step-id"],
        endStepIds: ["step-id"],
        sourceRefs: ["source ref"],
        confidence: 1
      }],
      stateMachineModels: [{
        localId: "stable-local-id",
        title: "string",
        states: [{ id: "state-id", label: "string", initial: true, terminal: false, sourceRefs: ["source ref"] }],
        transitions: [{ id: "transition-id", from: "state-id", to: "state-id", validity: "legal|forbidden|unknown", sourceRefs: ["source ref"] }],
        sourceRefs: ["source ref"],
        confidence: 1
      }],
      decisionTableModels: [{
        localId: "stable-local-id",
        title: "string",
        conditions: ["string"],
        actions: ["string"],
        rules: [{ conditionValues: { condition: "value" }, expectedActions: ["string"], sourceRefs: ["source ref"] }],
        sourceRefs: ["source ref"]
      }],
      invariants: ["string"]
    },
    "coverage-critic": {
      verdict: "pass|needs-review|retry|blocked",
      score: 1,
      reasons: ["string"],
      missingMainFlows: ["string"],
      missingBranches: ["string"],
      missingExceptions: ["string"],
      missingActors: ["string"],
      missingEndStates: ["string"],
      contradictions: ["string"],
      unsupportedInferences: ["string"],
      requiredActions: ["string"],
      evidenceRefs: ["source ref"]
    }
  };
  return JSON.stringify(templates[stage], null, 2);
}

function validateStageOutput(stage: RequirementHarnessStage, value: unknown, allowedPrefixes: string[]) {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["Output must be a JSON object"] };
  if ("systemObservations" in value || "observedBehavior" in value) {
    errors.push("Requirement analysis must not include observed system behavior");
  }
  if (stage === "document-mapper") {
    requireStringArrays(value, ["goals", "scope", "modules", "actors", "businessObjects", "attachmentRefs", "risks", "sourceRefs"], errors);
    if (!hasStrings(value.modules)) errors.push("modules must contain at least one item");
    if (!hasStrings(value.sourceRefs)) errors.push("sourceRefs must contain at least one item");
  } else if (stage === "clause-analyst") {
    if (!isNonEmptyString(value.module)) errors.push("module is required");
    if (!Array.isArray(value.clauses) || value.clauses.length === 0) errors.push("clauses must contain at least one item");
    for (const [index, clause] of array(value.clauses).entries()) {
      if (!isRecord(clause)) {
        errors.push(`clauses[${index}] must be an object`);
        continue;
      }
      if (!isNonEmptyString(clause.id) || !isNonEmptyString(clause.text) || !isNonEmptyString(clause.module)) {
        errors.push(`clauses[${index}] requires id, text, and module`);
      }
      if (!Number.isInteger(clause.index) || Number(clause.index) < 1) errors.push(`clauses[${index}].index is invalid`);
      if (!hasStrings(clause.sourceRefs)) errors.push(`clauses[${index}].sourceRefs is required`);
      if (!isConfidence(clause.confidence)) errors.push(`clauses[${index}].confidence is invalid`);
      if (!Array.isArray(clause.nodeTypes)) errors.push(`clauses[${index}].nodeTypes must be an array`);
      if (!isOneOf(clause.kind, CLAUSE_KINDS)) errors.push(`clauses[${index}].kind is invalid`);
      if (!isOneOf(clause.origin, ["explicit", "derived"])) errors.push(`clauses[${index}].origin is invalid`);
      if (!isOneOf(clause.status, ["draft", "confirmed", "conflicted"])) errors.push(`clauses[${index}].status is invalid`);
      if (array(clause.nodeTypes).some((type) => !isOneOf(type, KNOWLEDGE_NODE_TYPES))) {
        errors.push(`clauses[${index}].nodeTypes contains an invalid type`);
      }
    }
    if (!Array.isArray(value.openQuestions)) errors.push("openQuestions must be an array");
  } else if (stage === "business-modeler") {
    for (const field of ["businessObjectModels", "workflowModels", "stateMachineModels", "decisionTableModels", "invariants"]) {
      if (!Array.isArray(value[field])) errors.push(`${field} must be an array`);
    }
    for (const [group, items] of Object.entries({
      businessObjectModels: array(value.businessObjectModels),
      workflowModels: array(value.workflowModels),
      stateMachineModels: array(value.stateMachineModels),
      decisionTableModels: array(value.decisionTableModels)
    })) {
      for (const [index, item] of items.entries()) {
        if (!isRecord(item) || !isNonEmptyString(item.localId) || !hasStrings(item.sourceRefs)) {
          errors.push(`${group}[${index}] requires localId and sourceRefs`);
        }
      }
    }
    validateBusinessModels(value, errors);
  } else {
    if (!isOneOf(value.verdict, ["pass", "needs-review", "retry", "blocked"])) errors.push("verdict is invalid");
    if (!isConfidence(value.score)) errors.push("score is invalid");
    requireStringArrays(value, [
      "reasons",
      "missingMainFlows",
      "missingBranches",
      "missingExceptions",
      "missingActors",
      "missingEndStates",
      "contradictions",
      "unsupportedInferences",
      "requiredActions",
      "evidenceRefs"
    ], errors);
    if (value.verdict === "pass" && !hasStrings(value.evidenceRefs)) {
      errors.push("A passing Critic requires evidenceRefs");
    }
  }
  const sourceRefs = collectSourceRefs(value);
  for (const ref of sourceRefs) {
    if (!allowedPrefixes.some((prefix) => ref === prefix || ref.startsWith(prefix))) {
      errors.push(`Unsupported sourceRef: ${ref}`);
    }
  }
  return { ok: errors.length === 0, errors: unique(errors) };
}

function validateBusinessModels(value: Record<string, unknown>, errors: string[]) {
  for (const [index, item] of array(value.businessObjectModels).entries()) {
    if (!isRecord(item)) continue;
    if (!isNonEmptyString(item.name)) errors.push(`businessObjectModels[${index}].name is required`);
    requireStringArrays(item, ["actors", "fields", "states", "invariants", "sourceRefs"], errors);
  }
  for (const [index, item] of array(value.workflowModels).entries()) {
    if (!isRecord(item)) continue;
    if (!isNonEmptyString(item.title)) errors.push(`workflowModels[${index}].title is required`);
    requireStringArrays(item, ["actors", "startStepIds", "endStepIds", "sourceRefs"], errors);
    if (!isConfidence(item.confidence)) errors.push(`workflowModels[${index}].confidence is invalid`);
    validateGraph(item, `workflowModels[${index}]`, "steps", errors);
  }
  for (const [index, item] of array(value.stateMachineModels).entries()) {
    if (!isRecord(item)) continue;
    if (!isNonEmptyString(item.title)) errors.push(`stateMachineModels[${index}].title is required`);
    if (!hasStrings(item.sourceRefs)) errors.push(`stateMachineModels[${index}].sourceRefs is required`);
    if (!isConfidence(item.confidence)) errors.push(`stateMachineModels[${index}].confidence is invalid`);
    validateGraph(item, `stateMachineModels[${index}]`, "states", errors);
    for (const [transitionIndex, transition] of array(item.transitions).entries()) {
      if (isRecord(transition) && transition.validity !== undefined && !isOneOf(transition.validity, ["legal", "forbidden", "unknown"])) {
        errors.push(`stateMachineModels[${index}].transitions[${transitionIndex}].validity is invalid`);
      }
    }
  }
  for (const [index, item] of array(value.decisionTableModels).entries()) {
    if (!isRecord(item)) continue;
    if (!isNonEmptyString(item.title)) errors.push(`decisionTableModels[${index}].title is required`);
    requireStringArrays(item, ["conditions", "actions", "sourceRefs"], errors);
    if (!Array.isArray(item.rules)) errors.push(`decisionTableModels[${index}].rules must be an array`);
    for (const [ruleIndex, rule] of array(item.rules).entries()) {
      if (!isRecord(rule) || !isRecord(rule.conditionValues) || !Array.isArray(rule.expectedActions) || !hasStrings(rule.sourceRefs)) {
        errors.push(`decisionTableModels[${index}].rules[${ruleIndex}] is invalid`);
      }
    }
  }
}

function validateGraph(
  model: Record<string, unknown>,
  path: string,
  nodeField: "steps" | "states",
  errors: string[]
) {
  if (!Array.isArray(model[nodeField]) || !Array.isArray(model.transitions)) {
    errors.push(`${path} requires ${nodeField} and transitions arrays`);
    return;
  }
  const nodeIds = new Set<string>();
  for (const [index, node] of array(model[nodeField]).entries()) {
    if (!isRecord(node) || !isNonEmptyString(node.id) || !isNonEmptyString(node.label) || !hasStrings(node.sourceRefs)) {
      errors.push(`${path}.${nodeField}[${index}] is invalid`);
      continue;
    }
    nodeIds.add(node.id);
    if (nodeField === "states" && (typeof node.initial !== "boolean" || typeof node.terminal !== "boolean")) {
      errors.push(`${path}.${nodeField}[${index}] requires initial and terminal flags`);
    }
  }
  for (const [index, transition] of array(model.transitions).entries()) {
    if (
      !isRecord(transition) ||
      !isNonEmptyString(transition.id) ||
      !isNonEmptyString(transition.from) ||
      !isNonEmptyString(transition.to) ||
      !hasStrings(transition.sourceRefs)
    ) {
      errors.push(`${path}.transitions[${index}] is invalid`);
      continue;
    }
    if (!nodeIds.has(transition.from) || !nodeIds.has(transition.to)) {
      errors.push(`${path}.transitions[${index}] references an unknown node`);
    }
  }
}

function normalizeHostModels(
  knowledgeProjectId: string,
  requirementSetId: string,
  output: BusinessModelerOutput
): RequirementModelBundle {
  const now = new Date().toISOString();
  return {
    businessObjectModels: output.businessObjectModels.map((model) => ({
      id: stableModelId("businessObject", requirementSetId, model.localId),
      requirementSetId,
      semanticConceptId: model.localId,
      name: model.name,
      actors: model.actors,
      fields: model.fields,
      states: model.states,
      invariants: unique([...model.invariants, ...output.invariants]),
      sourceRefs: model.sourceRefs,
      status: "draft"
    })),
    workflowModels: output.workflowModels.map(({ localId: _localId, ...model }) => ({
      ...model,
      id: stableModelId("workflow", requirementSetId, _localId),
      knowledgeProjectId,
      requirementSetId,
      status: "draft",
      createdAt: now,
      updatedAt: now
    })),
    stateMachineModels: output.stateMachineModels.map(({ localId: _localId, ...model }) => ({
      ...model,
      id: stableModelId("stateMachine", requirementSetId, _localId),
      knowledgeProjectId,
      requirementSetId,
      status: "draft",
      createdAt: now,
      updatedAt: now
    })),
    decisionTableModels: output.decisionTableModels.map(({ localId: _localId, ...model }) => ({
      ...model,
      id: stableModelId("decisionTable", requirementSetId, _localId),
      requirementSetId,
      status: "draft"
    }))
  };
}

function nodesForClause(
  requirementSetId: string,
  clause: RequirementClause,
  policyId: string,
  policyVersion: string
): RequirementAnalysis["nodes"] {
  const metadata = {
    requirementSetId,
    module: clause.module,
    status: "draft" as const,
    policyId,
    policyVersion
  };
  return [
    {
      ...metadata,
      type: "requirement",
      title: `Requirement ${clause.index}`,
      content: clause.text,
      sourceRefs: clause.sourceRefs,
      origin: "source" as const,
      confidence: clause.confidence
    },
    ...clause.nodeTypes.map((type) => ({
      ...metadata,
      type,
      title: `${clause.module} ${type}: ${clause.text.slice(0, 80)}`,
      content: clause.text,
      sourceRefs: clause.sourceRefs,
      origin: "derived" as const,
      confidence: clause.confidence
    }))
  ];
}

function stagePassEvaluation(stage: RequirementHarnessStage, output: unknown): BrainEvalResult {
  return {
    verdict: "pass",
    score: 1,
    reasons: [],
    affectedAssetIds: [],
    evidenceRefs: collectSourceRefs(output),
    nextActions: stage === "coverage-critic" ? [] : [`Continue to ${STAGES[STAGES.indexOf(stage) + 1]}`]
  };
}

function stageFromTask(task: BrainTask): RequirementHarnessStage {
  const stage = task.operation.replace("requirement-analysis:", "") as RequirementHarnessStage;
  if (!STAGES.includes(stage)) throw new Error(`Unknown Requirement Host Harness stage: ${stage}`);
  return stage;
}

function collectSourceRefs(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.flatMap(collectSourceRefs));
  if (!isRecord(value)) return [];
  return unique(Object.entries(value).flatMap(([key, nested]) =>
    key === "sourceRefs" || key === "evidenceRefs"
      ? array(nested).filter(isNonEmptyString)
      : collectSourceRefs(nested)
  ));
}

function requireStringArrays(value: Record<string, unknown>, fields: string[], errors: string[]) {
  for (const field of fields) {
    if (!Array.isArray(value[field]) || !array(value[field]).every((item) => typeof item === "string")) {
      errors.push(`${field} must be a string array`);
    }
  }
}

function isCriticalProcessAttachment(name: string) {
  return /flow|workflow|state|process|approval|\u6d41\u7a0b|\u72b6\u6001|\u5ba1\u6279/i.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function hasStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableModelId(prefix: string, requirementSetId: string, localId: string) {
  const hash = createHash("sha256")
    .update(`${requirementSetId}:${prefix}:${localId}`)
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${hash}`;
}
