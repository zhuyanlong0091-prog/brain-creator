import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BusinessEntityInstance, TestDataDependency } from "./types.js";
import { id } from "../shared/id.js";

export type TestDataProviderRequest = {
  systemId: string;
  knowledgeProjectId?: string;
  entityType?: string;
  key?: string;
  reference?: string;
  entityReference?: string;
  values?: Record<string, string | number | boolean | null>;
  transition?: string;
  expected?: Record<string, string | number | boolean | null>;
  sourceRefs: string[];
};

export type TestDataProviderResult = {
  status: "found" | "created" | "transitioned" | "verified" | "cleaned";
  reference: string;
  entityReference?: string;
  values?: Record<string, string | number | boolean | null>;
  sourceRefs: string[];
  entityId?: string;
};

export interface TestDataProvider {
  readonly name: string;
  supports(input: TestDataProviderRequest): boolean;
  lookup(input: TestDataProviderRequest): Promise<TestDataProviderResult | undefined>;
  create(input: TestDataProviderRequest): Promise<TestDataProviderResult>;
  transition(input: TestDataProviderRequest): Promise<TestDataProviderResult>;
  verify(input: TestDataProviderRequest): Promise<TestDataProviderResult>;
  cleanup(input: TestDataProviderRequest): Promise<TestDataProviderResult>;
}

export class TestDataBrainService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly providers: TestDataProvider[]
  ) {}

  graph(systemId: string) {
    const entities = this.repository.businessEntityInstances.filter((item) => item.systemId === systemId);
    const references = new Set(entities.map((item) => item.entityKey));
    return {
      entities,
      dependencies: this.repository.testDataDependencies.filter(
        (item) => item.systemId === systemId && references.has(item.fromReference) && references.has(item.toReference)
      )
    };
  }

  async lookup(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const result = await this.provider(normalized).lookup(normalized);
    if (!result) throw new Error(`No test data found for ${input.entityType}:${input.key ?? input.reference ?? "unknown"}`);
    const entityId = this.upsertEntity(normalized, result);
    return { ...result, entityId };
  }

  async create(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const result = await this.provider(normalized).create(normalized);
    const entityId = this.upsertEntity(normalized, result);
    return { ...result, entityId, status: "created" as const };
  }

  async transition(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data transition requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const result = await this.provider(normalized).transition(normalized);
    this.upsertEntity(normalized, result);
    return result;
  }

  async verify(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data verification requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    return this.provider(normalized).verify(normalized);
  }

  async cleanup(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data cleanup requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const result = await this.provider(normalized).cleanup(normalized);
    const entity = this.repository.businessEntityInstances.find(
      (item) => item.systemId === input.systemId && item.entityKey === input.reference
    );
    if (entity) {
      entity.status = "released";
      entity.releasedAt = new Date().toISOString();
      entity.updatedAt = entity.releasedAt;
    }
    this.repository.persist();
    return result;
  }

  /** Record a data result produced by a host agent or an external system adapter. */
  recordExternal(input: {
    knowledgeProjectId?: string;
    systemId: string;
    entityType?: string;
    reference: string;
    entityReference?: string;
    values?: Record<string, string | number | boolean | null>;
    sourceRefs?: string[];
  }) {
    const sourceRefs = input.sourceRefs ?? [];
    return this.upsertEntity(
      { ...input, sourceRefs },
      {
        status: "found",
        reference: input.reference,
        entityReference: input.entityReference,
        values: input.values,
        sourceRefs
      }
    );
  }

  releaseExternal(input: { systemId: string; reference: string; sourceRefs?: string[] }) {
    const entity = this.repository.businessEntityInstances.find(
      (item) => item.systemId === input.systemId && item.entityKey === input.reference
    );
    if (!entity) return undefined;
    const now = new Date().toISOString();
    entity.status = "released";
    entity.releasedAt = now;
    entity.updatedAt = now;
    entity.sourceRefs = [...new Set([...entity.sourceRefs, ...(input.sourceRefs ?? [])])];
    this.repository.persist();
    return entity;
  }

  linkDependency(input: Omit<TestDataDependency, "id" | "createdAt">) {
    if (!sameSystemReference(input.systemId, input.fromReference) || !sameSystemReference(input.systemId, input.toReference)) {
      throw new Error("Test data dependencies must stay within the same system");
    }
    const entityReferences = new Set(
      this.repository.businessEntityInstances
        .filter((entity) => entity.systemId === input.systemId && entity.status !== "released")
        .map((entity) => entity.entityKey)
    );
    const missing = [input.fromReference, input.toReference].filter(
      (reference) => !entityReferences.has(reference)
    );
    if (missing.length > 0) {
      throw new Error(`Test data dependency references unknown entity: ${missing.join(", ")}`);
    }
    const existing = this.repository.testDataDependencies.find(
      (item) => item.systemId === input.systemId && item.fromReference === input.fromReference && item.toReference === input.toReference && item.relation === input.relation
    );
    if (existing) return existing;
    const dependency: TestDataDependency = { id: id("testDataDependency"), ...input, createdAt: new Date().toISOString() };
    this.repository.testDataDependencies.push(dependency);
    this.repository.persist();
    return dependency;
  }

  private provider(input: TestDataProviderRequest) {
    const provider = this.providers.find((candidate) => candidate.supports(input));
    if (!provider) throw new Error(`No Testdata Brain provider supports ${input.entityType ?? "record"} for ${input.systemId}`);
    return provider;
  }

  private upsertEntity(input: TestDataProviderRequest, result: TestDataProviderResult) {
    const existing = this.repository.businessEntityInstances.find(
      (item) => item.systemId === input.systemId && item.entityKey === result.reference
    );
    const now = new Date().toISOString();
    const entity: BusinessEntityInstance = existing ?? {
      id: id("businessEntity"),
      entityKey: result.reference,
      semanticConceptId: `data:${input.systemId}:${input.entityType}`,
      systemId: input.systemId,
      values: {},
      status: "active",
      sourceRefs: [],
      createdAt: now,
      updatedAt: now
    };
    entity.values = { ...entity.values, ...(result.values ?? input.values ?? {}) };
    entity.entityReference = result.entityReference ?? input.entityReference ?? entity.entityReference;
    entity.knowledgeProjectId = input.knowledgeProjectId ?? entity.knowledgeProjectId;
    entity.sourceRefs = [...new Set([...entity.sourceRefs, ...input.sourceRefs, ...result.sourceRefs])];
    entity.status = "active";
    entity.updatedAt = now;
    if (!existing) this.repository.businessEntityInstances.push(entity);
    this.repository.persist();
    return entity.id;
  }
}

