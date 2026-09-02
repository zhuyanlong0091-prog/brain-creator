import { createHash, randomInt } from "node:crypto";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BrainEvalResult, ApprovalReceipt, StageEvalRecord } from "../brain/types.js";
import { id } from "../shared/id.js";

type StageEvaluationInput = {
  requirementSetId: string;
  trialId?: string;
  stage: string;
  evaluator: string;
  inputHashes: string[];
  supportRefs: string[];
  counterEvidenceRefs?: string[];
  openQuestions?: string[];
  verdict: BrainEvalResult["verdict"];
  reasons?: string[];
  requiredActions?: string[];
  policyVersion: string;
};

type ApprovalChallenge = {
  requirementSetId: string;
  assetHash: string;
  codeHash: string;
  expiresAt: string;
};

type ApprovalInput = {
  requirementSetId: string;
  assetHash: string;
  method: ApprovalReceipt["method"];
  approvedBy: string;
  hostMessageId?: string;
  hostMessageHash?: string;
  challengeId?: string;
  approvalCode?: string;
};

export class RequirementGateService {
  private readonly challenges = new Map<string, ApprovalChallenge>();

  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  recordStageEvaluation(input: StageEvaluationInput): StageEvalRecord {
    const requirementSet = this.requirementSet(input.requirementSetId);
    const subjectRefs = [`requirement-set:${requirementSet.id}`, `stage:${input.stage}`];
    const current = this.repository.stageEvalRecords.filter(
      (record) => record.status === "current" &&
        record.subjectRefs.includes(`requirement-set:${requirementSet.id}`) &&
        record.stage === input.stage &&
        record.evaluator === input.evaluator
    );
    this.repository.transaction(() => {
      for (const record of current) {
        record.status = "stale";
        record.staleAt = new Date().toISOString();
      }
    });
    const record: StageEvalRecord = {
      id: id("stage-eval"),
      trialId: input.trialId,
      stage: input.stage,
      subjectRefs,
      inputHashes: unique(input.inputHashes),
      supportRefs: unique(input.supportRefs),
      counterEvidenceRefs: unique(input.counterEvidenceRefs ?? []),
      openQuestions: unique(input.openQuestions ?? []),
      verdict: input.verdict,
      reasons: unique(input.reasons ?? []),
      requiredActions: unique(input.requiredActions ?? []),
      evaluator: input.evaluator,
      policyVersion: input.policyVersion,
      status: "current",
      createdAt: new Date().toISOString()
    };
    this.repository.stageEvalRecords.push(record);
    this.repository.persist();
    return record;
  }

  list(input: {
    requirementSetId?: string;
    stage?: string;
    evaluator?: string;
    status?: StageEvalRecord["status"];
  } = {}): StageEvalRecord[] {
    return this.repository.stageEvalRecords.filter((record) => {
      const matchesRequirement = !input.requirementSetId ||
        record.subjectRefs.includes(`requirement-set:${input.requirementSetId}`);
      return matchesRequirement &&
        (!input.stage || record.stage === input.stage) &&
        (!input.evaluator || record.evaluator === input.evaluator) &&
        (!input.status || record.status === input.status);
    });
  }

