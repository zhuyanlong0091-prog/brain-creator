import type {
  CaseDependencyEdge,
  CaseDependencyGraph,
  CaseDependencyNode,
  ExecutableCase,
  TestIntent
} from "../domain/types.js";

/**
 * Build the explicit cross-case data graph used by the compiler.
 *
 * The graph deliberately treats a missing producer as a data decision rather
 * than inferring that a previous case happened to create the record.
 */
export function buildCaseDependencyGraph(input: {
  requirementSetId: string;
  systemId?: string;
  intents: TestIntent[];
  executableCases?: ExecutableCase[];
}): CaseDependencyGraph {
  const intents = input.intents.filter(
    (intent) => intent.requirementSetId === input.requirementSetId
  );
  const executableCaseByIntent = new Map(
    (input.executableCases ?? [])
      .filter(
        (executableCase) =>
          executableCase.systemId === input.systemId &&
          executableCase.status !== "stale" &&
          executableCase.status !== "superseded"
      )
      .map((executableCase) => [executableCase.testIntentId, executableCase])
  );
  const nodes: CaseDependencyNode[] = intents.map((intent) => ({
    testIntentId: intent.id,
    executableCaseId: executableCaseByIntent.get(intent.id)?.id,
    producesEntityRefs: normalizeReferences(intent.producesEntityRefs),
    consumesEntityRefs: normalizeReferences(intent.consumesEntityRefs),
    sourceRefs: unique(intent.requirementRefs)
  }));
  const producers = new Map<string, string[]>();
  for (const node of nodes) {
    for (const reference of node.producesEntityRefs) {
      producers.set(reference, [...(producers.get(reference) ?? []), node.testIntentId]);
    }
  }

  const edges: CaseDependencyEdge[] = [];
  const unresolved: CaseDependencyGraph["unresolved"] = [];
  for (const consumer of nodes) {
    for (const entityReference of consumer.consumesEntityRefs) {
      const producerIds = [...(producers.get(entityReference) ?? [])].sort();
      if (producerIds.length !== 1) {
        unresolved.push({
          testIntentId: consumer.testIntentId,
          entityReference,
          reason: producerIds.length === 0 ? "missing-producer" : "ambiguous-producer",
          ...(producerIds.length > 0 ? { producerTestIntentIds: producerIds } : {}),
          sourceRefs: consumer.sourceRefs
        });
        continue;
      }
      const producer = nodes.find((node) => node.testIntentId === producerIds[0]);
      edges.push({
        id: dependencyId(producerIds[0], consumer.testIntentId, entityReference),
        fromTestIntentId: producerIds[0],
        toTestIntentId: consumer.testIntentId,
        entityReference,
        relation: "requires",
        sourceRefs: unique([
          ...(producer?.sourceRefs ?? []),
          ...consumer.sourceRefs,
          `entity:${entityReference}`
        ])
      });
    }
  }

  const dependencyOrder = topologicalOrder(nodes, edges);
  if (dependencyOrder.length !== nodes.length) {
    const ordered = new Set(dependencyOrder);
    for (const node of nodes) {
      if (ordered.has(node.testIntentId)) continue;
      const cycleReferences = unique([
        ...edges
          .filter(
            (edge) =>
              edge.fromTestIntentId === node.testIntentId ||
              edge.toTestIntentId === node.testIntentId
          )
          .map((edge) => edge.entityReference),
        ...node.consumesEntityRefs
      ]);
      for (const entityReference of cycleReferences) {
        unresolved.push({
          testIntentId: node.testIntentId,
          entityReference,
          reason: "cycle",
          sourceRefs: node.sourceRefs
        });
      }
    }
  }

  const hasCycle = unresolved.some((item) => item.reason === "cycle");
  const hasAmbiguity = unresolved.some((item) => item.reason === "ambiguous-producer");
  const hasMissing = unresolved.some((item) => item.reason === "missing-producer");
  return {
    requirementSetId: input.requirementSetId,
    ...(input.systemId ? { systemId: input.systemId } : {}),
    nodes,
    edges,
    dependencyOrder,
    unresolved,
    verdict: hasCycle
      ? "blocked"
      : hasAmbiguity
        ? "ambiguous"
        : hasMissing
          ? "needs-data"
          : "ready",
    sourceRefs: unique(nodes.flatMap((node) => node.sourceRefs)),
    generatedAt: new Date().toISOString()
  };
}

function topologicalOrder(nodes: CaseDependencyNode[], edges: CaseDependencyEdge[]) {
  const incoming = new Map(nodes.map((node) => [node.testIntentId, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.toTestIntentId, (incoming.get(edge.toTestIntentId) ?? 0) + 1);
    outgoing.set(edge.fromTestIntentId, [
      ...(outgoing.get(edge.fromTestIntentId) ?? []),
      edge.toTestIntentId
    ]);
  }
  const remaining = nodes.map((node) => node.testIntentId);
  const order: string[] = [];
  while (true) {
    const ready = remaining
      .filter((intentId) => !order.includes(intentId) && incoming.get(intentId) === 0)
      .sort();
    if (ready.length === 0) break;
    for (const intentId of ready) {
      order.push(intentId);
      for (const target of outgoing.get(intentId) ?? []) {
        incoming.set(target, (incoming.get(target) ?? 0) - 1);
      }
    }
  }
  return order;
}

function normalizeReferences(references?: string[]) {
  return unique((references ?? []).map((reference) => reference.trim()).filter(Boolean));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function dependencyId(fromTestIntentId: string, toTestIntentId: string, entityReference: string) {
  return `case-dependency:${fromTestIntentId}:${toTestIntentId}:${encodeURIComponent(entityReference)}`;
}
