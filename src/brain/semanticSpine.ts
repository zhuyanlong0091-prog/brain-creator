import { createHash } from "node:crypto";
import { id } from "../shared/id.js";
import type {
  BusinessEntityInstance,
  SemanticAlias,
  SemanticConcept,
  SemanticConceptKind,
  SemanticRelation,
  SemanticAssetStatus
} from "./types.js";

export type SemanticSpineStore = {
  semanticConcepts: SemanticConcept[];
  semanticAliases: SemanticAlias[];
  semanticRelations: SemanticRelation[];
  businessEntityInstances: BusinessEntityInstance[];
  persist(): void;
};

export type UpsertSemanticConceptInput = {
  identityKey: string;
  kind: SemanticConceptKind;
  canonicalName: string;
  aliases?: string[];
  scope?: string;
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSetId?: string;
  sourceRefs?: string[];
  confidence?: number;
  status?: SemanticAssetStatus;
};

export class SemanticSpineService {
  constructor(private readonly store: SemanticSpineStore) {}

  upsertConcept(input: UpsertSemanticConceptInput): SemanticConcept {
    const now = new Date().toISOString();
    const existing = this.store.semanticConcepts.find(
      (concept) =>
        concept.identityKey === input.identityKey &&
        concept.knowledgeProjectId === input.knowledgeProjectId &&
        concept.systemId === input.systemId &&
        concept.requirementSetId === input.requirementSetId
    );
    const concept = existing ?? {
      id: semanticId(input),
      identityKey: input.identityKey,
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      requirementSetId: input.requirementSetId,
      kind: input.kind,
      canonicalName: input.canonicalName.trim(),
      aliases: [],
      scope: input.scope?.trim(),
      sourceRefs: [],
      confidence: 0,
      status: "draft" as const,
      createdAt: now,
      updatedAt: now
    };
    concept.kind = input.kind;
    concept.canonicalName = input.canonicalName.trim();
    concept.scope = input.scope?.trim() || concept.scope;
    concept.aliases = unique([...concept.aliases, ...(input.aliases ?? [])].map((value) => value.trim()).filter(Boolean));
    concept.sourceRefs = unique([...concept.sourceRefs, ...(input.sourceRefs ?? [])]);
    concept.confidence = clampConfidence(input.confidence ?? concept.confidence);
    concept.status = input.status ?? concept.status;
    concept.updatedAt = now;
    if (!existing) this.store.semanticConcepts.push(concept);
    for (const alias of concept.aliases) {
      this.upsertAlias(concept.id, alias, input.sourceRefs ?? [], input.confidence ?? concept.confidence, concept.status);
    }
    this.store.persist();
    return concept;
  }

  upsertAlias(
    conceptId: string,
    alias: string,
    sourceRefs: string[] = [],
    confidence = 0.8,
    status: SemanticAssetStatus = "draft"
  ): SemanticAlias {
    const normalizedAlias = normalizeSemanticTerm(alias);
    if (!normalizedAlias) throw new Error("Semantic alias cannot be empty");
    const now = new Date().toISOString();
    const existing = this.store.semanticAliases.find(
      (item) => item.conceptId === conceptId && item.normalizedAlias === normalizedAlias
    );
    const semanticAlias = existing ?? {
      id: id("semanticAlias"),
      conceptId,
      alias: alias.trim(),
      normalizedAlias,
      sourceRefs: [],
      confidence: clampConfidence(confidence),
      status,
      createdAt: now,
      updatedAt: now
    };
    semanticAlias.alias = alias.trim();
    semanticAlias.sourceRefs = unique([...semanticAlias.sourceRefs, ...sourceRefs]);
    semanticAlias.confidence = clampConfidence(confidence);
    semanticAlias.status = status;
    semanticAlias.updatedAt = now;
    if (!existing) this.store.semanticAliases.push(semanticAlias);
    const concept = this.store.semanticConcepts.find((item) => item.id === conceptId);
    if (concept && !concept.aliases.includes(alias.trim())) concept.aliases.push(alias.trim());
    this.store.persist();
    return semanticAlias;
  }

