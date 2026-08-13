import { access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  ExecutableCaseStep,
  CompileRun,
  ExecutionEvidence,
  Gap,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProject,
  PageBindingDecision,
  RequirementEvalAction,
  RequirementEvalActionKind,
  RequirementEvaluationGate,
  RequirementContentPackage,
  RequirementSet,
  RequirementSource,
  TestIntent,
  CoverageDimension,
  AssertionContractType
} from "../domain/types.js";
import { id } from "../shared/id.js";
import {
  analyzeRequirement,
  designTests,
  evaluatePolicyOutput,
  type RequirementAnalysis
} from "./policies.js";
import {
  bindStepsToSystemBrain,
  buildSystemBrain,
  systemObservationDrafts,
  type SystemBrain,
  type SystemObservationDraft
} from "./systemBrain.js";
import { planStateActions } from "./stateActionPlanner.js";
import {
  applyTestDataResolutions,
  confirmTestDataPlan,
  planTestData,
  type TestDataResolution
} from "./testDataPlanner.js";
import { planWorkflowPath } from "./workflowPathPlanner.js";
import { buildAssertionContracts, determineAssuranceLevel } from "../execution/assurance.js";
import { writeStaticExecutionReport } from "../execution/staticReport.js";
import { decryptSecrets } from "../shared/crypto.js";

