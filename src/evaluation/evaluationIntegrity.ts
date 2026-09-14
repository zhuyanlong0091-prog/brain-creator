import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  EvaluationInterventionCategory,
  EvaluationProvider,
  EvaluationTrial,
  InterventionRecord,
  ProjectionManifest,
  SourceSnapshot
} from "../brain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { id } from "../shared/id.js";
import { RequirementGateService } from "./requirementGate.js";

export type StartEvaluationTrialInput = {
  comparisonGroupId: string;
  knowledgeProjectId: string;
  systemId?: string;
  requirementSourceId: string;
  provider: EvaluationProvider;
  workspacePath: string;
  storePath: string;
  codeRevision: string;
  runtimeVersions: Record<string, string>;
  runtimeBuildIdentity?: string;
  businessScenarioIds?: string[];
  approvalReceiptId?: string;
};

export class EvaluationIntegrityService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  startTrial(input: StartEvaluationTrialInput) {
    const source = this.repository.requirementSources.find(
      (item) => item.id === input.requirementSourceId && item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!source) throw new Error("Requirement source not found for the evaluation trial");
    const project = this.repository.knowledgeProjects.find((item) => item.id === input.knowledgeProjectId);
    if (!project) throw new Error("Knowledge project not found for the evaluation trial");
    if (input.systemId) {
      if (!this.repository.systemProfiles.some((item) => item.id === input.systemId)) {
        throw new Error("Evaluation trial system not found");
      }
      if (!project.systemIds.includes(input.systemId)) {
        throw new Error("Evaluation trial system is not bound to the knowledge project");
      }
    }
    const requirementSetId = source.latestRequirementSetId;
    const requirementSet = requirementSetId
      ? this.repository.requirementSets.find((item) => item.id === requirementSetId)
      : undefined;
    if (requirementSetId && (!requirementSet || requirementSet.knowledgeProjectId !== project.id || requirementSet.sourceId !== source.id)) {
      throw new Error("Evaluation trial source requirement set is invalid");
    }
    const scenarioIds = unique(input.businessScenarioIds ?? []);
    if (scenarioIds.length > 0 && !input.systemId) {
      throw new Error("A scoped evaluation trial requires an explicit business system");
    }
    for (const scenarioId of scenarioIds) {
      const scenario = this.repository.businessScenarios.find((item) => item.id === scenarioId);
      if (!scenario || scenario.knowledgeProjectId !== project.id || scenario.requirementSetId !== requirementSetId) {
        throw new Error("Evaluation trial scenario is outside the source requirement set");
      }
      const contract = this.repository.scenarioAssuranceContracts.find((item) => item.scenarioId === scenarioId);
      if (input.systemId && contract?.systemId && contract.systemId !== input.systemId) {
        throw new Error("Evaluation trial scenario belongs to another business system");
      }
    }
    const approvalReceipt = input.approvalReceiptId
      ? this.repository.approvalReceipts.find((item) => item.id === input.approvalReceiptId)
      : undefined;
    if (input.approvalReceiptId && (!approvalReceipt || !requirementSetId || requirementSet?.status !== "approved" || !approvalReceipt.assetRefs.includes(`requirement-set:${requirementSetId}`))) {
      throw new Error("Evaluation trial approval must reference an existing approved requirement set");
    }
    if (approvalReceipt && requirementSetId) {
      new RequirementGateService(this.repository).verifyApprovalReceipt(requirementSetId, approvalReceipt.id);
    }
    const peers = this.repository.evaluationTrials.filter(
      (item) => item.comparisonGroupId === input.comparisonGroupId
    );
    if (peers.some((item) => samePath(item.storePath, input.storePath))) {
      throw new Error("Each provider in an evaluation comparison must use an isolated store");
    }
    if (peers.some((item) =>
      item.requirementSourceId !== source.id ||
      item.sourceRevision !== source.revision ||
      item.sourceHash !== source.contentHash
    )) {
      throw new Error("Evaluation comparison trials must use the same source revision and hash");
    }
    if (peers.some((item) => item.codeRevision !== input.codeRevision)) {
      throw new Error("Evaluation comparison trials must use the same code revision");
    }

