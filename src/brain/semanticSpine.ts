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
        (normalizeSemanticTerm(concept.canonicalName) === normalized ||
          concept.aliases.some((alias) => normalizeSemanticTerm(alias) === normalized))
    );
    if (candidates.length === 1) return candidates[0];
    const aliases = this.store.semanticAliases.filter(
      (alias) => alias.normalizedAlias === normalized
    );
    const aliasConcepts = aliases
      .map((alias) => this.store.semanticConcepts.find((concept) => concept.id === alias.conceptId))
      .filter((concept): concept is SemanticConcept => Boolean(concept))
      .filter((concept) => matchesScope(concept, scope));
    return aliasConcepts.length === 1 ? aliasConcepts[0] : undefined;
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
