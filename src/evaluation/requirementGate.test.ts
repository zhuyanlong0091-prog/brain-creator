// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { RequirementSet, RequirementSource } from "../domain/types.js";
import { RequirementGateService } from "./requirementGate.js";

describe("RequirementGateService", () => {
  it("records producer, validator, critic, and adjudicator evaluations and stales changed inputs", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);

    gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "document-mapper",
      evaluator: "producer",
      inputHashes: ["source-v1"],
      supportRefs: ["source:orders#line:1"],
      verdict: "pass",
      policyVersion: "requirement-v2"
    });
    gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "document-mapper",
      evaluator: "schema-validator",
      inputHashes: ["source-v1"],
      supportRefs: ["source:orders#line:1"],
      verdict: "pass",
      policyVersion: "requirement-v2"
    });
    gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "coverage-critic",
      evaluator: "isolated-critic",
      inputHashes: ["source-v1"],
      supportRefs: ["source:orders#line:1"],
      verdict: "pass",
      policyVersion: "requirement-v2"
    });
    const first = gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "adjudicator",
      evaluator: "adjudicator",
      inputHashes: ["source-v1", "models-v1"],
      supportRefs: ["source:orders#line:1"],
      verdict: "pass",
      policyVersion: "requirement-v2"
    });

    expect(gate.list({ requirementSetId: fixture.requirementSet.id }).every((item) => item.status === "current")).toBe(true);

    const second = gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "adjudicator",
      evaluator: "adjudicator",
      inputHashes: ["source-v2", "models-v2"],
      supportRefs: ["source:orders#line:1"],
      verdict: "needs-review",
      reasons: ["Source changed"],
      policyVersion: "requirement-v2"
    });

    expect(gate.list({ requirementSetId: fixture.requirementSet.id }).find((item) => item.id === first.id)?.status).toBe("stale");
    expect(second.status).toBe("current");
    expect(gate.list({ requirementSetId: fixture.requirementSet.id, status: "stale" })).toEqual([
      expect.objectContaining({ id: first.id, stage: "adjudicator", status: "stale" })
    ]);
  });

  it("requires a current baseline fingerprint and a one-time challenge response", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);
    const fingerprint = gate.baselineFingerprint(fixture.requirementSet.id);
    const challenge = gate.issueApprovalChallenge(fixture.requirementSet.id);

    expect(challenge.assetHash).toBe(fingerprint);
    expect(() => gate.createApprovalReceipt({
      requirementSetId: fixture.requirementSet.id,
      assetHash: fingerprint,
      method: "challenge-response",
      approvedBy: "tester",
      challengeId: challenge.challengeId,
      approvalCode: "wrong-code"
    })).toThrow("Approval challenge is invalid");

    const receipt = gate.createApprovalReceipt({
      requirementSetId: fixture.requirementSet.id,
      assetHash: fingerprint,
      method: "challenge-response",
      approvedBy: "tester",
      challengeId: challenge.challengeId,
      approvalCode: challenge.code
    });
    expect(receipt.assetHash).toBe(fingerprint);
    expect(gate.verifyApprovalReceipt(fixture.requirementSet.id, receipt.id).id).toBe(receipt.id);
    expect(() => gate.createApprovalReceipt({
      requirementSetId: fixture.requirementSet.id,
      assetHash: fingerprint,
      method: "challenge-response",
      approvedBy: "tester",
      challengeId: challenge.challengeId,
      approvalCode: challenge.code
    })).toThrow("Approval challenge is invalid");
  });

  it("rejects host-attested receipts without host proof and detects a changed baseline", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);
    const fingerprint = gate.baselineFingerprint(fixture.requirementSet.id);

    expect(() => gate.createApprovalReceipt({
      requirementSetId: fixture.requirementSet.id,
      assetHash: fingerprint,
      method: "host-attested",
      approvedBy: "agent",
      hostMessageId: "message-1"
    })).toThrow("Host approval proof is required");

    const receipt = gate.createApprovalReceipt({
      requirementSetId: fixture.requirementSet.id,
      assetHash: fingerprint,
      method: "host-attested",
      approvedBy: "user",
      hostMessageId: "message-1",
      hostMessageHash: "a".repeat(64)
    });
    fixture.requirementSet.summary = "Changed after approval preview";
    expect(() => gate.verifyApprovalReceipt(fixture.requirementSet.id, receipt.id)).toThrow(
      "Approval receipt does not match the current requirement baseline"
    );
  });

  it("keeps a receipt valid when approval changes lifecycle status only", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);
    const fingerprint = gate.baselineFingerprint(fixture.requirementSet.id);
    fixture.requirementSet.status = "approved";
    fixture.requirementSet.approvedAt = "2026-09-02T00:01:00.000Z";
    expect(gate.baselineFingerprint(fixture.requirementSet.id)).toBe(fingerprint);
  });

  it("stales current stage evaluations when the source hash changes", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);
    gate.recordStageEvaluation({
      requirementSetId: fixture.requirementSet.id,
      stage: "document-mapper",
      evaluator: "producer",
      inputHashes: ["source-v1"],
      supportRefs: ["source:orders#line:1"],
      verdict: "pass",
      policyVersion: "requirement-v2"
    });
    fixture.repository.requirementSources[0].contentHash = "source-v2";
    gate.baselineFingerprint(fixture.requirementSet.id);
    expect(gate.list({ requirementSetId: fixture.requirementSet.id, status: "stale" })).toEqual([
      expect.objectContaining({ stage: "document-mapper", status: "stale" })
    ]);
  });

  it("keeps only the latest evaluation current for one stage and evaluator", () => {
    const fixture = createFixture();
    const gate = new RequirementGateService(fixture.repository);
    const base = {
      requirementSetId: fixture.requirementSet.id,
      stage: "document-mapper",
      evaluator: "schema-validator",
      inputHashes: ["source-v1"],
      supportRefs: [],
      policyVersion: "requirement-v2"
    } as const;
    gate.recordStageEvaluation({ ...base, verdict: "retry", reasons: ["Invalid shape"] });
    gate.recordStageEvaluation({ ...base, verdict: "pass" });
    expect(gate.list({ requirementSetId: fixture.requirementSet.id, status: "current" })).toEqual([
      expect.objectContaining({ evaluator: "schema-validator", verdict: "pass" })
    ]);
    expect(gate.list({ requirementSetId: fixture.requirementSet.id, status: "stale" })).toEqual([
      expect.objectContaining({ evaluator: "schema-validator", verdict: "retry" })
    ]);
  });
});

