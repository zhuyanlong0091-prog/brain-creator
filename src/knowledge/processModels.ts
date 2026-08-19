import { id } from "../shared/id.js";
import type {
  AttachmentAnalysis,
  CoverageDimension,
  RequirementCoverageProfile,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { RequirementAnalysis, RequirementClause } from "./policies.js";

type ProcessModels = {
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
};

export function buildProcessModels(input: {
  knowledgeProjectId: string;
  requirementSetId: string;
  analyses: AttachmentAnalysis[];
}): ProcessModels {
  const confirmed = input.analyses.filter((analysis) => analysis.status === "confirmed");
  return {
    workflowModels: confirmed
      .filter((analysis) => analysis.kind === "flowchart")
      .map((analysis) => workflowModel(input, analysis)),
    stateMachineModels: confirmed
      .filter((analysis) => analysis.kind === "state-machine")
      .map((analysis) => stateMachineModel(input, analysis))
  };
}

export function augmentAnalysisWithProcessModels(
  analysis: RequirementAnalysis,
  models: ProcessModels,
  attachmentAnalyses: AttachmentAnalysis[] = []
): RequirementAnalysis {
  const clauses: RequirementClause[] = [...analysis.clauses];
  const nodes = [...analysis.nodes];
  let clauseIndex = clauses.length;

  for (const attachment of attachmentAnalyses.filter(
    (item) => item.status === "confirmed" && item.kind !== "flowchart" && item.kind !== "state-machine"
  )) {
    for (const evidence of attachmentEvidenceClauses(attachment)) {
      const clause = processClause(
        ++clauseIndex,
        evidence.text,
        evidence.sourceRef,
        analysis.module,
        evidence.nodeTypes
      );
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, attachment.confidence));
    }
  }

  for (const model of models.workflowModels) {
    for (const transition of model.transitions) {
      const from = model.steps.find((step) => step.id === transition.from)?.label ?? transition.from;
      const to = model.steps.find((step) => step.id === transition.to)?.label ?? transition.to;
      const text = describeTransition(from, to, transition.condition, transition.actor);
      const clause = processClause(++clauseIndex, text, transition.sourceRefs[0], analysis.module, [
        "workflow",
        ...(transition.actor ? (["actor"] as const) : [])
      ]);
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, model.confidence));
    }
  }

  for (const model of models.stateMachineModels) {
    for (const transition of model.transitions) {
      const from = model.states.find((state) => state.id === transition.from)?.label ?? transition.from;
      const to = model.states.find((state) => state.id === transition.to)?.label ?? transition.to;
      const text = describeTransition(from, to, transition.trigger, transition.actor);
      const clause = processClause(++clauseIndex, text, transition.sourceRefs[0], analysis.module, [
        "state",
        "workflow",
        ...(transition.actor ? (["actor"] as const) : [])
      ]);
      clauses.push(clause);
      nodes.push(...nodesForProcessClause(analysis, clause, model.confidence));
    }
  }

  return { ...analysis, clauses, nodes };
}

export function buildProcessTestIntents(input: {
  knowledgeProjectId: string;
  analysis: RequirementAnalysis;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  baseIntents: TestIntent[];
}): TestIntent[] {
  const now = new Date().toISOString();
  const intents = input.baseIntents.map((intent) => ({ ...intent }));

  for (const model of input.workflowModels) {
    for (const transition of model.transitions) {
      const intent = intents.find((candidate) => candidate.requirementRefs.includes(transition.sourceRefs[0]));
      if (!intent) continue;
      intent.scenarioType = "positive";
      intent.processModelRefs = [model.id];
      intent.coverageDimensions = unique([...(intent.coverageDimensions ?? []), "workflow"]);
      intent.techniques = unique([...(intent.techniques ?? []), transition.condition ? "decision-table" : "scenario"]);
    }
    const actors = unique(model.actors.filter(Boolean));
    if (actors.length > 1) {
      intents.push({
        id: id("intent"),
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.analysis.requirementSetId,
        title: `${input.analysis.module}: cross-role actor journey`,
        module: input.analysis.module,
        priority: "P0",
        objective: `Complete the workflow across roles: ${actors.join(" -> ")}`,
        preconditions: ["The requirement baseline is approved", "Each actor has an available test identity"],
        expectedResults: ["Every workflow transition completes under the expected actor"],
        requirementRefs: unique(model.transitions.flatMap((transition) => transition.sourceRefs)),
        knowledgeNodeRefs: [`workflow:${model.title}`],
        techniques: ["scenario", "state-transition"],
        coverageDimensions: ["workflow", "state"],
        scenarioType: "positive",
        processModelRefs: [model.id],
        actorJourney: actors,
        status: "draft",
        createdAt: now,
        updatedAt: now
      });
    }
  }

  for (const model of input.stateMachineModels) {
    for (const transition of model.transitions) {
      const sourceRef = transition.sourceRefs[0];
      const positive = intents.find((candidate) => candidate.requirementRefs.includes(sourceRef));
      if (positive) {
        positive.scenarioType = "positive";
        positive.processModelRefs = [model.id];
        positive.coverageDimensions = unique([...(positive.coverageDimensions ?? []), "state", "workflow"]);
        positive.techniques = unique([...(positive.techniques ?? []), "state-transition"]);
      }
      const from = model.states.find((state) => state.id === transition.from)?.label ?? transition.from;
      const to = model.states.find((state) => state.id === transition.to)?.label ?? transition.to;
      intents.push(negativeIntent(input, model.id, sourceRef, `${from} -> ${to}: missing prerequisite`,
        `Attempt the transition without first reaching ${from}`,
        `The transition to ${to} is rejected and the current state is preserved`, now));
      if (transition.actor) {
        intents.push(negativeIntent(input, model.id, sourceRef, `${from} -> ${to}: role mismatch`,
          `Attempt the transition as an actor other than ${transition.actor}`,
          `The transition is rejected for an unauthorized actor`, now));
      }
    }

    const invalid = firstInvalidTransition(model);
    if (invalid && model.sourceRefs[0]) {
      intents.push(negativeIntent(
        input,
        model.id,
        model.sourceRefs[0],
        `${invalid.from.label} -> ${invalid.to.label}: invalid transition`,
        `Attempt a direct transition from ${invalid.from.label} to ${invalid.to.label}`,
        "The undefined state transition is rejected",
        now
      ));
    }
  }

  return intents;
}