  linkConcepts(input: {
    fromConceptId: string;
    toConceptId: string;
    relation: string;
    sourceRefs?: string[];
    confidence?: number;
    status?: SemanticAssetStatus;
  }): SemanticRelation {
    const existing = this.store.semanticRelations.find(
      (item) =>
        item.fromConceptId === input.fromConceptId &&
        item.toConceptId === input.toConceptId &&
        item.relation === input.relation
    );
    const now = new Date().toISOString();
    const relation = existing ?? {
      id: id("semanticRelation"),
      fromConceptId: input.fromConceptId,
      toConceptId: input.toConceptId,
      relation: input.relation,
      sourceRefs: [],
      confidence: 0,
      status: "draft" as const,
      createdAt: now,
      updatedAt: now
    };
    relation.sourceRefs = unique([...relation.sourceRefs, ...(input.sourceRefs ?? [])]);
    relation.confidence = clampConfidence(input.confidence ?? relation.confidence);
    relation.status = input.status ?? relation.status;
    relation.updatedAt = now;
    if (!existing) this.store.semanticRelations.push(relation);
    this.store.persist();
    return relation;
  }

  resolve(query: string, scope: { knowledgeProjectId?: string; systemId?: string } = {}) {
    const normalized = normalizeSemanticTerm(query);
    const candidates = this.store.semanticConcepts.filter(
      (concept) =>
        matchesScope(concept, scope) &&
        matchesConceptQuery(concept, normalized)
    );
    if (candidates.length === 1) return candidates[0];
    const aliases = this.store.semanticAliases.filter(
      (alias) => alias.normalizedAlias === normalized
    );
    const aliasConcepts = aliases
      .map((alias) => this.store.semanticConcepts.find((concept) => concept.id === alias.conceptId))
      .filter((concept): concept is SemanticConcept => Boolean(concept))
      .filter((concept) => matchesScope(concept, scope) && matchesConceptQuery(concept, normalized));
    return aliasConcepts.length === 1 ? aliasConcepts[0] : undefined;
  }

  linkRequirementActionsToSystem(input: {
    knowledgeProjectId: string;
    systemId: string;
  }) {
    const requirementActions = this.store.semanticConcepts.filter(
      (concept) =>
        concept.kind === "action" &&
        concept.knowledgeProjectId === input.knowledgeProjectId &&
        concept.systemId === undefined
    );
    const systemActions = this.store.semanticConcepts.filter(
      (concept) =>
        concept.kind === "action" &&
        concept.knowledgeProjectId === input.knowledgeProjectId &&
        concept.systemId === input.systemId
    );
    const relations: SemanticRelation[] = [];
    for (const requirementAction of requirementActions) {
      const candidates = systemActions.filter((systemAction) =>
        equivalentActionConcepts(requirementAction, systemAction)
      );
      if (candidates.length !== 1) continue;
      const systemAction = candidates[0];
      relations.push(this.linkConcepts({
        fromConceptId: requirementAction.id,
        toConceptId: systemAction.id,
        relation: "maps-to-system-action",
        sourceRefs: unique([...requirementAction.sourceRefs, ...systemAction.sourceRefs]),
        confidence: Math.min(requirementAction.confidence, systemAction.confidence),
        status: requirementAction.status === "confirmed" && systemAction.status === "confirmed"
          ? "confirmed"
          : "draft"
      }));
    }
    return relations;
  }

  confirmRequirementActions(requirementSetId: string) {
    const now = new Date().toISOString();
    const concepts = this.store.semanticConcepts.filter(
      (concept) => concept.kind === "action" && concept.requirementSetId === requirementSetId
    );
    for (const concept of concepts) {
      concept.status = "confirmed";
      concept.updatedAt = now;
      for (const alias of this.store.semanticAliases.filter((item) => item.conceptId === concept.id)) {
        alias.status = "confirmed";
        alias.updatedAt = now;
      }
    }
    if (concepts.length > 0) this.store.persist();
    return concepts;
  }