function createFixture() {
  const repository = new InMemoryBrainCreatorRepository();
  const now = "2026-09-02T00:00:00.000Z";
  repository.knowledgeProjects.push({
    id: "project-orders",
    key: "orders",
    name: "Orders",
    defaultLocale: "en-US",
    status: "active",
    systemIds: [],
    createdAt: now,
    updatedAt: now
  });
  const source: RequirementSource = {
    id: "source-orders",
    knowledgeProjectId: "project-orders",
    source: "orders.md",
    sourceType: "local-file",
    title: "Order approval",
    contentHash: "source-v1",
    content: "A requester creates an order.",
    blocks: [{ type: "paragraph", text: "A requester creates an order.", sourceRefs: ["source:orders#line:1"] }],
    attachments: [],
    warnings: [],
    accessStatus: "available",
    revision: 1,
    latestRequirementSetId: "requirement-orders",
    createdAt: now,
    updatedAt: now
  };
  const requirementSet: RequirementSet = {
    id: "requirement-orders",
    knowledgeProjectId: "project-orders",
    sourceId: source.id,
    version: 1,
    title: source.title,
    summary: "Order approval",
    contentHash: source.contentHash,
    status: "draft",
    affectedNodeIds: [],
    createdAt: now,
    updatedAt: now
  };
  repository.requirementSources.push(source);
  repository.requirementSets.push(requirementSet);
  return { repository, requirementSet };
}