export class KnowledgeService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly knowledgeDir: string
  ) {}

  async createProject(input: { name: string; key: string; defaultLocale: string }) {
    const key = normalizeKey(input.key);
    if (this.repository.knowledgeProjects.some((project) => project.key === key)) {
      throw new Error("Knowledge project key already exists");
    }
    const now = timestamp();
    const project: KnowledgeProject = {
      id: id("knowledgeProject"),
      key,
      name: input.name.trim(),
      defaultLocale: input.defaultLocale.trim() || "zh-CN",
      status: "active",
      systemIds: [],
      createdAt: now,
      updatedAt: now
    };
    this.repository.knowledgeProjects.push(project);
    this.repository.persist();
    await this.writeProjectIndex(project);
    return project;
  }

  listProjects() {
    return [...this.repository.knowledgeProjects];
  }

  bindSystem(projectId: string, systemId: string) {
    const project = this.getProject(projectId);
    if (!this.repository.systemProfiles.some((system) => system.id === systemId)) {
      throw new Error("Business system not found");
    }
    if (!project.systemIds.includes(systemId)) project.systemIds.push(systemId);
    project.updatedAt = timestamp();
    this.repository.persist();
    return project;
  }

  async ingestRequirement(input: {
    projectId: string;
    contentPackage: RequirementContentPackage;
  }) {
    const project = this.getProject(input.projectId);
    const existingSource = this.repository.requirementSources.find(
      (source) => source.knowledgeProjectId === project.id && source.source === input.contentPackage.source
    );
    const existingSet = existingSource?.latestRequirementSetId
      ? this.repository.requirementSets.find((item) => item.id === existingSource.latestRequirementSetId)
      : undefined;
    if (existingSource && existingSet && existingSource.contentHash === input.contentPackage.contentHash) {
      return { source: existingSource, requirementSet: existingSet, changed: false };
    }

    const now = timestamp();
    const source: RequirementSource = existingSource ?? {
      id: id("requirementSource"),
      knowledgeProjectId: project.id,
      source: input.contentPackage.source,
      sourceType: input.contentPackage.sourceType,
      title: input.contentPackage.title,
      contentHash: input.contentPackage.contentHash,
      content: input.contentPackage.content,
      blocks: input.contentPackage.blocks,
      attachments: input.contentPackage.attachments,
      warnings: input.contentPackage.warnings,
      accessStatus: "available",
      revision: 0,
      createdAt: now,
      updatedAt: now
    };
    if (!existingSource) this.repository.requirementSources.push(source);
    if (existingSet) {
      existingSet.status = "superseded";
      existingSet.updatedAt = now;
    }
    Object.assign(source, {
      title: input.contentPackage.title,
      sourceType: input.contentPackage.sourceType,
      contentHash: input.contentPackage.contentHash,
      content: input.contentPackage.content,
      blocks: input.contentPackage.blocks,
      attachments: input.contentPackage.attachments,
      warnings: input.contentPackage.warnings,
      revision: source.revision + 1,
      updatedAt: now
    });

    const requirementSet: RequirementSet = {
      id: id("requirementSet"),
      knowledgeProjectId: project.id,
      sourceId: source.id,
      version: source.revision,
      title: source.title,
      summary: summarize(source.content),
      contentHash: source.contentHash,
      status: "draft",
      affectedNodeIds: [],
      previousRequirementSetId: existingSet?.id,
      createdAt: now,
      updatedAt: now
    };
    source.latestRequirementSetId = requirementSet.id;
    this.repository.requirementSets.push(requirementSet);
    const gaps = input.contentPackage.warnings.map((warning) =>
      this.createGap(
        project.id,
        requirementSet.id,
        `Requirement source warning: ${warning}`,
        "requirement-source-warning"
      )
    );
    this.repository.persist();
    await this.writeRequirement(project, source, requirementSet);
    await this.writeProjectIndex(project);
    return {
      source,
      requirementSet,
      gaps,
      changed: true,
      previousRequirementSetId: existingSet?.id
    };
  }

  listRequirementSets(projectId: string) {
    return this.repository.requirementSets.filter((item) => item.knowledgeProjectId === projectId);
  }

  async generateTestDesign(
    requirementSetId: string,
    provider: "builtin" | "host-skill" = "builtin",
    analysisOverride?: RequirementAnalysis
  ) {
    const requirementSet = this.getRequirementSet(requirementSetId);
    const source = this.getRequirementSource(requirementSet.sourceId);
    const analysis =
      analysisOverride ??
      analyzeRequirement({
        requirementSetId,
        title: requirementSet.title,
        content: source.content,
        sourceRef: source.id,
        provider
      });
    const evaluation = evaluatePolicyOutput(analysis);
    const existingIntents = this.repository.testIntents.filter(
      (item) => item.requirementSetId === requirementSetId
    );
    if (existingIntents.length > 0) {
      const requirementGaps = this.repository.gaps.filter(
        (gap) =>
          gap.projectId === requirementSet.knowledgeProjectId &&
          gap.sourceId === requirementSetId
      );
      requirementSet.evaluationGate ??= buildRequirementEvaluationGate(
        analysis,
        evaluation,
        requirementGaps
      );
      this.repository.persist();
      const coveredClauseSourceRefs = [
        ...new Set(existingIntents.flatMap((item) => item.requirementRefs))
      ];
      return {
        reused: true,
        analysis,
        evaluation,
        evaluationGate: requirementSet.evaluationGate,
        gaps: requirementGaps.filter((gap) => gap.status === "open"),
        impact: this.requirementImpact(requirementSetId),
        edges: this.repository.knowledgeEdges.filter(
          (edge) => edge.knowledgeProjectId === requirementSet.knowledgeProjectId
        ),
        nodes: this.repository.knowledgeNodes.filter(
          (item) => item.requirementSetId === requirementSetId
        ),
        techniques: [...new Set(existingIntents.flatMap((item) => item.techniques))],
        testIntents: existingIntents,
        dataProfiles: this.repository.testDataProfiles.filter(
          (item) => item.requirementSetId === requirementSetId
        ),
        coverage: {
          totalClauses: analysis.clauses.length,
          coveredClauseSourceRefs,
          uncoveredClauseSourceRefs: analysis.clauses
            .map((clause) => clause.sourceRef)
            .filter((sourceRef) => !coveredClauseSourceRefs.includes(sourceRef)),
          intentCount: existingIntents.length
        }
      };
    }
    const now = timestamp();
    const previousNodes = requirementSet.previousRequirementSetId
      ? this.repository.knowledgeNodes.filter(
          (node) => node.requirementSetId === requirementSet.previousRequirementSetId
        )
      : [];
    const proposedKeys = new Set(analysis.nodes.map(knowledgeNodeKey));
    const affectedNodeIds = new Set(requirementSet.affectedNodeIds);
    const nodes: KnowledgeNode[] = [];
    const resolvedNodes: KnowledgeNode[] = [];
    for (const proposed of analysis.nodes) {
      const previous = previousNodes.find((node) => knowledgeNodeKey(node) === knowledgeNodeKey(proposed));
      if (previous && normalizeText(previous.content) === normalizeText(proposed.content)) {
        resolvedNodes.push(previous);
        continue;
      }
      const node: KnowledgeNode = {
        ...proposed,
        id: id("knowledgeNode"),
        knowledgeProjectId: requirementSet.knowledgeProjectId,
        createdAt: now,
        updatedAt: now
      };
      nodes.push(node);
      resolvedNodes.push(node);
      affectedNodeIds.add(node.id);
      if (previous) affectedNodeIds.add(previous.id);
    }
    for (const previous of previousNodes) {
      if (!proposedKeys.has(knowledgeNodeKey(previous))) affectedNodeIds.add(previous.id);
    }
    this.repository.knowledgeNodes.push(...nodes);
    const edges = this.createKnowledgeEdges(requirementSet.knowledgeProjectId, resolvedNodes);
    requirementSet.affectedNodeIds = [...affectedNodeIds];
    const design = designTests({ knowledgeProjectId: requirementSet.knowledgeProjectId, analysis });
    this.repository.testIntents.push(...design.testIntents);
    this.repository.testDataProfiles.push(...design.dataProfiles);
    const gaps = [
      ...analysis.openQuestions.map((question) =>
        this.createGap(
          requirementSet.knowledgeProjectId,
          requirementSet.id,
          `Requirement clarification needed: ${question}`,
          "requirement-clarification"
        )
      ),
      ...analysis.contradictions.map((contradiction) =>
        this.createGap(
          requirementSet.knowledgeProjectId,
          requirementSet.id,
          `Requirement conflict must be resolved: ${contradiction}`,
          "requirement-conflict"
        )
      )
    ];
    requirementSet.evaluationGate = buildRequirementEvaluationGate(analysis, evaluation, gaps);
    this.repository.persist();
    await this.writeAnalysis(
      requirementSet,
      analysis,
      design.testIntents,
      evaluation,
      design.coverage,
      requirementSet.evaluationGate
    );
    await this.writeModuleKnowledge(requirementSet, analysis, design.testIntents);
    return {
      analysis,
      evaluation,
      evaluationGate: requirementSet.evaluationGate,
      nodes,
      edges,
      gaps,
      impact: this.requirementImpact(requirementSet.id),
      ...design
    };
  }

  async confirmEvaluationActions(input: {
    requirementSetId: string;
    actionIds: string[];
    note: string;
    confirm: boolean;
  }) {
    if (!input.confirm) {
      throw new Error("Explicit confirmation is required for Requirement Eval actions");
    }
    const note = input.note.trim();
    if (!note) {
      throw new Error("A confirmation note is required for Requirement Eval actions");
    }
    const requirementSet = this.getRequirementSet(input.requirementSetId);
    const evaluationGate = requirementSet.evaluationGate;
    if (!evaluationGate) {
      throw new Error("Generate the Requirement Eval before confirming actions");
    }
    const pendingActions = evaluationGate.actions.filter((action) => action.status === "pending");
    const selectedIds = input.actionIds.length > 0
      ? new Set(input.actionIds)
      : new Set(pendingActions.map((action) => action.id));
    const unknownIds = [...selectedIds].filter(
      (actionId) => !evaluationGate.actions.some((action) => action.id === actionId)
    );
    if (unknownIds.length > 0) {
      throw new Error(`Requirement Eval actions not found: ${unknownIds.join(", ")}`);
    }
    const selectedActions = evaluationGate.actions.filter((action) => selectedIds.has(action.id));
    if (selectedActions.length === 0) {
      throw new Error("No pending Requirement Eval actions were selected");
    }
    if (selectedActions.some((action) => action.status === "blocked")) {
      throw new Error("Blocked Requirement Eval actions cannot be confirmed");
    }

    const confirmedAt = timestamp();
    const resolvedGapIds: string[] = [];
    const module =
      this.repository.knowledgeNodes.find(
        (node) => node.requirementSetId === requirementSet.id && node.type === "module"
      )?.module ?? "General";
    for (const action of selectedActions) {
      if (action.status === "confirmed") continue;
      action.status = "confirmed";
      action.confirmedAt = confirmedAt;
      action.confirmationNote = note;
      const resolutionSourceRef = `${requirementSet.id}#eval-action-${action.id}`;
      const resolutionNode: KnowledgeNode = {
        id: id("knowledgeNode"),
        knowledgeProjectId: requirementSet.knowledgeProjectId,
        requirementSetId: requirementSet.id,
        type: action.kind === "uncovered-coverage" ? "requirement" : "rule",
        title: `Confirmed Eval resolution: ${action.id}`,
        content: note,
        module,
        sourceRefs: [...new Set([...action.sourceRefs, resolutionSourceRef])],
        origin: "source",
        confidence: 1,
        status: "draft",
        createdAt: confirmedAt,
        updatedAt: confirmedAt
      };
      action.resolutionNodeId = resolutionNode.id;
      this.repository.knowledgeNodes.push(resolutionNode);
      for (const intent of this.repository.testIntents.filter(
        (item) =>
          item.requirementSetId === requirementSet.id &&
          item.requirementRefs.some((sourceRef) => action.sourceRefs.includes(sourceRef))
      )) {
        intent.expectedResults = [
          ...new Set([...intent.expectedResults, `Confirmed Eval resolution: ${note}`])
        ];
        intent.knowledgeNodeRefs = [
          ...new Set([...intent.knowledgeNodeRefs, `${resolutionNode.type}:${resolutionNode.title}`])
        ];
        intent.updatedAt = confirmedAt;
      }
      for (const gapId of action.gapIds) {
        const gap = this.repository.gaps.find((item) => item.id === gapId);
        if (gap?.status === "open") {
          gap.status = "resolved";
          gap.updatedAt = confirmedAt;
          resolvedGapIds.push(gap.id);
        }
      }
    }
    evaluationGate.status = evaluationGate.actions.some((action) => action.status === "blocked")
      ? "blocked"
      : evaluationGate.actions.some((action) => action.status === "pending")
        ? "needs-confirmation"
        : "confirmed";
    if (evaluationGate.status === "confirmed") evaluationGate.confirmedAt = confirmedAt;
    requirementSet.updatedAt = confirmedAt;
    this.repository.persist();
    await this.writeEvaluationConfirmations(requirementSet);
    return { requirementSet, evaluationGate, resolvedGapIds };
  }

  approveRequirementSet(requirementSetId: string) {
    const requirementSet = this.getRequirementSet(requirementSetId);
    if (!requirementSet.evaluationGate) {
      throw new Error("Requirement Eval must be generated before approval");
    }
    if (
      requirementSet.evaluationGate.status === "blocked" ||
      requirementSet.evaluationGate.actions.some((action) => action.status === "blocked")
    ) {
      throw new Error("Blocked Requirement Eval output cannot be approved");
    }
    if (requirementSet.evaluationGate.actions.some((action) => action.status === "pending")) {
      throw new Error("Requirement Eval actions must be confirmed before approval");
    }
    const unresolvedClarifications = this.repository.gaps.filter(
      (gap) =>
        gap.projectId === requirementSet.knowledgeProjectId &&
        gap.sourceId === requirementSet.id &&
        gap.sourceType === "requirement-clarification" &&
        gap.status === "open"
    );
    if (unresolvedClarifications.length > 0) {
      throw new Error("Requirement clarification gaps must be resolved before approval");
    }
    const unresolvedConflicts = this.repository.gaps.filter(
      (gap) =>
        gap.projectId === requirementSet.knowledgeProjectId &&
        gap.sourceId === requirementSet.id &&
        gap.sourceType === "requirement-conflict" &&
        gap.status === "open"
    );
    if (unresolvedConflicts.length > 0) {
      throw new Error("Requirement conflict gaps must be resolved before approval");
    }
    requirementSet.status = "approved";
    requirementSet.approvedAt = timestamp();
    requirementSet.updatedAt = requirementSet.approvedAt;
    for (const node of this.repository.knowledgeNodes.filter(
      (item) => item.requirementSetId === requirementSet.id
    )) {
      node.status = "confirmed";
      node.updatedAt = requirementSet.updatedAt;
    }
    if (requirementSet.previousRequirementSetId) {
      for (const node of this.repository.knowledgeNodes.filter(
        (item) =>
          item.requirementSetId === requirementSet.previousRequirementSetId &&
          requirementSet.affectedNodeIds.includes(item.id)
      )) {
        node.status = "deprecated";
        node.updatedAt = requirementSet.updatedAt;
      }
    }
    for (const intent of this.repository.testIntents.filter(
      (item) => item.requirementSetId === requirementSet.id
    )) {
      intent.status = "approved";
      intent.updatedAt = requirementSet.updatedAt;
    }
    this.repository.persist();
    return requirementSet;
  }

  compileExecutableCases(testIntentId: string, systemId?: string) {
    const intent = this.getTestIntent(testIntentId);
    const requirementSet = this.getRequirementSet(intent.requirementSetId);
    if (requirementSet.status !== "approved") {
      throw new Error("Requirement baseline must be approved before compiling executable cases");
    }
    const source = this.getRequirementSource(requirementSet.sourceId);
    const compileKey = executableCaseCompileKey(
      this.repository,
      intent,
      requirementSet,
      systemId
    );
    const existing = this.repository.executableCases.find(
      (item) =>
        item.testIntentId === intent.id &&
        item.systemId === systemId &&
        item.compileKey === compileKey &&
        item.status !== "superseded"
    );
    if (existing) {
      return {
        executableCase: existing,
        gaps: this.repository.gaps.filter((gap) => existing.gapIds.includes(gap.id)),
        reused: true
      };
    }
    const confirmedEvalActions =
      requirementSet.evaluationGate?.actions.filter(
        (action) => action.status === "confirmed" && action.confirmationNote
      ) ?? [];
    const executionContent = [
      source.content,
      ...confirmedEvalActions.map((action) => action.confirmationNote as string)
    ].join("\n");
    const sourceRefs = [
      source.id,
      requirementSet.id,
      ...confirmedEvalActions.map((action) => `${requirementSet.id}#eval-action-${action.id}`)
    ];
    const multiplePaths =
      /\u5217\u8868[^\n]{0,20}\u65b0\u5efa/.test(source.content) &&
      /\u8be6\u60c5[^\n]{0,20}\u65b0\u5efa/.test(source.content);
    const gaps: Gap[] = multiplePaths
      ? [this.createGap(requirementSet.knowledgeProjectId, requirementSet.id, "multiple workflow paths require user selection")]
      : [];
    let steps = gaps.length > 0 ? [] : compileSteps(executionContent, sourceRefs);
    let pathPlan: ExecutableCase["pathPlan"];
    let statePlan: ExecutableCase["statePlan"];
    if (systemId) {
      const project = this.getProject(requirementSet.knowledgeProjectId);
      if (!project.systemIds.includes(systemId)) {
        throw new Error("Business system must be bound before compiling executable cases");
      }
      if (gaps.length === 0) {
        const brain = buildSystemBrain(this.repository, project.id, systemId);
        const contextQuery = `${intent.module} ${intent.title} ${intent.objective}`;
        const confirmedBinding = [...this.repository.pageBindingDecisions]
          .reverse()
          .find(
            (decision) =>
              decision.testIntentId === intent.id && decision.systemId === systemId
          );
        const planned = planWorkflowPath(
          steps,
          brain,
          contextQuery,
          confirmedBinding?.pageModelId
        );
        pathPlan = {
          verdict: planned.verdict,
          reason: planned.reason,
          startPageModelId: planned.startPageModelId,
          targetPageModelId: planned.targetPageModelId,
          pageModelIds: planned.pageModelIds,
          navigationSourceRefs: planned.navigationSourceRefs,
          candidatePathCount: planned.candidatePathCount,
          candidatePaths: planned.candidatePaths
        };
        if (planned.verdict === "ambiguous" || planned.verdict === "missing") {
          gaps.push(
            this.createGap(
              project.id,
              requirementSet.id,
              planned.reason ?? "System Brain could not plan a unique workflow path",
              "system-brain"
            )
          );
        } else {
          const statePlanned = planStateActions(
            planned.steps,
            brain,
            contextQuery,
            planned.targetPageModelId
          );
          statePlan = {
            verdict: statePlanned.verdict,
            reason: statePlanned.reason,
            pageModelId: statePlanned.pageModelId,
            candidateCount: statePlanned.candidateCount,
            candidates: statePlanned.candidates,
            transitionSourceRefs: statePlanned.transitionSourceRefs
          };
          if (
            statePlanned.verdict === "ambiguous" ||
            statePlanned.verdict === "missing"
          ) {
            steps = statePlanned.steps;
            gaps.push(
              this.createGap(
                project.id,
                requirementSet.id,
                statePlanned.reason ??
                  "System Brain could not plan a unique state action",
                "system-brain"
              )
            );
          } else {
            const bound = bindStepsToSystemBrain(
              statePlanned.steps,
              brain,
              contextQuery
            );
            steps = bound.steps;
            const reasons = [
              ...new Set(bound.missingEvidence.map((item) => item.reason))
            ];
            gaps.push(
              ...reasons.map((reason) =>
                this.createGap(
                  project.id,
                  requirementSet.id,
                  reason,
                  "system-brain"
                )
              )
            );
          }
        }
      }
    }
    const dataProfiles = this.repository.testDataProfiles.filter(
      (profile) =>
        profile.requirementSetId === requirementSet.id &&
        profile.sourceRefs.some((sourceRef) =>
          intent.requirementRefs.includes(sourceRef)
        )
    );
    const dataPlanned = planTestData(dataProfiles, steps);
    steps = dataPlanned.steps;
    if (dataPlanned.plan.verdict === "blocked") {
      gaps.push(
        ...dataPlanned.plan.reasons.map((reason) =>
          this.createGap(
            requirementSet.knowledgeProjectId,
            requirementSet.id,
            reason,
            "test-data-plan"
          )
        )
      );
    }
    const now = timestamp();
    const executableCase: ExecutableCase = {
      id: id("executableCase"),
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId: requirementSet.id,
      testIntentId: intent.id,
      systemId,
      title: intent.title,
      status: gaps.length > 0 ? "blocked" : "ready",
      compileKey,
      preconditions: intent.preconditions,
      steps,
      pathPlan,
      statePlan,
      dataPlan: dataPlanned.plan,
      coverageDimensions: intent.coverageDimensions,
      dataProfileIds: dataProfiles.map((profile) => profile.id),
      gapIds: gaps.map((gap) => gap.id),
      createdAt: now,
      updatedAt: now
    };
    const superseded = this.repository.executableCases.filter(
      (item) =>
        item.testIntentId === intent.id &&
        item.systemId === systemId &&
        item.status !== "superseded"
    );
    for (const previous of superseded) {
      previous.status = "superseded";
      previous.supersededById = executableCase.id;
      previous.updatedAt = now;
    }
    this.repository.executableCases.push(executableCase);
    intent.status = gaps.length > 0 ? "blocked" : "compiled";
    intent.updatedAt = now;
    this.repository.persist();
    return { executableCase, gaps, reused: false };
  }

  compileExecutableCasesBatch(input: {
    requirementSetId?: string;
    testIntentIds?: string[];
    modules?: string[];
    systemId?: string;
  }) {
    const requestedIds = [...new Set(input.testIntentIds ?? [])];
    if (!input.requirementSetId && requestedIds.length === 0) {
      throw new Error("requirementSetId or testIntentIds is required");
    }
    const requirementSet = input.requirementSetId
      ? this.getRequirementSet(input.requirementSetId)
      : this.getRequirementSet(this.getTestIntent(requestedIds[0]).requirementSetId);
    const requestedIntents = requestedIds.map((testIntentId) => this.getTestIntent(testIntentId));
    const mismatchedIntent = requestedIntents.find(
      (intent) => intent.requirementSetId !== requirementSet.id
    );
    if (mismatchedIntent) {
      throw new Error(
        `TestIntent ${mismatchedIntent.id} does not belong to RequirementSet ${requirementSet.id}`
      );
    }
    const moduleFilter = new Set((input.modules ?? []).map((module) => normalizeText(module)));
    const intents = this.repository.testIntents.filter(
      (intent) =>
        intent.requirementSetId === requirementSet.id &&
        (requestedIds.length === 0 || requestedIds.includes(intent.id)) &&
        (moduleFilter.size === 0 || moduleFilter.has(normalizeText(intent.module)))
    );
    if (intents.length === 0) {
      throw new Error("No TestIntent matched the batch compile selection");
    }

    const items: CompileRun["items"] = intents.map((intent) => {
      try {
        const compiled = this.compileExecutableCases(intent.id, input.systemId);
        const result = compiled.reused
          ? "reused"
          : compiled.executableCase.pathPlan?.verdict === "ambiguous"
            ? "ambiguous"
            : compiled.executableCase.status === "ready"
              ? "ready"
              : "blocked";
        return {
          testIntentId: intent.id,
          result,
          executableCaseId: compiled.executableCase.id,
          gapIds: compiled.executableCase.gapIds
        };
      } catch (error) {
        return {
          testIntentId: intent.id,
          result: "skipped",
          gapIds: [],
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    });
    const count = (result: CompileRun["items"][number]["result"]) =>
      items.filter((item) => item.result === result).length;
    const now = timestamp();
    const compileRun: CompileRun = {
      id: id("compileRun"),
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId: requirementSet.id,
      systemId: input.systemId,
      status:
        count("skipped") === items.length
          ? "failed"
          : count("blocked") + count("ambiguous") + count("skipped") > 0
            ? "completed-with-blockers"
            : "completed",
      total: items.length,
      ready: count("ready"),
      blocked: count("blocked"),
      ambiguous: count("ambiguous"),
      skipped: count("skipped"),
      reused: count("reused"),
      items,
      createdAt: now
    };
    this.repository.compileRuns.push(compileRun);
    this.repository.persist();
    return { compileRun };
  }

  confirmPageBinding(input: {
    testIntentId: string;
    systemId: string;
    pageModelId: string;
    role?: string;
    note: string;
  }): PageBindingDecision {
    const intent = this.getTestIntent(input.testIntentId);
    const project = this.getProject(intent.knowledgeProjectId);
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Business system must be bound before confirming a page binding");
    }
    const page = this.repository.pageModels.find(
      (item) => item.id === input.pageModelId && item.projectId === input.systemId
    );
    if (!page) {
      throw new Error("Page model does not belong to the selected business system");
    }
    const note = input.note.trim();
    if (!note) throw new Error("Page binding confirmation note is required");
    const existing = this.repository.pageBindingDecisions.find(
      (item) =>
        item.testIntentId === intent.id &&
        item.systemId === input.systemId &&
        item.pageModelId === page.id &&
        item.role === (input.role?.trim() || undefined) &&
        item.note === note
    );
    if (existing) return existing;
    const decision: PageBindingDecision = {
      id: id("pageBinding"),
      knowledgeProjectId: project.id,
      requirementSetId: intent.requirementSetId,
      testIntentId: intent.id,
      systemId: input.systemId,
      pageModelId: page.id,
      role: input.role?.trim() || undefined,
      note,
      confirmedAt: timestamp()
    };
    this.repository.pageBindingDecisions.push(decision);
    this.repository.persist();
    return decision;
  }

  getCompileRun(idValue: string) {
    const run = this.repository.compileRuns.find((item) => item.id === idValue);
    if (!run) throw new Error("Compile run not found");
    return run;
  }

  resolveExecutableCaseTestData(input: {
    executableCaseId: string;
    resolutions: TestDataResolution[];
  }) {
    const executableCase = this.repository.executableCases.find(
      (item) => item.id === input.executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (!executableCase.dataPlan) {
      throw new Error("Executable case has no test data plan");
    }
    const resolved = applyTestDataResolutions(
      executableCase.dataPlan,
      executableCase.steps,
      input.resolutions
    );
    executableCase.dataPlan = resolved.plan;
    executableCase.steps = resolved.steps;
    const resolvedGaps = this.repository.gaps.filter(
      (gap) =>
        executableCase.gapIds.includes(gap.id) &&
        gap.sourceType === "test-data-plan" &&
        gap.status === "open"
    );
    if (resolved.plan.verdict === "ready") {
      const now = timestamp();
      for (const gap of resolvedGaps) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
      const hasOpenGap = executableCase.gapIds.some((gapId) =>
        this.repository.gaps.some(
          (gap) => gap.id === gapId && gap.status === "open"
        )
      );
      executableCase.status = hasOpenGap ? "blocked" : "ready";
      executableCase.updatedAt = now;
      const intent = this.getTestIntent(executableCase.testIntentId);
      intent.status = hasOpenGap ? "blocked" : "compiled";
      intent.updatedAt = now;
    }
    this.repository.persist();
    return { executableCase, resolvedGaps };
  }

  confirmExecutableCaseTestData(executableCaseId: string) {
    const executableCase = this.repository.executableCases.find(
      (item) => item.id === executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (!executableCase.dataPlan) {
      throw new Error("Executable case has no test data plan");
    }
    executableCase.dataPlan = confirmTestDataPlan(
      executableCase.dataPlan,
      timestamp()
    );
    executableCase.updatedAt = timestamp();
    this.repository.persist();
    return executableCase;
  }

  listTestIntents(projectId: string) {
    return this.repository.testIntents.filter((item) => item.knowledgeProjectId === projectId);
  }

  testIntentCoverage(projectId: string) {
    this.getProject(projectId);
    const intents = this.listTestIntents(projectId);
    const executableCases = this.repository.executableCases.filter(
      (item) => item.knowledgeProjectId === projectId
    );
    const evidence = this.repository.executionEvidence.filter(
      (item) => item.knowledgeProjectId === projectId
    );
    const items = intents.map((intent) => {
      const requirementSet = this.repository.requirementSets.find(
        (item) => item.id === intent.requirementSetId
      );
      const cases = executableCases.filter(
        (item) => item.testIntentId === intent.id && item.status !== "superseded"
      );
      const caseIds = cases.map((item) => item.id);
      const results = evidence.filter((item) => caseIds.includes(item.executableCaseId));
      const classification = requirementSet?.status === "superseded"
        ? "superseded"
        : cases.length === 0
          ? "not-selected"
          : results.some((item) => item.assuranceLevel === "strong" && (item.coverage?.missing.length ?? 0) === 0)
            ? "strong-verified"
            : results.some((item) => item.assuranceLevel === "limited")
              ? "limited"
              : results.some((item) => item.status === "failed")
                ? "failed"
                : results.some((item) => item.status === "blocked") || cases.some((item) => item.status === "blocked")
                  ? "blocked"
                  : "not-selected";
      const classificationReason = coverageClassificationReason({
        classification,
        requirementSetStatus: requirementSet?.status,
        cases,
        results
      });
      return {
        testIntentId: intent.id,
        requirementSetId: intent.requirementSetId,
        title: intent.title,
        module: intent.module,
        priority: intent.priority,
        classification,
        classificationReason,
        executableCaseIds: caseIds,
        evidenceIds: results.map((item) => item.id),
        requirementRefs: intent.requirementRefs,
        coverage: {
          required: intent.coverageDimensions ?? [],
          verified: [...new Set(results.flatMap((item) => item.coverage?.verified ?? []))],
          missing: [...new Set(results.flatMap((item) => item.coverage?.missing ?? intent.coverageDimensions ?? []))]
        },
        stability: {
          runs: results.length,
          passed: results.filter((item) => item.status === "passed" && item.assuranceLevel === "strong" && (item.coverage?.missing.length ?? 0) === 0).length,
          failed: results.filter((item) => item.status === "failed").length,
          blocked: results.filter((item) => item.status === "blocked").length,
          rate: results.length > 0
            ? results.filter((item) => item.status === "passed" && item.assuranceLevel === "strong" && (item.coverage?.missing.length ?? 0) === 0).length / results.length
            : undefined,
          repeated: results.length >= 2
        }
      } as const;
    });
    const counts = items.reduce<Record<string, number>>((result, item) => {
      result[item.classification] = (result[item.classification] ?? 0) + 1;
      return result;
    }, {});
    return {
      total: items.length,
      counts,
      items
    };
  }

  requirementSourceLedger(projectId: string) {
    this.getProject(projectId);
    const sources = this.repository.requirementSources.filter(
      (source) => source.knowledgeProjectId === projectId
    );
    return sources.map((source) => {
      const sets = this.repository.requirementSets.filter((item) => item.sourceId === source.id);
      const setIds = new Set(sets.map((item) => item.id));
      const nodes = this.repository.knowledgeNodes.filter(
        (item) => item.requirementSetId && setIds.has(item.requirementSetId)
      );
      const intents = this.repository.testIntents.filter((item) => setIds.has(item.requirementSetId));
      const intentIds = new Set(intents.map((item) => item.id));
      const cases = this.repository.executableCases.filter((item) => intentIds.has(item.testIntentId));
      const caseIds = new Set(cases.map((item) => item.id));
      const evidence = this.repository.executionEvidence.filter((item) => caseIds.has(item.executableCaseId));
      return {
        sourceId: source.id,
        title: source.title,
        source: source.source,
        revision: source.revision,
        contentHash: source.contentHash,
        blockCount: source.blocks.length,
        attachmentCount: source.attachments.length,
        unreadAttachments: source.attachments.map((attachment) => ({
          name: attachment.name,
          url: attachment.url,
          type: attachment.type,
          status: "unread" as const,
          reason: "No OCR or visual adapter has analyzed this attachment yet."
        })),
        requirementSetCount: sets.length,
        nodeCount: nodes.length,
        intentCount: intents.length,
        executableCaseCount: cases.length,
        evidenceCount: evidence.length
      };
    });
  }

  listExecutableCases(projectId: string) {
    return this.repository.executableCases.filter((item) => item.knowledgeProjectId === projectId);
  }

  createExecutionEvidence(input: {
    projectId: string;
    systemId: string;
    executableCaseId: string;
    executionPlanId?: string;
    testCaseId: string;
    contextPackPath: string;
  }) {
    const project = this.getProject(input.projectId);
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Execution evidence requires a bound business system");
    }
    const executableCase = this.repository.executableCases.find(
      (item) => item.id === input.executableCaseId && item.knowledgeProjectId === project.id
    );
    if (!executableCase) throw new Error("Executable case not found");
    const executionPlan = input.executionPlanId
      ? this.repository.executionPlans.find(
          (item) =>
            item.id === input.executionPlanId &&
            item.knowledgeProjectId === project.id &&
            item.systemId === input.systemId &&
            item.executableCaseId === executableCase.id
        )
      : undefined;
    if (input.executionPlanId && !executionPlan) {
      throw new Error("Execution plan does not match the evidence context");
    }
    const executionSteps = executionPlan?.steps ?? executableCase.steps;
    const evidence: ExecutionEvidence = {
      id: id("executionEvidence"),
      knowledgeProjectId: project.id,
      systemId: input.systemId,
      executableCaseId: executableCase.id,
      executionPlanId: input.executionPlanId,
      testCaseId: input.testCaseId,
      contextPackPath: input.contextPackPath,
      status: "running",
      steps: executionSteps.map((step) => ({
        stepId: step.id,
        order: step.order,
        action: step.action,
        instruction: step.instruction,
        expected: step.expected,
        assertionStatus: "pending",
        evidenceRefs: [],
        sourceRefs: step.sourceRefs,
        origin: step.origin
      })),
      assertionContracts:
        executionPlan?.assertionContracts ?? buildAssertionContracts(executionSteps),
      assuranceLevel: "none",
      actorJourney: executionPlan?.actorJourney,
      coverage: {
        required: executableCase.coverageDimensions ?? ["workflow"],
        verified: [],
        missing: executableCase.coverageDimensions ?? ["workflow"]
      },
      tracePaths: [],
      artifactPaths: [input.contextPackPath],
      consoleErrors: [],
      networkFailures: [],
      createdAt: timestamp()
    };
    this.repository.executionEvidence.push(evidence);
    this.repository.persist();
    return evidence;
  }

  async completeExecutionEvidence(
    evidenceId: string,
    input: {
      status: "passed" | "failed" | "blocked";
      chainRunId?: string;
      actualResult?: string;
      artifactPaths: string[];
      tracePaths?: string[];
      consoleErrors?: string[];
      networkFailures?: string[];
      reporterPath?: string;
      reporterResult?: ExecutionEvidence["reporterResult"];
      actorRoleEvidencePath?: string;
      evidenceRootDir?: string;
    }
  ) {
    const evidence = this.repository.executionEvidence.find((item) => item.id === evidenceId);
    if (!evidence) throw new Error("Execution evidence not found");
    const redact = executionSecretRedactor(this.repository, evidence.systemId);
    evidence.status = input.status;
    evidence.chainRunId = input.chainRunId;
    evidence.actualResult = input.actualResult === undefined ? undefined : redact(input.actualResult);
    evidence.artifactPaths = [...new Set([...evidence.artifactPaths, ...input.artifactPaths])];
    evidence.tracePaths = [...new Set(input.tracePaths ?? [])];
    evidence.consoleErrors = (input.consoleErrors ?? []).map(redact);
    evidence.networkFailures = (input.networkFailures ?? []).map(redact);
    evidence.reporterPath = input.reporterPath;
    evidence.reporterResult = input.reporterResult
      ? redactReporterResult(input.reporterResult, redact)
      : undefined;
    if (input.actorRoleEvidencePath) {
      evidence.artifactPaths = [...new Set([...evidence.artifactPaths, input.actorRoleEvidencePath])];
    }
    evidence.assuranceLevel = determineAssuranceLevel(
      evidence.assertionContracts ?? [],
      input.reporterResult
    );
    const reporterSteps = evidence.reporterResult?.steps;
    const missingStepEvidence = reporterSteps
      ? evidence.steps
          .filter((step) => !reporterSteps.some((reported) => reported.id === step.stepId))
          .map((step) => step.stepId)
      : [];
    const missingTraceEvidence = input.reporterResult?.steps
      ? await Promise.all(
          (input.tracePaths ?? []).map(async (tracePath) => {
            try {
              await access(
                input.evidenceRootDir && !isAbsolute(tracePath)
                  ? join(input.evidenceRootDir, tracePath)
                  : tracePath
              );
              return undefined;
            } catch {
              return tracePath;
            }
          })
        ).then((paths) => paths.filter((path): path is string => Boolean(path)))
      : [];
    evidence.evidenceWarnings = [
      ...(missingStepEvidence.length
        ? [`Missing structured Reporter evidence for step(s): ${missingStepEvidence.join(", ")}`]
        : []),
      ...(missingTraceEvidence.length
        ? [`Missing trace artifact(s): ${missingTraceEvidence.join(", ")}`]
        : [])
    ];
    if ((missingStepEvidence.length || missingTraceEvidence.length) && evidence.assuranceLevel === "strong") {
      evidence.assuranceLevel = "limited";
    }
    for (const step of evidence.steps) {
      const screenshot = evidence.artifactPaths.find((path) =>
        path.toLowerCase().includes(`step-${String(step.order).padStart(2, "0")}`)
      );
      step.screenshotPath = screenshot;
      const reporterStep = reporterSteps?.find((reported) => reported.id === step.stepId);
      step.evidenceRefs = [...new Set([...(step.evidenceRefs ?? []), ...(reporterStep?.evidenceRefs ?? [])])];
      step.traceRefs = [...new Set(reporterStep?.traceRefs ?? evidence.tracePaths)];
      step.assertionStatus =
        input.status === "passed"
          ? "passed"
          : step.action === "assert"
            ? input.status
            : "blocked";
      if (step.action === "assert") step.actual = input.actualResult === undefined ? undefined : redact(input.actualResult);
    }
    if (reporterSteps !== undefined) {
      const requiredCoverage = evidence.coverage?.required ?? ["workflow"];
      const verifiedCoverage = verifiedCoverageDimensions(evidence, input.status);
      evidence.coverage = {
        required: requiredCoverage,
        verified: verifiedCoverage,
        missing: requiredCoverage.filter((dimension) => !verifiedCoverage.includes(dimension))
      };
      if (evidence.coverage.missing.length > 0 && evidence.assuranceLevel === "strong") {
        evidence.assuranceLevel = "limited";
      }
    }
    if (input.status !== "blocked") {
      const executableCase = this.repository.executableCases.find(
        (item) => item.id === evidence.executableCaseId
      );
      if (executableCase) {
        executableCase.status = "executed";
        executableCase.updatedAt = timestamp();
      }
    }
    evidence.completedAt = timestamp();
    const reportPath = await this.writeExecutionReport(evidence);
    evidence.artifactPaths = [...new Set([...evidence.artifactPaths, reportPath])];
    const htmlReportPath = await writeStaticExecutionReport({
      outputPath: join(
        this.knowledgeDir,
        "execution-evidence",
        "reports",
        evidence.chainRunId ?? evidence.id,
        "report.html"
      ),
      title: `Execution Evidence ${evidence.id}`,
      evidence,
      bugReports: this.repository.bugReports
        .filter((bug) => bug.chainRunId === evidence.chainRunId)
        .map((bug) => ({ id: bug.id, status: bug.status, actualResult: bug.actualResult })),
      gaps: this.repository.gaps
        .filter((gap) => gap.sourceId === evidence.chainRunId || gap.sourceId === evidence.id)
        .map((gap) => ({ id: gap.id, status: gap.status, reason: gap.reason }))
    });
    evidence.artifactPaths = [...new Set([...evidence.artifactPaths, htmlReportPath])];
    this.repository.persist();
    return evidence;
  }

  listExecutionEvidence(projectId: string) {
    return this.repository.executionEvidence.filter(
      (item) => item.knowledgeProjectId === projectId
    );
  }

  requirementEvalAccuracy(projectId: string, requirementSetId?: string) {
    this.getProject(projectId);
    const evidence = this.repository.executionEvidence.filter((item) => {
      if (item.knowledgeProjectId !== projectId) return false;
      if (!requirementSetId) return true;
      const executableCase = this.repository.executableCases.find(
        (candidate) => candidate.id === item.executableCaseId
      );
      return executableCase?.requirementSetId === requirementSetId;
    });
    const classified = evidence.map((item) => {
      const executableCase = this.repository.executableCases.find(
        (candidate) => candidate.id === item.executableCaseId
      );
      const linkedBug = this.repository.bugReports.some(
        (bug) =>
          bug.systemId === item.systemId &&
          (bug.chainRunId
            ? item.chainRunId === bug.chainRunId
            : bug.sourceId === item.executableCaseId)
      );
      const linkedGap = this.repository.gaps.some(
        (gap) =>
          gap.projectId === projectId &&
          [
            item.id,
            item.executableCaseId,
            item.chainRunId
          ].some((sourceId) => sourceId !== undefined && gap.sourceId === sourceId)
      );
      const technicalFailure =
        item.consoleErrors.length > 0 || item.networkFailures.length > 0 || linkedGap;
      let outcome: "validated" | "contradicted" | "inconclusive" = "inconclusive";
      if (
        executableCase &&
        (item.status === "passed" || (item.status === "failed" && linkedBug))
      ) {
        outcome = "validated";
      } else if (executableCase && item.status === "failed" && !technicalFailure) {
        outcome = "contradicted";
      }
      return {
        evidence: item,
        requirementSetId: executableCase?.requirementSetId,
        outcome,
        linkedBug,
        traceable:
          executableCase !== undefined &&
          this.repository.requirementSets.some(
            (requirementSet) => requirementSet.id === executableCase.requirementSetId
          ) &&
          item.steps.length > 0 &&
          item.steps.every((step) => step.sourceRefs.length > 0)
      };
    });
    const summarize = (items: typeof classified) => {
      const validated = items.filter((item) => item.outcome === "validated").length;
      const contradicted = items.filter((item) => item.outcome === "contradicted").length;
      const inconclusive = items.filter((item) => item.outcome === "inconclusive").length;
      const validatedOrContradicted = validated + contradicted;
      const conformanceOutcomes = items.filter(
        (item) =>
          item.requirementSetId !== undefined &&
          (item.evidence.status === "passed" || item.linkedBug)
      );
      return {
        totalEvidence: items.length,
        validated,
        contradicted,
        inconclusive,
        productDefects: items.filter((item) => item.linkedBug).length,
        accuracyRate:
          validatedOrContradicted === 0 ? null : validated / validatedOrContradicted,
        systemConformanceRate:
          conformanceOutcomes.length === 0
            ? null
            : conformanceOutcomes.filter((item) => item.evidence.status === "passed").length /
              conformanceOutcomes.length,
        traceabilityRate:
          items.length === 0
            ? null
            : items.filter((item) => item.traceable).length / items.length
      };
    };
    const requirementSetIds = [
      ...new Set(
        classified
          .map((item) => item.requirementSetId)
          .filter((value): value is string => value !== undefined)
      )
    ];

    return {
      ...summarize(classified),
      methodology:
        "Passed evidence and failed evidence linked to a BugReport validate the requirement expectation. Unclassified semantic failures contradict it. Blocked, Gap-linked, or technical failures are inconclusive.",
      byRequirementSet: requirementSetIds.map((setId) => ({
        requirementSetId: setId,
        title:
          this.repository.requirementSets.find((item) => item.id === setId)?.title ??
          setId,
        ...summarize(classified.filter((item) => item.requirementSetId === setId))
      }))
    };
  }

  requirementImpact(requirementSetId: string) {
    const requirementSet = this.getRequirementSet(requirementSetId);
    const affectedNodes = this.repository.knowledgeNodes.filter((node) =>
      requirementSet.affectedNodeIds.includes(node.id)
    );
    const previousTestIntents = requirementSet.previousRequirementSetId
      ? this.repository.testIntents.filter(
          (intent) => intent.requirementSetId === requirementSet.previousRequirementSetId
        )
      : [];
    const previousIntentIds = new Set(previousTestIntents.map((intent) => intent.id));
    return {
      requirementSetId,
      previousRequirementSetId: requirementSet.previousRequirementSetId,
      affectedNodeIds: requirementSet.affectedNodeIds,
      affectedNodeKeys: [...new Set(affectedNodes.map(knowledgeNodeKey))],
      regressionTestIntentIds: previousTestIntents.map((intent) => intent.id),
      regressionExecutableCaseIds: this.repository.executableCases
        .filter((item) => previousIntentIds.has(item.testIntentId))
        .map((item) => item.id)
    };
  }

  async recordSystemObservation(input: {
    projectId: string;
    systemId: string;
    type: KnowledgeNodeType;
    title: string;
    content: string;
    module: string;
    sourceRefs: string[];
    confidence?: number;
  }) {
    const project = this.getProject(input.projectId);
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Business system must be bound before recording observations");
    }
    if (input.sourceRefs.length === 0) {
      throw new Error("System observations require at least one evidence source reference");
    }
    const result = this.upsertSystemObservation(project, input.systemId, {
      type: input.type,
      title: input.title,
      content: input.content,
      module: input.module,
      sourceRefs: input.sourceRefs,
      confidence: input.confidence ?? 1
    });
    this.repository.persist();
    await this.writeSystemKnowledge(project, input.systemId);
    return result;
  }

  getSystemBrain(projectId: string, systemId: string) {
    const project = this.getProject(projectId);
    if (!project.systemIds.includes(systemId)) {
      throw new Error("Business system must be bound before reading System Brain");
    }
    return buildSystemBrain(this.repository, projectId, systemId);
  }

  async refreshSystemBrain(projectId: string, systemId: string) {
    const project = this.getProject(projectId);
    if (!project.systemIds.includes(systemId)) {
      throw new Error("Business system must be bound before refreshing System Brain");
    }
    const sourceBrain = buildSystemBrain(this.repository, projectId, systemId);
    for (const draft of systemObservationDrafts(sourceBrain)) {
      this.upsertSystemObservation(project, systemId, draft);
    }
    this.repository.persist();
    const brain = buildSystemBrain(this.repository, projectId, systemId);
    await this.writeProjectIndex(project);
    await this.writeSystemKnowledge(project, systemId);
    await this.writeSystemBrain(project, brain);
    return brain;
  }

  private getProject(projectId: string) {
    const project = this.repository.knowledgeProjects.find((item) => item.id === projectId);
    if (!project) throw new Error("Knowledge project not found");
    return project;
  }

  private createKnowledgeEdges(projectId: string, nodes: KnowledgeNode[]) {
    const moduleNodes = nodes.filter((node) => node.type === "module");
    const requirementNodes = nodes.filter((node) => node.type === "requirement");
    const drafts: Array<{
      fromNodeId: string;
      toNodeId: string;
      relation: string;
      sourceRefs: string[];
    }> = [];
    for (const node of nodes) {
      const moduleNode = moduleNodes.find(
        (candidate) => normalizeText(candidate.module) === normalizeText(node.module)
      );
      if (moduleNode && node.id !== moduleNode.id) {
        drafts.push({
          fromNodeId: moduleNode.id,
          toNodeId: node.id,
          relation: "contains",
          sourceRefs: [...new Set([...moduleNode.sourceRefs, ...node.sourceRefs])]
        });
      }
      const requirementNode = requirementNodes.find((candidate) =>
        candidate.sourceRefs.some((sourceRef) => node.sourceRefs.includes(sourceRef))
      );
      if (requirementNode && node.id !== requirementNode.id && node.type !== "module") {
        drafts.push({
          fromNodeId: requirementNode.id,
          toNodeId: node.id,
          relation: "covers",
          sourceRefs: [...new Set([...requirementNode.sourceRefs, ...node.sourceRefs])]
        });
      }
    }
    for (let index = 0; index < requirementNodes.length - 1; index += 1) {
      const current = requirementNodes[index];
      const next = requirementNodes[index + 1];
      const currentHasWorkflow = nodes.some(
        (node) =>
          node.type === "workflow" &&
          node.sourceRefs.some((sourceRef) => current.sourceRefs.includes(sourceRef))
      );
      const nextHasWorkflow = nodes.some(
        (node) =>
          node.type === "workflow" &&
          node.sourceRefs.some((sourceRef) => next.sourceRefs.includes(sourceRef))
      );
      if (
        normalizeText(current.module) !== normalizeText(next.module) &&
        currentHasWorkflow &&
        nextHasWorkflow
      ) {
        drafts.push({
          fromNodeId: current.id,
          toNodeId: next.id,
          relation: "flows-to",
          sourceRefs: [...new Set([...current.sourceRefs, ...next.sourceRefs])]
        });
      }
    }
    const created = drafts
      .filter(
        (draft) =>
          !this.repository.knowledgeEdges.some(
            (edge) =>
              edge.knowledgeProjectId === projectId &&
              edge.fromNodeId === draft.fromNodeId &&
              edge.toNodeId === draft.toNodeId &&
              edge.relation === draft.relation
          )
      )
      .map((draft) => ({
        id: id("knowledgeEdge"),
        knowledgeProjectId: projectId,
        ...draft,
        createdAt: timestamp()
      }));
    this.repository.knowledgeEdges.push(...created);
    return created;
  }

  private getRequirementSet(requirementSetId: string) {
    const result = this.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!result) throw new Error("Requirement set not found");
    return result;
  }

  private getRequirementSource(sourceId: string) {
    const result = this.repository.requirementSources.find((item) => item.id === sourceId);
    if (!result) throw new Error("Requirement source not found");
    return result;
  }

  private getTestIntent(intentId: string): TestIntent {
    const result = this.repository.testIntents.find((item) => item.id === intentId);
    if (!result) throw new Error("Test intent not found");
    return result;
  }

  private createGap(
    projectId: string,
    sourceId: string,
    reason: string,
    sourceType = "executable-case-compiler"
  ) {
    const now = timestamp();
    const gap: Gap = {
      id: id("gap"),
      projectId,
      sourceType,
      sourceId,
      reason,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    return gap;
  }

  private upsertSystemObservation(
    project: KnowledgeProject,
    systemId: string,
    draft: SystemObservationDraft
  ) {
    const expected = this.repository.knowledgeNodes.find(
      (node) =>
        node.knowledgeProjectId === project.id &&
        node.origin !== "observed" &&
        node.status === "confirmed" &&
        node.type === draft.type &&
        normalizeText(node.title) === normalizeText(draft.title)
    );
    const conflicted = Boolean(
      expected && normalizeText(expected.content) !== normalizeText(draft.content)
    );
    const now = timestamp();
    const existing = this.repository.knowledgeNodes.find(
      (node) =>
        node.knowledgeProjectId === project.id &&
        node.origin === "observed" &&
        node.systemId === systemId &&
        node.type === draft.type &&
        normalizeText(node.title) === normalizeText(draft.title) &&
        observationIdentityRef(node.sourceRefs) === observationIdentityRef(draft.sourceRefs)
    );
    const observation: KnowledgeNode = existing ?? {
      id: id("knowledgeNode"),
      knowledgeProjectId: project.id,
      systemId,
      type: draft.type,
      title: draft.title.trim(),
      content: draft.content.trim(),
      module: draft.module.trim() || "General",
      sourceRefs: [...new Set(draft.sourceRefs)],
      origin: "observed",
      confidence: Math.max(0, Math.min(1, draft.confidence)),
      status: conflicted ? "conflicted" : "confirmed",
      createdAt: now,
      updatedAt: now
    };
    Object.assign(observation, {
      systemId,
      title: draft.title.trim(),
      content: draft.content.trim(),
      module: draft.module.trim() || "General",
      sourceRefs: [...new Set(draft.sourceRefs)],
      confidence: Math.max(0, Math.min(1, draft.confidence)),
      status: conflicted ? "conflicted" : "confirmed",
      updatedAt: now
    });
    if (!existing) this.repository.knowledgeNodes.push(observation);
    const existingGaps = this.repository.gaps.filter(
      (gap) =>
        gap.projectId === project.id &&
        gap.sourceType === "system-observation" &&
        gap.sourceId === observation.id
    );
    if (conflicted && existingGaps.every((gap) => gap.status !== "open")) {
      existingGaps.push(
        this.createGap(
          project.id,
          observation.id,
          `Observed system behavior conflicts with approved requirement node ${expected?.id}`,
          "system-observation"
        )
      );
    }
    if (!conflicted) {
      for (const gap of existingGaps.filter((item) => item.status === "open")) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
    }
    return {
      observation,
      expected,
      conflicted,
      gaps: existingGaps.filter((gap) => gap.status === "open")
    };
  }

  private async writeProjectIndex(project: KnowledgeProject) {
    const projectDir = join(this.knowledgeDir, project.key);
    await mkdir(projectDir, { recursive: true });
    const sets = this.listRequirementSets(project.id);
    await writeFile(
      join(projectDir, "MOC.md"),
      [
        "---",
        `knowledge_project_id: ${project.id}`,
        "type: knowledge-project",
        "---",
        "",
        `# ${project.name}`,
        "",
        "## Requirements",
        ...sets.map((item) => `- [[requirements/${item.id}/analysis|${item.title} v${item.version}]]`),
        "",
        "## Systems",
        ...(project.systemIds.length > 0
          ? project.systemIds.map(
              (systemId) => `- [[systems/${systemId}/brain|${systemId}]]`
            )
          : ["- Not bound"])
      ].join("\n"),
      "utf8"
    );
  }

  private async writeRequirement(project: KnowledgeProject, source: RequirementSource, set: RequirementSet) {
    const requirementDir = join(this.knowledgeDir, project.key, "requirements", set.id);
    await mkdir(requirementDir, { recursive: true });
    await writeFile(
      join(requirementDir, "source.md"),
      [
        "---",
        `requirement_set_id: ${set.id}`,
        `source_id: ${source.id}`,
        `source: ${JSON.stringify(source.source)}`,
        `content_hash: ${source.contentHash}`,
        `status: ${set.status}`,
        "---",
        "",
        `# ${source.title}`,
        "",
        source.content
      ].join("\n"),
      "utf8"
    );
  }

  private async writeAnalysis(
    set: RequirementSet,
    analysis: RequirementAnalysis,
    intents: TestIntent[],
    evaluation: ReturnType<typeof evaluatePolicyOutput>,
    coverage: ReturnType<typeof designTests>["coverage"],
    evaluationGate: RequirementEvaluationGate
  ) {
    const project = this.getProject(set.knowledgeProjectId);
    const requirementDir = join(this.knowledgeDir, project.key, "requirements", set.id);
    await mkdir(requirementDir, { recursive: true });
    await writeFile(
      join(requirementDir, "analysis.md"),
      [
        "---",
        `requirement_set_id: ${set.id}`,
        `policy: ${analysis.policyId}@${analysis.policyVersion}`,
        `provider: ${analysis.provider}`,
        `status: ${set.status}`,
        "---",
        "",
        `# ${set.title} Analysis`,
        "",
        "## Requirement Clauses",
        ...analysis.clauses.map(
          (clause) =>
            `- [${clause.sourceRef}] [module=${clause.module}] ${clause.text} (${clause.nodeTypes.length > 0 ? clause.nodeTypes.join(", ") : "unclassified"})`
        ),
        "",
        "## Knowledge",
        ...analysis.nodes.map(
          (node) => `- **${node.type}** ${node.title}: ${node.content} [${node.sourceRefs.join(", ")}]`
        ),
        "",
        "## Evaluation",
        `- Verdict: ${evaluation.verdict}`,
        `- Score: ${evaluation.score}`,
        `- Coverage: ${evaluation.coverage.coveredClauses}/${evaluation.coverage.totalClauses} (${Math.round(evaluation.coverage.coverageRate * 100)}%)`,
        `- Test intents: ${coverage.intentCount}`,
        `- Unsupported claims: ${evaluation.unsupportedClaims.length}`,
        `- Gate status: ${evaluationGate.status}`,
        "",
        "### Required Actions",
        ...(evaluationGate.actions.length > 0
          ? evaluationGate.actions.map(
              (action) =>
                `- [${action.status}] ${action.id} (${action.kind}): ${action.message} [${action.sourceRefs.join(", ")}]`
            )
          : ["- None"]),
        "",
        "### Contradictions",
        ...(analysis.contradictions.length > 0
          ? analysis.contradictions.map((item) => `- ${item}`)
          : ["- None"]),
        "",
        "### Missing Branches",
        ...(analysis.missingBranches.length > 0
          ? analysis.missingBranches.map((item) => `- ${item}`)
          : ["- None"]),
        "",
        "## Open Questions",
        ...(analysis.openQuestions.length > 0 ? analysis.openQuestions.map((item) => `- ${item}`) : ["- None"]),
        "",
        "## Test Intents",
        ...intents.map((intent) => `- ${intent.id}: ${intent.title} [${intent.status}]`)
      ].join("\n"),
      "utf8"
    );
  }

  private async writeEvaluationConfirmations(set: RequirementSet) {
    const project = this.getProject(set.knowledgeProjectId);
    const requirementDir = join(this.knowledgeDir, project.key, "requirements", set.id);
    await mkdir(requirementDir, { recursive: true });
    const gate = set.evaluationGate;
    await writeFile(
      join(requirementDir, "evaluation-confirmations.md"),
      [
        "---",
        `requirement_set_id: ${set.id}`,
        `gate_status: ${gate?.status ?? "missing"}`,
        `updated_at: ${set.updatedAt}`,
        "---",
        "",
        `# ${set.title} Eval Confirmations`,
        "",
        ...(gate?.actions.length
          ? gate.actions.flatMap((action) => [
              `## ${action.id}`,
              `- Kind: ${action.kind}`,
              `- Status: ${action.status}`,
              `- Requirement evidence: ${action.sourceRefs.join(", ") || "None"}`,
              `- Resolution node: ${action.resolutionNodeId ?? "None"}`,
              `- Confirmed at: ${action.confirmedAt ?? "Not confirmed"}`,
              `- Confirmation: ${action.confirmationNote ?? "None"}`,
              ""
            ])
          : ["- No Requirement Eval actions"])
      ].join("\n"),
      "utf8"
    );
  }

  private async writeModuleKnowledge(
    set: RequirementSet,
    analysis: ReturnType<typeof analyzeRequirement>,
    intents: TestIntent[]
  ) {
    const project = this.getProject(set.knowledgeProjectId);
    const modules = [...new Set(analysis.clauses.map((clause) => clause.module))];
    const profiles = this.repository.testDataProfiles.filter(
      (item) => item.requirementSetId === set.id
    );
    for (const module of modules) {
      const moduleDir = join(this.knowledgeDir, project.key, "modules", normalizeKey(module));
      await mkdir(moduleDir, { recursive: true });
      const moduleNodes = analysis.nodes.filter((node) => node.module === module);
      const groups = {
        "analysis.md": moduleNodes,
        "rules.md": moduleNodes.filter((node) => node.type === "rule"),
        "flows.md": moduleNodes.filter(
          (node) => node.type === "workflow" || node.type === "state"
        )
      };
      for (const [file, nodes] of Object.entries(groups)) {
        await writeFile(
          join(moduleDir, file),
          [
            "---",
            `requirement_set_id: ${set.id}`,
            `module: ${module}`,
            `status: ${set.status}`,
            "---",
            "",
            `# ${module} ${file.replace(".md", "")}`,
            "",
            ...(nodes.length > 0
              ? nodes.map((node) => `- **${node.type}** ${node.title}: ${node.content}`)
              : ["- No confirmed entries"])
          ].join("\n"),
          "utf8"
        );
      }
      const moduleIntents = intents.filter((intent) => intent.module === module);
      await writeFile(
        join(moduleDir, "cases.md"),
        [
          `# ${module} cases`,
          "",
          ...moduleIntents.map((intent) => `- ${intent.id}: ${intent.title}`)
        ].join("\n"),
        "utf8"
      );
      const moduleSourceRefs = new Set(
        analysis.clauses
          .filter((clause) => clause.module === module)
          .map((clause) => clause.sourceRef)
      );
      const moduleProfiles = profiles.filter((profile) =>
        profile.sourceRefs.some((sourceRef) => moduleSourceRefs.has(sourceRef))
      );
      await writeFile(
        join(moduleDir, "data.md"),
        [
          `# ${module} data`,
          "",
          ...moduleProfiles.map(
            (item) =>
              `- ${item.name}: ${item.strategy} (${item.constraints.join(", ")})`
          )
        ].join("\n"),
        "utf8"
      );
    }
  }

  private async writeSystemKnowledge(project: KnowledgeProject, systemId: string) {
    const systemDir = join(this.knowledgeDir, project.key, "systems", systemId);
    await mkdir(systemDir, { recursive: true });
    const expected = this.repository.knowledgeNodes.filter(
      (node) => node.knowledgeProjectId === project.id && node.origin !== "observed" && node.status === "confirmed"
    );
    const observed = this.repository.knowledgeNodes.filter(
      (node) =>
        node.knowledgeProjectId === project.id &&
        node.origin === "observed" &&
        node.systemId === systemId
    );
    const files = {
      "expected.md": expected,
      "observed.md": observed,
      "conflicts.md": observed.filter((node) => node.status === "conflicted")
    };
    for (const [file, nodes] of Object.entries(files)) {
      await writeFile(
        join(systemDir, file),
        [
          "---",
          `knowledge_project_id: ${project.id}`,
          `system_id: ${systemId}`,
          `layer: ${file.replace(".md", "")}`,
          "---",
          "",
          `# ${project.name} ${file.replace(".md", "")}`,
          "",
          ...(nodes.length > 0
            ? nodes.map((node) => `- **${node.type}** ${node.title}: ${node.content} (${node.id})`)
            : ["- None"])
        ].join("\n"),
        "utf8"
      );
    }
  }

  private async writeSystemBrain(project: KnowledgeProject, brain: SystemBrain) {
    const systemDir = join(this.knowledgeDir, project.key, "systems", brain.systemId);
    await mkdir(systemDir, { recursive: true });
    await writeFile(
      join(systemDir, "brain.md"),
      [
        "---",
        `knowledge_project_id: ${project.id}`,
        `system_id: ${brain.systemId}`,
        "layer: system-brain",
        "---",
        "",
        `# ${project.name} System Brain`,
        "",
        "## Readiness",
        `- Page evidence: ${brain.readiness.pageEvidence}`,
        `- Locator evidence: ${brain.readiness.locatorEvidence}`,
        `- Workflow evidence: ${brain.readiness.workflowEvidence}`,
        `- API evidence: ${brain.readiness.apiEvidence}`,
        `- Navigation evidence: ${brain.readiness.navigationEvidence}`,
        `- State evidence: ${brain.readiness.stateEvidence}`,
        `- Ready for compilation: ${brain.readiness.readyForCompilation}`,
        "",
        "## Pages",
        ...(brain.pages.length > 0
          ? brain.pages.map(
              (page) =>
                `- ${page.name} v${page.version} (${page.route}): ${page.locatorCount} locators, ${page.probeIssueCount} probe issues [${page.sourceRefs.join(", ")}]`
            )
          : ["- None"]),
        "",
        "## Trained Workflows",
        ...(brain.workflows.length > 0
          ? brain.workflows.map(
              (workflow) =>
                `- ${workflow.pageName}: ${workflow.actionStepIds.length} actions, ${workflow.apiFlowIds.length} API flows [${workflow.sourceRefs.join(", ")}]`
            )
          : ["- None"]),
        "",
        "## Navigation Graph",
        ...(brain.navigationEdges.length > 0
          ? brain.navigationEdges.map(
              (edge) =>
                `- ${edge.text}: ${edge.fromUrl} -> ${edge.toUrl} [${edge.sourceRefs.join(", ")}]`
            )
          : ["- None"]),
        "",
        "## Observed Behavior Rules",
        ...(brain.behaviorRules.length > 0
          ? brain.behaviorRules.map(
              (rule) =>
                `- ${rule.trigger} -> ${rule.effect} [${rule.sourceRefs.join(", ")}]`
            )
          : ["- None"]),
        "",
        "## State Transitions",
        ...(brain.stateTransitions.length > 0
          ? brain.stateTransitions.map(
              (transition) =>
                `- ${transition.action} ${transition.targetName}${
                  transition.inputValue ? `=${transition.inputValue}` : ""
                }: ${transition.beforeStateId} -> ${transition.afterStateId}; visible +[${
                  transition.visibleAdded.join(", ")
                }] -[${transition.visibleRemoved.join(", ")}] [${transition.sourceRefs.join(
                  ", "
                )}]`
            )
          : ["- None"]),
        "",
        "## API Flows",
        ...(brain.apiFlows.length > 0
          ? brain.apiFlows.map(
              (flow) =>
                `- ${flow.name}: ${flow.requests
                  .map((request) => `${request.method} ${request.url} ${request.status}`)
                  .join("; ")}`
            )
          : ["- None"]),
        "",
        "## Conflicts",
        ...(brain.conflicts.length > 0
          ? brain.conflicts.map(
              (conflict) => `- ${conflict.title}: ${conflict.content} (${conflict.id})`
            )
          : ["- None"])
      ].join("\n"),
      "utf8"
    );
  }

  private async writeExecutionReport(evidence: ExecutionEvidence) {
    const project = this.getProject(evidence.knowledgeProjectId);
    const reportDir = join(
      this.knowledgeDir,
      project.key,
      "reports",
      evidence.chainRunId ?? evidence.id
    );
    const reportPath = join(reportDir, "summary.md");
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      reportPath,
      [
        "---",
        `execution_evidence_id: ${evidence.id}`,
        `knowledge_project_id: ${evidence.knowledgeProjectId}`,
        `system_id: ${evidence.systemId}`,
        `executable_case_id: ${evidence.executableCaseId}`,
        `chain_run_id: ${evidence.chainRunId ?? "pending"}`,
        `status: ${evidence.status}`,
        "---",
        "",
        "# Execution Evidence",
        "",
        `Actual result: ${evidence.actualResult ?? "Pending"}`,
        "",
        "## Steps",
        ...evidence.steps.map(
          (step) =>
            `- ${step.order}. ${step.action} [${step.assertionStatus}] ${step.instruction}; origin=${step.origin}; sources=${step.sourceRefs.join(",")}; screenshot=${step.screenshotPath ?? "N/A"}`
        ),
        "",
        "## Console Errors",
        ...(evidence.consoleErrors.length > 0 ? evidence.consoleErrors.map((item) => `- ${item}`) : ["- None"]),
        "",
        "## Network Failures",
        ...(evidence.networkFailures.length > 0 ? evidence.networkFailures.map((item) => `- ${item}`) : ["- None"]),
        "",
        "## Artifacts",
        ...evidence.artifactPaths.map((item) => `- ${item}`)
      ].join("\n"),
      "utf8"
    );
    return reportPath;
  }
}