  upsertEntity(input: {
    entityKey: string;
    semanticConceptId: string;
    values: BusinessEntityInstance["values"];
    knowledgeProjectId?: string;
    systemId?: string;
    sourceRefs?: string[];
  }): BusinessEntityInstance {
    const now = new Date().toISOString();
    const existing = this.store.businessEntityInstances.find(
      (entity) =>
        entity.entityKey === input.entityKey &&
        entity.knowledgeProjectId === input.knowledgeProjectId &&
        entity.systemId === input.systemId
    );
    const entity = existing ?? {
      id: stableEntityId(input),
      entityKey: input.entityKey,
      semanticConceptId: input.semanticConceptId,
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      values: {},
      status: "active" as const,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now
    };
    entity.semanticConceptId = input.semanticConceptId;
    entity.values = { ...entity.values, ...input.values };
    entity.sourceRefs = unique([...entity.sourceRefs, ...(input.sourceRefs ?? [])]);
    entity.status = "active";
    entity.updatedAt = now;
    if (!existing) this.store.businessEntityInstances.push(entity);
    this.store.persist();
    return entity;
  }
}

export function normalizeSemanticTerm(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\-_./:：，,。；;()[\]{}]+/gu, "");
}

export function canonicalSemanticAction(value: string) {
  return canonicalActionTerm(value);
}

export function extractSemanticActionTerms(value: string) {
  const matches = value.match(/新增|新建|创建|添加|建立|编辑|修改|更新|删除|移除|查询|搜索|查找|提交|保存|审批|通过|拒绝|驳回|关闭|create|add|edit|update|delete|search|submit|save|approve|reject|close/giu) ?? [];
  return unique(matches);
}

function matchesConceptQuery(concept: SemanticConcept, normalizedQuery: string) {
  const values = [concept.canonicalName, ...concept.aliases];
  return values.some((value) => {
    const normalized = normalizeSemanticTerm(value);
    if (normalized === normalizedQuery) return true;
    return concept.kind === "action" && canonicalActionTerm(value) === canonicalActionTerm(normalizedQuery);
  });
}

function equivalentActionConcepts(left: SemanticConcept, right: SemanticConcept) {
  const leftValues = [left.canonicalName, ...left.aliases];
  const rightValues = [right.canonicalName, ...right.aliases];
  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => canonicalActionTerm(leftValue) === canonicalActionTerm(rightValue))
  );
}

function canonicalActionTerm(value: string) {
  const normalized = normalizeSemanticTerm(value);
  const replacements: Array<[string, string]> = [
    ["新增", "create"],
    ["新建", "create"],
    ["创建", "create"],
    ["添加", "create"],
    ["建立", "create"],
    ["编辑", "edit"],
    ["修改", "edit"],
    ["更新", "edit"],
    ["删除", "delete"],
    ["移除", "delete"],
    ["提交", "submit"],
    ["保存", "save"],
    ["审批", "approve"],
    ["通过", "approve"],
    ["拒绝", "reject"],
    ["驳回", "reject"],
    ["关闭", "close"]
  ];
  return replacements.reduce(
    (result, [source, target]) => result.replaceAll(source, target),
    normalized
  );
}

function semanticId(input: Pick<UpsertSemanticConceptInput, "identityKey" | "kind" | "knowledgeProjectId" | "systemId" | "requirementSetId">) {
  const scope = [input.knowledgeProjectId, input.systemId, input.requirementSetId].filter(Boolean).join(":");
  const hash = createHash("sha256")
    .update(`${scope}:${input.kind}:${input.identityKey}`)
    .digest("hex")
    .slice(0, 16);
  return `semantic_${hash}`;
}

function stableEntityId(input: Pick<BusinessEntityInstance, "entityKey" | "knowledgeProjectId" | "systemId">) {
  const hash = createHash("sha256")
    .update(`${input.knowledgeProjectId ?? ""}:${input.systemId ?? ""}:${input.entityKey}`)
    .digest("hex")
    .slice(0, 16);
  return `entity_${hash}`;
}

function matchesScope(
  concept: SemanticConcept,
  scope: { knowledgeProjectId?: string; systemId?: string }
) {
  return (
    (scope.knowledgeProjectId === undefined || concept.knowledgeProjectId === scope.knowledgeProjectId) &&
    (scope.systemId === undefined || concept.systemId === scope.systemId)
  );
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, value));
}

function unique(values: string[]) {
  return [...new Set(values)];
}
