import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { TestDataProfile } from "../domain/types.js";
import type {
  BusinessEntityInstance,
  BusinessScenario,
  ScenarioDataPlan,
  TestDataDependency,
  TestDataLifecycleEvent
} from "./types.js";
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
  provider?: string;
};

export function buildScenarioDataPlan(input: {
  scenario: Pick<BusinessScenario, "id" | "testDataNeeds" | "sourceRefs"> & {
    stateTransitionRefs?: string[];
  };
  profiles: TestDataProfile[];
  entities?: BusinessEntityInstance[];
  systemId?: string;
}): ScenarioDataPlan {
  const profileById = new Map(input.profiles.map((profile) => [profile.id, profile]));
  const selectedProfiles = input.scenario.testDataNeeds
    .map((profileId) => profileById.get(profileId))
    .filter((profile): profile is TestDataProfile => Boolean(profile));
  const missingProfileIds = input.scenario.testDataNeeds.filter(
    (profileId) => !profileById.has(profileId)
  );
  const fieldProfiles = new Map<string, TestDataProfile[]>();
  for (const profile of selectedProfiles) {
    const key = normalize(profile.field);
    fieldProfiles.set(key, [...(fieldProfiles.get(key) ?? []), profile]);
  }
  const activeEntities = (input.entities ?? []).filter((entity) => entity.status === "active");
  const missingEntityReferences: string[] = [];
  const reasons = missingProfileIds.map(
    (profileId) => `Scenario data profile is missing: ${profileId}`
  );
  const dependencies: ScenarioDataPlan["dependencies"] = [];
  const operations: ScenarioDataPlan["operations"] = selectedProfiles.map((profile) => {
    const dependencyProfiles: TestDataProfile[] = [];
    for (const field of profile.dependsOnFields ?? []) {
      const matches = fieldProfiles.get(normalize(field)) ?? [];
      if (matches.length !== 1) {
        reasons.push(
          `Data profile ${profile.id} has a missing or ambiguous dependency: ${field}`
        );
        continue;
      }
      dependencyProfiles.push(matches[0]);
    }
    const dependencyProfileIds = dependencyProfiles.map((dependency) => dependency.id);
    const dependencyEntityReferences = dependencyProfiles
      .map((dependency) => dependency.entityReference)
      .filter((reference): reference is string => Boolean(reference));
    const hasEntityReference = Boolean(profile.entityReference);
    const entity = hasEntityReference
      ? activeEntities.find(
          (candidate) =>
            candidate.entityReference === profile.entityReference ||
            candidate.entityKey === profile.entityReference
        )
      : undefined;
    let readiness: ScenarioDataPlan["readiness"] = "ready";
    let reason: string | undefined;
    let action: ScenarioDataPlan["operations"][number]["action"] = "lookup";
    if (hasEntityReference && entity) {
      action = "lookup";
    } else if (profile.strategy === "existing-reference") {
      action = "lookup";
      if (!profile.seed && !profile.entityReference) {
        readiness = "blocked";
        reason = `Existing reference data profile ${profile.id} has no lookup seed`;
      } else if (profile.entityReference) {
        readiness = "blocked";
        reason = `Required entity ${profile.entityReference} is not available`;
        missingEntityReferences.push(profile.entityReference);
      } else {
        readiness = "creatable";
      }
    } else if (hasEntityReference) {
      action = "create";
      if (profile.cleanup && profile.cleanup !== "none") {
        readiness = "creatable";
      } else {
        readiness = "blocked";
        reason = `Entity ${profile.entityReference} needs an explicit cleanup policy`;
      }
    } else if (profile.strategy === "fixed" || profile.strategy === "secret-reference") {
      if (!profile.seed) {
        readiness = "blocked";
        reason = `Data profile ${profile.id} has no deterministic value`;
      }
    } else {
      readiness = profile.seed ? "ready" : "blocked";
      if (!profile.seed) reason = `Data profile ${profile.id} has no deterministic seed`;
    }
    if (reason) reasons.push(reason);
    if (profile.entityReference && dependencyProfileIds.length > 0) {
      dependencies.push({
        profileId: profile.id,
        entityReference: profile.entityReference,
        dependsOnProfileIds: dependencyProfileIds,
        dependsOnEntityReferences: dependencyEntityReferences,
        sourceRefs: unique([...input.scenario.sourceRefs, ...profile.sourceRefs])
      });
    }
    return {
      profileId: profile.id,
      field: profile.field,
      ...(profile.entityReference ? { entityReference: profile.entityReference } : {}),
      action,
      readiness,
      dependencyProfileIds,
      dependencyEntityReferences,
      cleanup: profile.cleanup ?? "none",
      sourceRefs: unique([...input.scenario.sourceRefs, ...profile.sourceRefs]),
      ...(reason ? { reason } : {})
    };
  });
  const hasBlocked = missingProfileIds.length > 0 || operations.some((operation) => operation.readiness === "blocked");
  const hasCreatable = operations.some((operation) => operation.readiness === "creatable");
  const readiness: ScenarioDataPlan["readiness"] = hasBlocked
    ? "blocked"
    : hasCreatable
      ? "creatable"
      : "ready";
  const plannedLifecycle: ScenarioDataPlan["plannedLifecycle"] = [];
  for (const operation of operations) {
    if (!plannedLifecycle.includes(operation.action)) plannedLifecycle.push(operation.action);
  }
  if (input.scenario.testDataNeeds.length > 0 && !plannedLifecycle.includes("verify")) {
    plannedLifecycle.push("verify");
  }
  if ((input.scenario.stateTransitionRefs?.length ?? 0) > 0 && !plannedLifecycle.includes("transition")) {
    const verifyIndex = plannedLifecycle.indexOf("verify");
    if (verifyIndex >= 0) plannedLifecycle.splice(verifyIndex, 0, "transition");
    else plannedLifecycle.push("transition");
  }
  if (operations.some((operation) => operation.cleanup !== "none") && !plannedLifecycle.includes("cleanup")) {
    plannedLifecycle.push("cleanup");
  }
  return {
    scenarioId: input.scenario.id,
    ...(input.systemId ? { systemId: input.systemId } : {}),
    profileIds: input.scenario.testDataNeeds,
    entityReferences: unique(
      selectedProfiles
        .map((profile) => profile.entityReference)
        .filter((reference): reference is string => Boolean(reference))
    ),
    operations,
    dependencies,
    readiness,
    missingProfileIds,
    missingEntityReferences: unique(missingEntityReferences),
    reasons: unique(reasons),
    sourceRefs: unique([
      ...input.scenario.sourceRefs,
      ...selectedProfiles.flatMap((profile) => profile.sourceRefs)
    ]),
    plannedLifecycle
  };
}

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

  planScenarioData(input: {
    scenario: Pick<BusinessScenario, "id" | "testDataNeeds" | "sourceRefs"> & {
      stateTransitionRefs?: string[];
    };
    profiles: TestDataProfile[];
    systemId?: string;
  }) {
    const plan = buildScenarioDataPlan({
      scenario: input.scenario,
      profiles: input.profiles,
      entities: input.systemId
        ? this.repository.businessEntityInstances.filter(
            (entity) => entity.systemId === input.systemId
          )
        : []
    });
    const scenario = this.repository.businessScenarios.find((item) => item.id === input.scenario.id);
    if (scenario) {
      scenario.dataPlan = plan;
      this.repository.persist();
    }
    return plan;
  }

  async lookup(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const provider = this.provider(normalized);
    const startedAt = new Date().toISOString();
    const result = await provider.lookup(normalized);
    if (!result) throw new Error(`No test data found for ${input.entityType}:${input.key ?? input.reference ?? "unknown"}`);
    const enriched = { ...result, provider: provider.name };
    const entityId = this.upsertEntity(normalized, enriched, "lookup", startedAt);
    return { ...enriched, entityId };
  }

  async create(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const provider = this.provider(normalized);
    const startedAt = new Date().toISOString();
    const result = await provider.create(normalized);
    const enriched = { ...result, provider: provider.name, status: "created" as const };
    const entityId = this.upsertEntity(normalized, enriched, "create", startedAt);
    return { ...enriched, entityId };
  }

  async transition(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data transition requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const provider = this.provider(normalized);
    const startedAt = new Date().toISOString();
    const result = await provider.transition(normalized);
    const enriched = { ...result, provider: provider.name };
    this.upsertEntity(normalized, enriched, "transition", startedAt);
    return enriched;
  }

  async verify(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data verification requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const provider = this.provider(normalized);
    const startedAt = new Date().toISOString();
    const result = await provider.verify(normalized);
    const enriched = { ...result, provider: provider.name };
    const entityId = this.upsertEntity(normalized, enriched, "verify", startedAt);
    return { ...enriched, entityId };
  }

  async cleanup(input: Omit<TestDataProviderRequest, "sourceRefs"> & { sourceRefs?: string[] }) {
    if (!input.reference) throw new Error("Test data cleanup requires a reference");
    const normalized = { ...input, sourceRefs: input.sourceRefs ?? [] };
    const provider = this.provider(normalized);
    const startedAt = new Date().toISOString();
    const result = await provider.cleanup(normalized);
    const enriched = { ...result, provider: provider.name };
    const entity = this.repository.businessEntityInstances.find(
      (item) => item.systemId === input.systemId && item.entityKey === input.reference
    );
    if (entity) {
      entity.status = "released";
      entity.releasedAt = new Date().toISOString();
      entity.updatedAt = entity.releasedAt;
      this.appendLifecycleEvent(entity, enriched, "cleanup", startedAt);
    }
    this.repository.persist();
    return enriched;
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
        sourceRefs,
        provider: "external"
      },
      "external-record",
      new Date().toISOString()
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
    this.appendLifecycleEvent(entity, {
      status: "cleaned",
      reference: entity.entityKey,
      entityReference: entity.entityReference,
      sourceRefs: input.sourceRefs ?? [],
      provider: "external"
    }, "external-release", now);
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

  private upsertEntity(
    input: TestDataProviderRequest,
    result: TestDataProviderResult,
    operation: TestDataLifecycleEvent["operation"],
    startedAt: string
  ) {
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
    this.appendLifecycleEvent(entity, result, operation, startedAt);
    if (!existing) this.repository.businessEntityInstances.push(entity);
    this.repository.persist();
    return entity.id;
  }

  private appendLifecycleEvent(
    entity: BusinessEntityInstance,
    result: TestDataProviderResult,
    operation: TestDataLifecycleEvent["operation"],
    startedAt: string
  ) {
    const completedAt = new Date().toISOString();
    const event: TestDataLifecycleEvent = {
      id: id("testDataLifecycle"),
      operation,
      status: result.status,
      provider: result.provider ?? "unknown",
      reference: result.reference,
      ...(result.entityReference ?? entity.entityReference
        ? { entityReference: result.entityReference ?? entity.entityReference }
        : {}),
      sourceRefs: unique(result.sourceRefs),
      startedAt,
      completedAt
    };
    entity.lifecycleEvents = [...(entity.lifecycleEvents ?? []), event];
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
    if (!this.records.has(reference)) {
      throw new Error(`Cannot transition unknown test data entity ${reference}`);
    }
    const values = { ...(this.records.get(reference) ?? {}), status: input.transition ?? "transitioned" };
    this.records.set(reference, values);
    return { status: "transitioned" as const, reference, values, sourceRefs: input.sourceRefs };
  }

  async verify(input: TestDataProviderRequest) {
    this.calls.push("verify");
    const reference = input.reference!;
    const values = this.records.get(reference);
    if (!values) throw new Error(`Cannot verify unknown test data entity ${reference}`);
    const mismatches = Object.entries(input.expected ?? {}).filter(([key, value]) => values[key] !== value);
    if (mismatches.length > 0) throw new Error(`Test data verification failed for ${reference}`);
    return { status: "verified" as const, reference, values, sourceRefs: input.sourceRefs };
  }

  async cleanup(input: TestDataProviderRequest) {
    this.calls.push("cleanup");
    const reference = input.reference!;
    if (!this.records.has(reference)) {
      throw new Error(`Cannot clean up unknown test data entity ${reference}`);
    }
    this.records.delete(reference);
    return { status: "cleaned" as const, reference, sourceRefs: input.sourceRefs };
  }
}

function sameSystemReference(systemId: string, reference: string) {
  if (!reference.includes(":")) return true;
  const prefix = reference.split(":", 1)[0];
  return !prefix.startsWith("system-") || prefix === systemId;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