export function buildRequirementCoverageProfile(input: {
  knowledgeProjectId: string;
  requirementSetId: string;
  inputHash: string;
  analysis: RequirementAnalysis;
  intents: TestIntent[];
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
}): RequirementCoverageProfile {
  const dimensions = Object.fromEntries(
    (["field", "workflow", "state", "permission", "integration"] as CoverageDimension[]).map((dimension) => {
      const requirementRefs = unique(
        input.analysis.clauses
          .filter((clause) => clauseDimensions(clause).includes(dimension))
          .map((clause) => clause.sourceRef)
      );
      const matching = input.intents.filter((intent) => intent.coverageDimensions?.includes(dimension));
      const coveredRefs = requirementRefs.filter((sourceRef) =>
        matching.some((intent) => intent.requirementRefs.includes(sourceRef))
      );
      return [dimension, {
        requirementRefs,
        coveredRefs,
        missingRefs: requirementRefs.filter((sourceRef) => !coveredRefs.includes(sourceRef)),
        intentCount: matching.length
      }];
    })
  ) as RequirementCoverageProfile["dimensions"];

  const reasons: string[] = [];
  if (input.workflowModels.length > 0 && dimensions.workflow.missingRefs.length > 0) {
    reasons.push("Workflow transitions are missing traceable test coverage");
  }
  if (input.stateMachineModels.length > 0 && dimensions.state.missingRefs.length > 0) {
    reasons.push("State transitions are missing traceable test coverage");
  }
  if (input.workflowModels.some((model) => model.transitions.length === 0)) {
    reasons.push("A confirmed workflow model has no transitions");
  }
  if (input.stateMachineModels.some((model) => model.states.length < 2 || model.transitions.length === 0)) {
    reasons.push("A confirmed state-machine model lacks states or transitions");
  }
  const processRequired = input.workflowModels.length + input.stateMachineModels.length > 0;
  if (processRequired && dimensions.workflow.intentCount + dimensions.state.intentCount === 0) {
    reasons.push("Requirement test design is field-heavy and has no process coverage");
  }

  return {
    id: id("coverageProfile"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    inputHash: input.inputHash,
    dimensions,
    workflowModelIds: input.workflowModels.map((model) => model.id),
    stateMachineModelIds: input.stateMachineModels.map((model) => model.id),
    status: reasons.length > 0 ? "blocked" : "complete",
    reasons,
    generatedAt: new Date().toISOString()
  };
}

function workflowModel(
  input: { knowledgeProjectId: string; requirementSetId: string },
  analysis: AttachmentAnalysis
): WorkflowModel {
  const now = new Date().toISOString();
  const incoming = new Set(analysis.edges.map((edge) => edge.to));
  const outgoing = new Set(analysis.edges.map((edge) => edge.from));
  const transitions = analysis.edges.map((edge, index) => ({
    id: `${analysis.id}:transition:${index + 1}`,
    from: edge.from,
    to: edge.to,
    condition: edge.condition,
    actor: edge.actor,
    sourceRefs: [edgeSourceRef(analysis, index)]
  }));
  return {
    id: id("workflow"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    attachmentAnalysisId: analysis.id,
    title: `Workflow from ${analysis.attachmentId}`,
    actors: unique(analysis.edges.map((edge) => edge.actor).filter((actor): actor is string => Boolean(actor))),
    steps: analysis.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      actor: analysis.edges.find((edge) => edge.from === node.id)?.actor,
      sourceRefs: analysis.sourceRefs
    })),
    transitions,
    startStepIds: analysis.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id),
    endStepIds: analysis.nodes.filter((node) => !outgoing.has(node.id)).map((node) => node.id),
    sourceRefs: unique(transitions.flatMap((transition) => transition.sourceRefs)),
    confidence: analysis.confidence,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function stateMachineModel(
  input: { knowledgeProjectId: string; requirementSetId: string },
  analysis: AttachmentAnalysis
): StateMachineModel {
  const now = new Date().toISOString();
  const incoming = new Set(analysis.edges.map((edge) => edge.to));
  const outgoing = new Set(analysis.edges.map((edge) => edge.from));
  const transitions = analysis.edges.map((edge, index) => ({
    id: `${analysis.id}:transition:${index + 1}`,
    from: edge.from,
    to: edge.to,
    trigger: edge.condition,
    actor: edge.actor,
    sourceRefs: [edgeSourceRef(analysis, index)]
  }));
  return {
    id: id("stateMachine"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.requirementSetId,
    attachmentAnalysisId: analysis.id,
    title: `State machine from ${analysis.attachmentId}`,
    states: analysis.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      initial: !incoming.has(node.id),
      terminal: !outgoing.has(node.id),
      sourceRefs: analysis.sourceRefs
    })),
    transitions,
    sourceRefs: unique(transitions.flatMap((transition) => transition.sourceRefs)),
    confidence: analysis.confidence,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function processClause(
  index: number,
  text: string,
  sourceRef: string,
  module: string,
  nodeTypes: RequirementClause["nodeTypes"]
): RequirementClause {
  return { id: `visual-clause-${index}`, index, text, sourceRef, module, nodeTypes: [...nodeTypes] };
}