export class InMemoryTestDataProvider implements TestDataProvider {
  readonly calls: string[] = [];
  private readonly records = new Map<string, Record<string, string | number | boolean | null>>();

  constructor(readonly name: string, private readonly systemId?: string) {}

  supports(input: TestDataProviderRequest) {
    return !this.systemId || input.systemId === this.systemId;
  }

  async lookup(input: TestDataProviderRequest) {
    this.calls.push("lookup");
    const reference = input.reference ?? `${input.entityType ?? "record"}:${input.key ?? ""}`;
    const values = this.records.get(reference);
    return values ? { status: "found" as const, reference, entityReference: input.entityReference, values, sourceRefs: input.sourceRefs } : undefined;
  }

  async create(input: TestDataProviderRequest) {
    this.calls.push("create");
    const reference = input.reference ?? input.entityReference ?? `${input.entityType ?? "record"}:${input.key ?? id("record")}`;
    const values = input.values ?? {};
    this.records.set(reference, values);
    return { status: "created" as const, reference, entityReference: input.entityReference, values, sourceRefs: input.sourceRefs };
  }

  async transition(input: TestDataProviderRequest) {
    this.calls.push("transition");
    const reference = input.reference!;
    const values = { ...(this.records.get(reference) ?? {}), status: input.transition ?? "transitioned" };
    this.records.set(reference, values);
    return { status: "transitioned" as const, reference, values, sourceRefs: input.sourceRefs };
  }

  async verify(input: TestDataProviderRequest) {
    this.calls.push("verify");
    const reference = input.reference!;
    const values = this.records.get(reference) ?? {};
    const mismatches = Object.entries(input.expected ?? {}).filter(([key, value]) => values[key] !== value);
    if (mismatches.length > 0) throw new Error(`Test data verification failed for ${reference}`);
    return { status: "verified" as const, reference, values, sourceRefs: input.sourceRefs };
  }

  async cleanup(input: TestDataProviderRequest) {
    this.calls.push("cleanup");
    const reference = input.reference!;
    this.records.delete(reference);
    return { status: "cleaned" as const, reference, sourceRefs: input.sourceRefs };
  }
}

function sameSystemReference(systemId: string, reference: string) {
  if (!reference.includes(":")) return true;
  const prefix = reference.split(":", 1)[0];
  return !prefix.startsWith("system-") || prefix === systemId;
}