  baselineFingerprint(requirementSetId: string) {
    const requirementSet = this.requirementSet(requirementSetId);
    const source = this.repository.requirementSources.find((item) => item.id === requirementSet.sourceId);
    if (!source) throw new Error("Requirement source not found");
    const fingerprint = sha256(canonicalJson({
      requirementSet: {
        id: requirementSet.id,
        knowledgeProjectId: requirementSet.knowledgeProjectId,
        sourceId: requirementSet.sourceId,
        version: requirementSet.version,
        title: requirementSet.title,
        summary: requirementSet.summary,
        contentHash: requirementSet.contentHash,
        affectedNodeIds: requirementSet.affectedNodeIds
      },
      source: {
        id: source.id,
        sourceType: source.sourceType,
        title: source.title,
        contentHash: source.contentHash,
        content: source.content,
        blocks: source.blocks,
        attachments: source.attachments,
        warnings: source.warnings,
        accessStatus: source.accessStatus,
        revision: source.revision
      },
      nodes: this.repository.knowledgeNodes.filter((item) => item.requirementSetId === requirementSetId),
      edges: this.repository.knowledgeEdges.filter((item) => item.knowledgeProjectId === requirementSet.knowledgeProjectId),
      workflows: this.repository.workflowModels.filter((item) => item.requirementSetId === requirementSetId),
      stateMachines: this.repository.stateMachineModels.filter((item) => item.requirementSetId === requirementSetId),
      businessObjects: this.repository.businessObjectModels.filter((item) => item.requirementSetId === requirementSetId),
      decisionTables: this.repository.decisionTableModels.filter((item) => item.requirementSetId === requirementSetId),
      testIntents: this.repository.testIntents.filter((item) => item.requirementSetId === requirementSetId),
      scenarios: this.repository.businessScenarios.filter((item) => item.requirementSetId === requirementSetId)
    }));
    const sourceHash = source.contentHash;
    let changed = false;
    for (const record of this.list({ requirementSetId, status: "current" })) {
      if (record.inputHashes[0] !== sourceHash) {
        record.status = "stale";
        record.staleAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.repository.persist();
    return fingerprint;
  }

  issueApprovalChallenge(requirementSetId: string, ttlMs = 10 * 60 * 1000) {
    const assetHash = this.baselineFingerprint(requirementSetId);
    const challengeId = id("approval-challenge");
    const code = `BC-${randomInt(100000, 1000000)}`;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.challenges.set(challengeId, {
      requirementSetId,
      assetHash,
      codeHash: sha256(code),
      expiresAt
    });
    return { challengeId, code, assetHash, expiresAt };
  }

  createApprovalReceipt(input: ApprovalInput): ApprovalReceipt {
    const expectedHash = this.baselineFingerprint(input.requirementSetId);
    if (input.assetHash !== expectedHash) {
      throw new Error("Approval receipt does not match the current requirement baseline");
    }
    if (!input.approvedBy?.trim()) throw new Error("Approval actor is required");
    if (input.method === "host-attested") {
      if (!input.hostMessageId || !input.hostMessageHash || !/^[a-f0-9]{64}$/iu.test(input.hostMessageHash)) {
        throw new Error("Host approval proof is required");
      }
    } else {
      const challenge = input.challengeId ? this.challenges.get(input.challengeId) : undefined;
      if (!challenge || challenge.requirementSetId !== input.requirementSetId ||
        challenge.assetHash !== expectedHash || new Date(challenge.expiresAt).getTime() <= Date.now() ||
        !input.approvalCode || sha256(input.approvalCode) !== challenge.codeHash) {
        throw new Error("Approval challenge is invalid");
      }
      this.challenges.delete(input.challengeId!);
    }
    const receipt: ApprovalReceipt = {
      id: id("approval"),
      assetRefs: [`requirement-set:${input.requirementSetId}`],
      assetHash: expectedHash,
      method: input.method,
      approvedBy: input.approvedBy.trim(),
      hostMessageId: input.hostMessageId,
      hostMessageHash: input.hostMessageHash,
      challengeHash: input.method === "challenge-response" && input.approvalCode
        ? sha256(input.approvalCode)
        : undefined,
      createdAt: new Date().toISOString()
    };
    this.repository.approvalReceipts.push(receipt);
    this.repository.persist();
    return receipt;
  }

  verifyApprovalReceipt(requirementSetId: string, receiptId: string) {
    const receipt = this.repository.approvalReceipts.find((item) => item.id === receiptId);
    if (!receipt || !receipt.assetRefs.includes(`requirement-set:${requirementSetId}`)) {
      throw new Error("Approval receipt not found");
    }
    if (receipt.assetHash !== this.baselineFingerprint(requirementSetId)) {
      throw new Error("Approval receipt does not match the current requirement baseline");
    }
    return receipt;
  }

  adjudicateBaseline(input: {
    requirementSetId: string;
    provider: "host-agent" | "host-skill";
    evaluation: BrainEvalResult;
    supportRefs: string[];
    inputHashes: string[];
    policyVersion: string;
  }) {
    const requiredStages = [
      "document-mapper",
      "clause-analyst",
      "business-modeler",
      "coverage-critic"
    ];
    const current = this.list({ requirementSetId: input.requirementSetId, status: "current" });
    const failures = requiredStages.flatMap((stage) => {
      const producer = current.find((record) => record.stage === stage && record.evaluator === "producer");
      const validator = current.find((record) => record.stage === stage && record.evaluator === "schema-validator");
      const critic = stage === "coverage-critic"
        ? current.find((record) => record.stage === stage && record.evaluator === "isolated-critic")
        : undefined;
      const records = [producer, validator, critic].filter(Boolean) as StageEvalRecord[];
      const missing = [
        !producer && `${stage} producer`,
        !validator && `${stage} schema-validator`,
        stage === "coverage-critic" && !critic && `${stage} isolated-critic`
      ].filter(Boolean) as string[];
      return [
        ...missing.map((name) => `Missing current stage evaluation: ${name}`),
        ...records
          .filter((record) => record.verdict !== "pass")
          .flatMap((record) => record.reasons.length > 0
            ? record.reasons.map((reason) => `${record.stage} ${record.evaluator}: ${reason}`)
            : [`${record.stage} ${record.evaluator} returned ${record.verdict}`])
      ];
    });
    const verdict: BrainEvalResult["verdict"] = failures.length > 0
      ? current.some((record) => record.verdict === "blocked")
        ? "blocked"
        : "needs-review"
      : input.evaluation.verdict;
    const evaluation: BrainEvalResult = {
      ...input.evaluation,
      verdict,
      reasons: unique([...input.evaluation.reasons, ...failures]),
      nextActions: unique([
        ...input.evaluation.nextActions,
        ...(failures.length > 0 ? ["Review the failing or missing Requirement Harness stage evaluations"] : [])
      ])
    };
    const record = this.recordStageEvaluation({
      requirementSetId: input.requirementSetId,
      stage: "adjudicator",
      evaluator: "adjudicator",
      inputHashes: input.inputHashes,
      supportRefs: input.supportRefs,
      verdict: evaluation.verdict,
      reasons: evaluation.reasons,
      requiredActions: evaluation.nextActions,
      policyVersion: input.policyVersion
    });
    return { evaluation, record, stageEvaluations: this.list({ requirementSetId: input.requirementSetId }) };
  }

  private requirementSet(requirementSetId: string) {
    const requirementSet = this.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!requirementSet) throw new Error("Requirement set not found");
    return requirementSet;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => entry !== undefined && !VOLATILE_BASELINE_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

const VOLATILE_BASELINE_KEYS = new Set([
  "status",
  "createdAt",
  "updatedAt",
  "approvedAt",
  "confirmedAt",
  "approvalReceiptId",
  "baselineFingerprint",
  "evaluationStageIds"
]);

function unique(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