function attachmentEvidenceClauses(analysis: AttachmentAnalysis): Array<{
  text: string;
  sourceRef: string;
  nodeTypes: RequirementClause["nodeTypes"];
}> {
  if (analysis.kind === "table") {
    const rows = analysis.markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"))
      .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
    const [header, ...body] = rows;
    const dataRows = body.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    if (header && dataRows.length > 0) {
      return dataRows.map((row, index) => ({
        text: header.map((name, column) => `${name}: ${row[column] ?? ""}`).join("; "),
        sourceRef: `attachment-analysis:${analysis.id}#row:${index + 1}`,
        nodeTypes: ["field", "rule", "data-constraint"]
      }));
    }
  }
  const markdown = analysis.markdown.trim();
  if (!markdown) return [];
  return [{
    text: markdown,
    sourceRef: `attachment-analysis:${analysis.id}`,
    nodeTypes: analysis.kind === "wireframe" ? ["field", "workflow"] : ["requirement"]
  }];
}

function nodesForProcessClause(
  analysis: RequirementAnalysis,
  clause: RequirementClause,
  confidence: number
): RequirementAnalysis["nodes"] {
  return clause.nodeTypes.map((type) => ({
    requirementSetId: analysis.requirementSetId,
    type,
    title: `${clause.module} ${type}: ${clause.text}`,
    content: clause.text,
    module: clause.module,
    sourceRefs: [clause.sourceRef],
    origin: "derived" as const,
    confidence,
    status: "draft" as const,
    policyId: analysis.policyId,
    policyVersion: analysis.policyVersion
  }));
}

function negativeIntent(
  input: { knowledgeProjectId: string; analysis: RequirementAnalysis },
  modelId: string,
  sourceRef: string,
  title: string,
  objective: string,
  expected: string,
  now: string
): TestIntent {
  return {
    id: id("intent"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.analysis.requirementSetId,
    title: `${input.analysis.module}: ${title}`,
    module: input.analysis.module,
    priority: "P1",
    objective,
    preconditions: ["The requirement baseline is approved", "The target environment is available"],
    expectedResults: [expected],
    requirementRefs: [sourceRef],
    knowledgeNodeRefs: [`state-machine:${modelId}`],
    techniques: ["state-transition", "error-guessing"],
    coverageDimensions: ["state", "workflow"],
    scenarioType: "negative",
    processModelRefs: [modelId],
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function firstInvalidTransition(model: StateMachineModel) {
  for (const from of model.states) {
    for (const to of model.states) {
      if (from.id === to.id) continue;
      if (!model.transitions.some((transition) => transition.from === from.id && transition.to === to.id)) {
        return { from, to };
      }
    }
  }
  return undefined;
}

function edgeSourceRef(analysis: AttachmentAnalysis, index: number) {
  return `attachment-analysis:${analysis.id}#edge:${index + 1}`;
}

function describeTransition(from: string, to: string, condition?: string, actor?: string) {
  return [actor ? `${actor} moves` : "Move", `from ${from} to ${to}`, condition ? `when ${condition}` : ""]
    .filter(Boolean)
    .join(" ");
}

function clauseDimensions(clause: RequirementClause): CoverageDimension[] {
  return unique(clause.nodeTypes.flatMap((type): CoverageDimension[] => {
    if (type === "field" || type === "data-constraint") return ["field"];
    if (type === "workflow" || type === "object") return ["workflow"];
    if (type === "state" || type === "rule") return ["state"];
    if (type === "permission") return ["permission"];
    if (type === "integration") return ["integration"];
    return [];
  }));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