    const now = new Date().toISOString();
    const executionScope = scenarioIds.length > 0 || approvalReceipt ? {
      businessScenarioIds: [...scenarioIds].sort(),
      baselineHash: requirementSetId ? new RequirementGateService(this.repository).baselineFingerprint(requirementSetId) : undefined,
      ...(approvalReceipt ? { approvalScopeRef: approvalReceipt.id, approvalScopeHash: approvalReceipt.assetHash } : {})
    } : undefined;
    const trialId = id("evaluationTrial");
    const sourceSnapshot: SourceSnapshot = {
      id: id("sourceSnapshot"),
      trialId,
      sourceId: source.id,
      knowledgeProjectId: source.knowledgeProjectId,
      requirementSetId: source.latestRequirementSetId,
      sourceType: source.sourceType,
      sourceRevision: source.revision,
      contentHash: source.contentHash,
      sourceLocatorHash: hash(source.source),
      blockCount: source.blocks.length,
      attachmentCount: source.attachments.length,
      warningCount: source.warnings.length,
      createdAt: now
    };
    const projectionManifest = this.buildManifest({
      trialId,
      knowledgeProjectId: source.knowledgeProjectId,
      systemId: input.systemId,
      operation: "start-trial",
      evidenceRefs: [`requirement-source:${source.id}`, `source-snapshot:${sourceSnapshot.id}`]
    });
    const trial: EvaluationTrial = {
      id: trialId,
      comparisonGroupId: required(input.comparisonGroupId, "Comparison group"),
      knowledgeProjectId: source.knowledgeProjectId,
      systemId: input.systemId,
      requirementSourceId: source.id,
      sourceSnapshotId: sourceSnapshot.id,
      sourceRevision: source.revision,
      sourceHash: source.contentHash,
      requirementSetId,
      provider: input.provider,
      workspacePath: resolve(required(input.workspacePath, "Workspace path")),
      storePath: resolve(required(input.storePath, "Store path")),
      codeRevision: required(input.codeRevision, "Code revision"),
      runtimeVersions: normalizedRecord(input.runtimeVersions),
      ...(executionScope
        ? { runtimeBuildIdentity: input.runtimeBuildIdentity ?? "unknown" }
        : input.runtimeBuildIdentity
          ? { runtimeBuildIdentity: input.runtimeBuildIdentity }
          : {}),
      ...(executionScope ? { executionScope: { ...executionScope, scopeHash: hash(stableStringify(executionScope)) } } : {}),
      latestProjectionManifestId: projectionManifest.id,
      status: "active",
      invalidationReasons: [],
      createdAt: now,
      updatedAt: now
    };
    this.repository.transaction(() => {
      this.repository.sourceSnapshots.push(sourceSnapshot);
      this.repository.projectionManifests.push(projectionManifest);
      this.repository.evaluationTrials.push(trial);
    });
    return { trial, sourceSnapshot, projectionManifest };
  }

  checkpointTrial(input: {
    trialId: string;
    previousProjectionManifestId: string;
    operation: string;
    evidenceRefs: string[];
  }) {
    const trial = this.activeTrial(input.trialId);
    if (trial.latestProjectionManifestId !== input.previousProjectionManifestId) {
      throw new Error("Evaluation projection checkpoint is stale");
    }
    if (input.evidenceRefs.length === 0) {
      throw new Error("Controlled projection checkpoints require evidence references");
    }
    const manifest = this.buildManifest({
      trialId: trial.id,
      previousManifestId: input.previousProjectionManifestId,
      operation: required(input.operation, "Checkpoint operation"),
      evidenceRefs: unique(input.evidenceRefs)
    });
    this.repository.transaction(() => {
      trial.latestProjectionManifestId = manifest.id;
      trial.updatedAt = manifest.createdAt;
      this.repository.projectionManifests.push(manifest);
      this.repository.interventionRecords.push({
        id: id("intervention"),
        trialId: trial.id,
        category: "controlled-facade-write",
        actor: "brain-creator",
        note: `Controlled checkpoint: ${manifest.operation}`,
        evidenceRefs: manifest.evidenceRefs,
        invalidatesTrial: false,
        createdAt: manifest.createdAt
      });
    });
    return manifest;
  }

  validateTrial(trialId: string, input: {
    codeRevision: string;
    runtimeVersions: Record<string, string>;
    runtimeBuildIdentity?: string;
  }, invalidate = true) {
    const trial = this.trial(trialId);
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    const manifest = this.repository.projectionManifests.find(
      (item) => item.id === trial.latestProjectionManifestId
    );
    const current = this.projection(trial.knowledgeProjectId, trial.systemId);
    const reasons = [
      ...this.executionScopeReasons(trial),
      ...(!source || source.revision !== trial.sourceRevision || source.contentHash !== trial.sourceHash
        ? ["Requirement source changed during the evaluation trial"] : []),
      ...(input.codeRevision !== trial.codeRevision
        ? ["Code revision changed during the evaluation trial"] : []),
      ...(!sameRecord(normalizedRecord(input.runtimeVersions), trial.runtimeVersions)
        ? ["Runtime versions changed during the evaluation trial"] : []),
      ...(trial.runtimeBuildIdentity && trial.runtimeBuildIdentity !== input.runtimeBuildIdentity
        ? ["Runtime build identity changed during the evaluation trial"] : []),
      ...(trial.executionScope && (!trial.runtimeBuildIdentity || trial.runtimeBuildIdentity === "unknown")
        ? ["Evaluation trial has no known pinned runtime build identity"] : []),
      ...(trial.executionScope && (!input.runtimeBuildIdentity || input.runtimeBuildIdentity === "unknown")
        ? ["Current runtime build identity is unknown"] : []),
      ...(!manifest || manifest.projectionHash !== current.hash
        ? ["Repository projection changed outside a controlled checkpoint"] : [])
    ];
    if (reasons.length > 0 && invalidate) {
      this.repository.transaction(() => this.invalidate(trial, reasons));
    }
    return { valid: reasons.length === 0 && trial.status !== "invalidated" && (!invalidate || trial.status === "active"), reasons, trial };
  }

  validateExecutionBinding(input: {
    trialId: string;
    knowledgeProjectId: string;
    systemId: string;
    executableCaseIds?: string[];
    requirementSetIds?: string[];
    runtimeBuildIdentity?: string;
  }) {
    const trial = this.trial(input.trialId);
    const reasons: string[] = this.executionScopeReasons(trial);
    if (!trial.executionScope?.businessScenarioIds.length || !trial.systemId) reasons.push("Execution binding requires a frozen scenario scope and system");
    if (trial.status !== "active") reasons.push(`Evaluation trial is not active: ${trial.status}`);
    if (trial.knowledgeProjectId !== input.knowledgeProjectId) reasons.push("Evaluation trial belongs to another knowledge project");
    if (trial.systemId && trial.systemId !== input.systemId) reasons.push("Evaluation trial belongs to another business system");
    if (!trial.systemId) {
      const project = this.repository.knowledgeProjects.find((item) => item.id === input.knowledgeProjectId);
      if (!project?.systemIds.includes(input.systemId)) reasons.push("Evaluation trial execution system is not bound to the knowledge project");
    }
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    if (!source || source.revision !== trial.sourceRevision || source.contentHash !== trial.sourceHash) {
      reasons.push("Requirement source changed during the evaluation trial");
    }
    if (trial.requirementSetId && source?.latestRequirementSetId !== trial.requirementSetId) {
      reasons.push("Requirement source requirement set changed during the evaluation trial");
    }
    if (trial.runtimeBuildIdentity && trial.runtimeBuildIdentity !== input.runtimeBuildIdentity) {
      reasons.push("Runtime build identity changed during the evaluation trial");
    }
    if (trial.executionScope && (!trial.runtimeBuildIdentity || trial.runtimeBuildIdentity === "unknown")) {
      reasons.push("Evaluation trial has no known pinned runtime build identity");
    }
    if (trial.executionScope && (!input.runtimeBuildIdentity || input.runtimeBuildIdentity === "unknown")) {
      reasons.push("Current runtime build identity is unknown");
    }
    if (trial.requirementSetId && input.requirementSetIds?.length &&
        (input.requirementSetIds.length !== 1 || input.requirementSetIds[0] !== trial.requirementSetId)) {
      reasons.push("Requirement suite does not use the trial requirement set");
    }
    const caseIds = unique(input.executableCaseIds ?? []);
    for (const caseId of caseIds) {
      const executableCase = this.repository.executableCases.find((item) => item.id === caseId);
      if (!executableCase || executableCase.knowledgeProjectId !== trial.knowledgeProjectId || executableCase.systemId && executableCase.systemId !== input.systemId) {
        reasons.push(`Executable case ${caseId} is outside the evaluation trial scope`);
        continue;
      }
      if (trial.requirementSetId && executableCase.requirementSetId !== trial.requirementSetId) {
        reasons.push(`Executable case ${caseId} is from another requirement set`);
      }
      const scenarioIds = this.scenarioIdsForCase(caseId);
      const frozenScenarioIds = trial.executionScope?.businessScenarioIds;
      if (frozenScenarioIds && scenarioIds.length !== 1) {
        reasons.push(`Executable case ${caseId} does not map to exactly one business scenario`);
      } else if (frozenScenarioIds && scenarioIds.some((scenarioId) => !frozenScenarioIds.includes(scenarioId))) {
        reasons.push(`Executable case ${caseId} is outside the frozen business scenario scope`);
      }
    }
    const driftReasons = reasons.filter((reason) => /source|requirement set changed|runtime build identity/i.test(reason));
    if (driftReasons.length > 0 && trial.status === "active") {
      this.repository.transaction(() => this.invalidate(trial, driftReasons));
    }
    return {
      valid: reasons.length === 0,
      comparable: Boolean(trial.executionScope),
      reasons,
      trial,
      scenarioIds: caseIds.flatMap((caseId) => this.scenarioIdsForCase(caseId))
    };
  }

  private executionScopeReasons(trial: EvaluationTrial): string[] {
    const scope = trial.executionScope;
    if (!scope) return [];
    const { scopeHash, ...frozen } = scope;
    const reasons: string[] = [];
    if (!scopeHash || scopeHash !== hash(stableStringify(frozen))) reasons.push("Frozen execution scope changed or is legacy");
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    const set = this.repository.requirementSets.find((item) => item.id === trial.requirementSetId);
    const project = this.repository.knowledgeProjects.find((item) => item.id === trial.knowledgeProjectId);
    if (!set || set.sourceId !== source?.id || set.knowledgeProjectId !== trial.knowledgeProjectId ||
        source?.knowledgeProjectId !== trial.knowledgeProjectId || source.latestRequirementSetId !== set.id ||
        !trial.systemId || !project?.systemIds.includes(trial.systemId)) return [...reasons, "Frozen source/project/system membership changed"];
    if (scope.baselineHash !== new RequirementGateService(this.repository).baselineFingerprint(set.id)) reasons.push("Frozen requirement baseline or scope version changed");
    if (scope.approvalScopeRef) {
      try {
        const receipt = new RequirementGateService(this.repository).verifyApprovalReceipt(set.id, scope.approvalScopeRef);
        if (set.status !== "approved" || receipt.assetHash !== scope.approvalScopeHash) reasons.push("Frozen approval changed");
      } catch { reasons.push("Frozen approval is no longer valid"); }
    }
    return reasons;
  }

  recordIntervention(input: {
    trialId: string;
    category: EvaluationInterventionCategory;
    actor: string;
    note: string;
    evidenceRefs: string[];
  }): InterventionRecord {
    const trial = this.trial(input.trialId);
    const invalidatesTrial = !["controlled-facade-write", "user-clarification"].includes(input.category);
    const record: InterventionRecord = {
      id: id("intervention"),
      trialId: trial.id,
      category: input.category,
      actor: required(input.actor, "Intervention actor"),
      note: required(input.note, "Intervention note"),
      evidenceRefs: unique(input.evidenceRefs),
      invalidatesTrial,
      createdAt: new Date().toISOString()
    };
    this.repository.transaction(() => {
      this.repository.interventionRecords.push(record);
      if (invalidatesTrial) this.invalidate(trial, [`${input.category}: ${record.note}`]);
    });
    return record;
  }

  completeTrial(
    trialId: string,
    codeRevision: string,
    runtimeVersions: Record<string, string>,
    runtimeBuildIdentity?: string
  ) {
    const validation = this.validateTrial(trialId, { codeRevision, runtimeVersions, runtimeBuildIdentity });
    if (!validation.valid) throw new Error(`Evaluation trial is not valid: ${validation.reasons.join("; ")}`);
    const now = new Date().toISOString();
    this.repository.transaction(() => {
      validation.trial.status = "completed";
      validation.trial.completedAt = now;
      validation.trial.updatedAt = now;
    });
    return validation.trial;
  }

  list(input: { knowledgeProjectId?: string; comparisonGroupId?: string } = {}) {
    return this.repository.evaluationTrials.filter((item) =>
      (!input.knowledgeProjectId || item.knowledgeProjectId === input.knowledgeProjectId) &&
      (!input.comparisonGroupId || item.comparisonGroupId === input.comparisonGroupId)
    );
  }

  private buildManifest(input: {
    trialId: string;
    knowledgeProjectId?: string;
    systemId?: string;
    previousManifestId?: string;
    operation: string;
    evidenceRefs: string[];
  }): ProjectionManifest {
    const trial = this.repository.evaluationTrials.find((item) => item.id === input.trialId);
    const knowledgeProjectId = trial?.knowledgeProjectId ?? input.knowledgeProjectId;
    if (!knowledgeProjectId) throw new Error("Evaluation projection requires a knowledge project");
    const projection = this.projection(knowledgeProjectId, trial?.systemId ?? input.systemId);
    return {
      id: id("projectionManifest"),
      trialId: input.trialId,
      previousManifestId: input.previousManifestId,
      operation: input.operation,
      projectionHash: projection.hash,
      assetCounts: projection.counts,
      evidenceRefs: unique(input.evidenceRefs),
      status: "current",
      createdAt: new Date().toISOString()
    };
  }

  private projection(knowledgeProjectId: string, systemId?: string) {
    const requirementSetIds = new Set(this.repository.requirementSets
      .filter((item) => item.knowledgeProjectId === knowledgeProjectId)
      .map((item) => item.id));
    const scenarioIds = new Set(this.repository.businessScenarios
      .filter((item) => item.knowledgeProjectId === knowledgeProjectId)
      .map((item) => item.id));
    const assets: Record<string, unknown[]> = {
      requirementSources: this.repository.requirementSources.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      requirementSets: this.repository.requirementSets.filter((item) => requirementSetIds.has(item.id)),
      attachmentAnalyses: this.repository.attachmentAnalyses.filter((item) => requirementSetIds.has(item.requirementSetId)),
      businessObjectModels: this.repository.businessObjectModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      workflowModels: this.repository.workflowModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      stateMachineModels: this.repository.stateMachineModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      decisionTableModels: this.repository.decisionTableModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
      knowledgeNodes: this.repository.knowledgeNodes.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      knowledgeEdges: this.repository.knowledgeEdges.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      testIntents: this.repository.testIntents.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      testDataProfiles: this.repository.testDataProfiles.filter((item) => item.knowledgeProjectId === knowledgeProjectId),
      executableCases: this.repository.executableCases.filter((item) => item.knowledgeProjectId === knowledgeProjectId && (!systemId || item.systemId === systemId)),
      businessScenarios: this.repository.businessScenarios.filter((item) => scenarioIds.has(item.id)),
      scenarioAssuranceContracts: this.repository.scenarioAssuranceContracts.filter((item) => scenarioIds.has(item.scenarioId)),
      semanticBindings: this.repository.semanticBindings.filter((item) => requirementSetIds.has(item.requirementSetId) && (!systemId || item.systemId === systemId))
    };
    const normalized = Object.fromEntries(Object.entries(assets).map(([key, values]) => [
      key,
      [...values].sort((left, right) => String((left as { id?: string }).id ?? "").localeCompare(String((right as { id?: string }).id ?? "")))
    ]));
    return {
      hash: hash(stableStringify(normalized)),
      counts: Object.fromEntries(Object.entries(assets).map(([key, values]) => [key, values.length]))
    };
  }

  private activeTrial(trialId: string) {
    const trial = this.trial(trialId);
    if (trial.status !== "active") throw new Error(`Evaluation trial is not active: ${trial.status}`);
    return trial;
  }

  private trial(trialId: string) {
    const trial = this.repository.evaluationTrials.find((item) => item.id === trialId);
    if (!trial) throw new Error("Evaluation trial not found");
    return trial;
  }

  private scenarioIdsForCase(executableCaseId: string) {
    const executableCase = this.repository.executableCases.find((item) => item.id === executableCaseId);
    if (!executableCase) return [];
    return this.repository.businessScenarios
      .filter((scenario) => scenario.knowledgeProjectId === executableCase.knowledgeProjectId &&
        scenario.requirementSetId === executableCase.requirementSetId &&
        (scenario.testIntentIds ?? []).includes(executableCase.testIntentId))
      .map((scenario) => scenario.id);
  }

  private invalidate(trial: EvaluationTrial, reasons: string[]) {
    trial.status = "invalidated";
    trial.invalidationReasons = unique([...trial.invalidationReasons, ...reasons]);
    trial.updatedAt = new Date().toISOString();
    const manifest = this.repository.projectionManifests.find((item) => item.id === trial.latestProjectionManifestId);
    if (manifest) manifest.status = "drifted";
  }
}

function normalizedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function sameRecord(left: Record<string, string>, right: Record<string, string>) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left: string, right: string) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