function buildRequirementEvaluationGate(
  analysis: RequirementAnalysis,
  evaluation: ReturnType<typeof evaluatePolicyOutput>,
  gaps: Gap[]
): RequirementEvaluationGate {
  const createdAt = timestamp();
  const actions: RequirementEvalAction[] = [];
  const addAction = (
    kind: RequirementEvalActionKind,
    message: string,
    sourceRefs: string[],
    status: RequirementEvalAction["status"] = "pending"
  ) => {
    const sourceType =
      kind === "clarification"
        ? "requirement-clarification"
        : kind === "contradiction"
          ? "requirement-conflict"
          : undefined;
    actions.push({
      id: id("evalAction"),
      kind,
      message,
      sourceRefs,
      gapIds: sourceType
        ? gaps
            .filter((gap) => gap.sourceType === sourceType && gap.reason.includes(message))
            .map((gap) => gap.id)
        : [],
      status,
      createdAt
    });
  };
  const sourceRefsFor = (message: string) =>
    analysis.clauses
      .filter((clause) => message.includes(clause.text))
      .map((clause) => clause.sourceRef);

  for (const question of analysis.openQuestions) {
    addAction("clarification", question, sourceRefsFor(question));
  }
  for (const contradiction of analysis.contradictions) {
    addAction("contradiction", contradiction, sourceRefsFor(contradiction), "blocked");
  }
  for (const missingBranch of analysis.missingBranches) {
    addAction("missing-branch", missingBranch, sourceRefsFor(missingBranch));
  }
  for (const sourceRef of evaluation.coverage.uncoveredSourceRefs) {
    addAction("uncovered-coverage", `Classify uncovered requirement clause ${sourceRef}`, [sourceRef]);
  }
  for (const unsupportedClaim of evaluation.unsupportedClaims) {
    addAction("unsupported-claim", unsupportedClaim, [], "blocked");
  }
  if (evaluation.verdict === "blocked" && !actions.some((action) => action.status === "blocked")) {
    addAction(
      "unsupported-claim",
      evaluation.reasons.join("; ") || "Requirement Eval output is blocked",
      [],
      "blocked"
    );
  }

  return {
    policyId: analysis.policyId,
    policyVersion: analysis.policyVersion,
    verdict: evaluation.verdict,
    score: evaluation.score,
    coverage: evaluation.coverage,
    status:
      evaluation.verdict === "blocked" || actions.some((action) => action.status === "blocked")
        ? "blocked"
        : actions.some((action) => action.status === "pending")
          ? "needs-confirmation"
          : "passed",
    actions,
    generatedAt: createdAt
  };
}

