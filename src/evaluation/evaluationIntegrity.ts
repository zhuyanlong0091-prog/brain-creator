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
};

export class EvaluationIntegrityService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  startTrial(input: StartEvaluationTrialInput) {
    const source = this.repository.requirementSources.find(
      (item) => item.id === input.requirementSourceId && item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!source) throw new Error("Requirement source not found for the evaluation trial");
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
      provider: input.provider,
      workspacePath: resolve(required(input.workspacePath, "Workspace path")),
      storePath: resolve(required(input.storePath, "Store path")),
      codeRevision: required(input.codeRevision, "Code revision"),
      runtimeVersions: normalizedRecord(input.runtimeVersions),
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
  }) {
    const trial = this.trial(trialId);
    const source = this.repository.requirementSources.find((item) => item.id === trial.requirementSourceId);
    const manifest = this.repository.projectionManifests.find(
      (item) => item.id === trial.latestProjectionManifestId
    );
    const current = this.projection(trial.knowledgeProjectId, trial.systemId);
    const reasons = [
      ...(!source || source.revision !== trial.sourceRevision || source.contentHash !== trial.sourceHash
        ? ["Requirement source changed during the evaluation trial"] : []),
      ...(input.codeRevision !== trial.codeRevision
        ? ["Code revision changed during the evaluation trial"] : []),
      ...(!sameRecord(normalizedRecord(input.runtimeVersions), trial.runtimeVersions)
        ? ["Runtime versions changed during the evaluation trial"] : []),
      ...(!manifest || manifest.projectionHash !== current.hash
        ? ["Repository projection changed outside a controlled checkpoint"] : [])
    ];
    if (reasons.length > 0) {
      this.repository.transaction(() => this.invalidate(trial, reasons));
    }
    return { valid: reasons.length === 0 && trial.status === "active", reasons, trial };
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
    runtimeVersions: Record<string, string>
  ) {
    const validation = this.validateTrial(trialId, { codeRevision, runtimeVersions });
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