function compileSteps(content: string, sourceRefs: string[]): ExecutableCaseStep[] {
  const steps: ExecutableCaseStep[] = [];
  const add = (step: Omit<ExecutableCaseStep, "id" | "order" | "sourceRefs">) =>
    steps.push({ ...step, id: id("step"), order: steps.length + 1, sourceRefs });
  add({
    action: "navigate",
    instruction: "Open the target module entry page",
    targetSemantic: "module entry",
    origin: "derived"
  });
  if (/\u65b0\u5efa|create|new|\u586b\u5199|fill/i.test(content)) {
    add({
      action: "click",
      instruction: "Start a new business record before filling the form",
      targetSemantic: "new record action",
      origin: /\u65b0\u5efa|create|new/i.test(content) ? "source" : "derived"
    });
  }
  if (/\u586b\u5199|fill|form|\u8868\u5355/i.test(content)) {
    add({
      action: "fill",
      instruction: "Fill required fields with generated data",
      targetSemantic: "business form",
      origin: "source"
    });
  }
  if (/\u9009\u62e9.+(?:\u540e|\u5219|\u65f6)|select.+then|type/i.test(content)) {
    add({
      action: "select",
      instruction: "Select the requirement-defined option",
      targetSemantic: "conditional selector",
      origin: "source"
    });
  }
  add({
    action: "assert",
    instruction: "Verify the resulting state and conditional fields",
    targetSemantic: "requirement outcome",
    expected: "Behavior matches the approved requirement",
    origin: "source"
  });
  return steps;
}

function normalizeKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
  if (!key) throw new Error("Knowledge project key is required");
  return key;
}

function summarize(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function knowledgeNodeKey(node: Pick<KnowledgeNode, "type" | "title" | "module">) {
  return `${node.type}:${normalizeText(node.module)}:${normalizeText(node.title)}`;
}

function observationIdentityRef(sourceRefs: string[]) {
  const prefixes = [
    "locator-point:",
    "action-step:",
    "api-flow:",
    "training-session:",
    "page-model:"
  ];
  for (const prefix of prefixes) {
    const match = sourceRefs.find((sourceRef) => sourceRef.startsWith(prefix));
    if (match) return match;
  }
  return [...sourceRefs].sort()[0] ?? "";
}

function executableCaseCompileKey(
  repository: InMemoryBrainCreatorRepository,
  intent: TestIntent,
  requirementSet: RequirementSet,
  systemId?: string
) {
  const systemEvidence = systemId
    ? {
        brain: buildSystemBrain(repository, intent.knowledgeProjectId, systemId),
        bindings: repository.pageBindingDecisions.filter(
          (item) => item.systemId === systemId && item.testIntentId === intent.id
        )
      }
    : undefined;
  return createHash("sha256")
    .update(
      JSON.stringify({
        testIntentId: intent.id,
        systemId: systemId ?? null,
        requirementHash: requirementSet.contentHash,
        systemEvidence
      })
    )
    .digest("hex");
}

function timestamp() {
  return new Date().toISOString();
}

function executionSecretRedactor(
  repository: InMemoryBrainCreatorRepository,
  systemId: string
) {
  const values = repository.authProfiles
    .filter((profile) => profile.projectId === systemId)
    .flatMap((profile) => {
      try {
        return Object.values(decryptSecrets(profile.encryptedSecrets));
      } catch {
        return [];
      }
    })
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
  return (value: string) => values.reduce(
    (result, secret) => result.split(secret).join("[REDACTED]"),
    value
  );
}

function redactReporterResult(
  reporter: NonNullable<ExecutionEvidence["reporterResult"]>,
  redact: (value: string) => string
): NonNullable<ExecutionEvidence["reporterResult"]> {
  return {
    ...reporter,
    assertions: reporter.assertions.map((assertion) => ({
      ...assertion,
      ...(assertion.actual === undefined ? {} : { actual: redact(assertion.actual) }),
      ...(assertion.expected === undefined ? {} : { expected: redact(assertion.expected) })
    })),
    steps: reporter.steps?.map((step) => ({
      ...step,
      ...(step.error === undefined ? {} : { error: redact(step.error) }),
      ...(step.consoleErrors === undefined ? {} : { consoleErrors: step.consoleErrors.map(redact) }),
      ...(step.networkFailures === undefined ? {} : { networkFailures: step.networkFailures.map(redact) })
    })),
    consoleErrors: reporter.consoleErrors.map(redact),
    networkFailures: reporter.networkFailures.map(redact)
  };
}

function coverageClassificationReason(input: {
  classification: string;
  requirementSetStatus?: RequirementSet["status"];
  cases: ExecutableCase[];
  results: ExecutionEvidence[];
}) {
  switch (input.classification) {
    case "superseded":
      return "The requirement baseline is superseded, so its historical execution is excluded from active coverage.";
    case "not-selected":
      return "No active ExecutableCase is linked to this TestIntent.";
    case "strong-verified":
      return "At least one linked execution has strong assurance and no missing coverage dimension.";
    case "limited":
      return "Linked execution produced only limited assurance; strong assertion evidence is incomplete.";
    case "failed":
      return "A linked execution failed before strong coverage was established.";
    case "blocked":
      return "A linked execution or case is blocked and has not established the required evidence.";
    default:
      return `Coverage classification '${input.classification}' was derived from ${input.cases.length} case(s) and ${input.results.length} evidence record(s).`;
  }
}

function verifiedCoverageDimensions(
  evidence: ExecutionEvidence,
  status: ExecutionEvidence["status"]
): CoverageDimension[] {
  if (status !== "passed") return [];
  const hasStepEvidence = (action: ExecutableCaseStep["action"]) =>
    evidence.steps.some(
      (step) => step.action === action && (step.evidenceRefs?.length ?? 0) > 0
    );
  const hasAssertion = (type: AssertionContractType) =>
    evidence.assertionContracts?.some((contract) => contract.type === type) &&
    evidence.reporterResult?.assertions.some((assertion) => assertion.status === "passed");
  const verified: CoverageDimension[] = [];
  if (hasStepEvidence("fill") || hasStepEvidence("select") || hasAssertion("value")) {
    verified.push("field");
  }
  if (hasStepEvidence("navigate") || hasStepEvidence("click") || hasAssertion("workflow")) {
    verified.push("workflow");
  }
  if (hasStepEvidence("select") || hasAssertion("state")) {
    verified.push("state");
  }
  if (evidence.actorJourney?.length || hasAssertion("side-effect")) {
    verified.push("permission");
  }
  if (hasAssertion("network")) verified.push("integration");
  return [...new Set(verified)];
}
