import { createHash } from "node:crypto";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { SystemBrain } from "../knowledge/systemBrain.js";
import { id } from "../shared/id.js";
import { canonicalPageIdentityKey, canonicalPageRoute } from "../shared/pageIdentity.js";
import { canonicalActionAlias, normalizeSemanticTerm } from "./semanticSpine.js";
import { pageSemanticRole } from "./systemPageIdentity.js";
import type {
  SystemBrainChange,
  SystemBrainChangeSet,
  SystemBrainSnapshot,
  SystemBrainSnapshotAsset,
  SystemBrainSnapshotAssetKind,
  SystemBrainSnapshotStatus,
  SystemPageIdentity
} from "./types.js";

export type SystemBrainSnapshotStore = Pick<
  InMemoryBrainCreatorRepository,
  "systemBrainSnapshots" | "systemBrainChangeSets"
> & { systemPageIdentities?: SystemPageIdentity[]; persist(): void };

export type CreateSystemBrainSnapshotInput = {
  knowledgeProjectId: string;
  systemId: string;
  brain: SystemBrain;
  explorationIds?: string[];
  basedOnSnapshotId?: string;
  status?: SystemBrainSnapshotStatus;
};

export class SystemBrainSnapshotService {
  constructor(private readonly store: SystemBrainSnapshotStore) {}

  capture(input: CreateSystemBrainSnapshotInput) {
    const assets = systemBrainToSnapshotAssets(input.brain);
    const contentHash = hashValue(
      assets.map((asset) => [
        asset.semanticId,
        asset.contentHash,
        asset.kind === "locator" ? asset.metadata.selector : undefined
      ])
    );
    const previous = this.latest(input.systemId) ?? this.latest(input.systemId, "candidate");
    if (previous?.contentHash === contentHash) {
      return {
        snapshot: previous,
        changeSet: this.store.systemBrainChangeSets.find(
          (changeSet) => changeSet.toSnapshotId === previous.id
        )
      };
    }
    const now = new Date().toISOString();
    const snapshot: SystemBrainSnapshot = {
      id: id("systemBrainSnapshot"),
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      revision: (previous?.revision ?? 0) + 1,
      ...(input.basedOnSnapshotId || previous?.id
        ? { basedOnSnapshotId: input.basedOnSnapshotId ?? previous?.id }
        : {}),
      explorationIds: unique(input.explorationIds ?? []),
      status: input.status ?? "candidate",
      assets,
      contentHash,
      createdAt: now
    };
    if (previous?.status === "candidate") previous.status = "superseded";
    this.store.systemBrainSnapshots.push(snapshot);
    const changeSet = previous
      ? diffSystemBrainSnapshots(previous, snapshot)
      : undefined;
    if (changeSet) this.store.systemBrainChangeSets.push(changeSet);
    this.store.persist();
    return { snapshot, changeSet };
  }

  confirm(snapshotId: string, confirmedBy: string) {
    const snapshot = this.store.systemBrainSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot) throw new Error(`System Brain snapshot ${snapshotId} not found`);
    const now = new Date().toISOString();
    for (const other of this.store.systemBrainSnapshots) {
      if (
        other.systemId === snapshot.systemId &&
        other.status === "confirmed" &&
        other.id !== snapshot.id
      ) {
        other.status = "superseded";
      }
    }
    snapshot.status = "confirmed";
    snapshot.confirmedAt = now;
    snapshot.confirmedBy = confirmedBy;
    const identities = this.store.systemPageIdentities;
    if (identities) {
      const pageIdentityKeys = new Set(
        snapshot.assets
          .filter((asset) => asset.kind === "page")
          .map((asset) => String(asset.metadata.identityKey ?? asset.semanticId))
      );
      for (const identity of identities) {
        if (identity.systemId !== snapshot.systemId || !pageIdentityKeys.has(identity.identityKey)) {
          continue;
        }
        identity.status = "confirmed";
        identity.lastConfirmedRevision = identity.revision;
        identity.confirmedAt = now;
        identity.confirmedBy = confirmedBy;
        identity.updatedAt = now;
      }
    }
    this.store.persist();
    return snapshot;
  }

  latest(systemId: string, status: SystemBrainSnapshotStatus = "confirmed") {
    return this.store.systemBrainSnapshots
      .filter((snapshot) => snapshot.systemId === systemId && snapshot.status === status)
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))[0];
  }

  history(systemId: string) {
    return this.store.systemBrainSnapshots
      .filter((snapshot) => snapshot.systemId === systemId)
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt));
  }

  diff(systemId: string, fromSnapshotId: string, toSnapshotId: string) {
    const from = this.store.systemBrainSnapshots.find((snapshot) => snapshot.id === fromSnapshotId);
    const to = this.store.systemBrainSnapshots.find((snapshot) => snapshot.id === toSnapshotId);
    if (!from || !to || from.systemId !== systemId || to.systemId !== systemId) {
      throw new Error("System Brain snapshot diff requires two snapshots from the same system");
    }
    return diffSystemBrainSnapshots(from, to);
  }
}

export function systemBrainToSnapshotAssets(brain: SystemBrain): SystemBrainSnapshotAsset[] {
  const assets = new Map<string, SystemBrainSnapshotAsset>();
  const add = (
    kind: SystemBrainSnapshotAssetKind,
    semanticId: string,
    label: string,
    contentValue: unknown,
    sourceRefs: string[],
    metadata: SystemBrainSnapshotAsset["metadata"] = {}
  ) => {
    const content = stableStringify(contentValue);
    const asset: SystemBrainSnapshotAsset = {
      semanticId,
      kind,
      label,
      content,
      contentHash: hashValue(content),
      sourceRefs: unique(sourceRefs),
      metadata
    };
    const existing = assets.get(semanticId);
    if (!existing) {
      assets.set(semanticId, asset);
      return;
    }
    existing.sourceRefs = unique([...existing.sourceRefs, ...asset.sourceRefs]);
  };

  for (const page of brain.pages) {
    const pageKey = canonicalPageRoute(page.route);
    const identityKey = canonicalPageIdentityKey(page.route);
    add(
      "page",
      identityKey,
      page.name,
      { route: pageKey, name: normalizeSemanticTerm(page.name) },
      page.sourceRefs,
      {
        route: page.route,
        canonicalRoute: pageKey,
        identityKey,
        semanticRole: pageSemanticRole(page.name),
        pageModelId: page.pageModelId,
        version: page.version
      }
    );
    for (const locator of page.locators) {
      const label = locator.name || locator.text || locator.role;
      const semanticLabel = canonicalActionLabel(label);
      add(
        "locator",
        `locator:${pageKey}:${normalizeSemanticTerm(locator.role)}:${semanticLabel}`,
        label,
        {
          page: pageKey,
          role: normalizeSemanticTerm(locator.role),
          label: semanticLabel,
          text: normalizeSemanticTerm(locator.text)
        },
        [...page.sourceRefs, `locator-point:${locator.id}`],
        { selector: locator.selector, pageModelId: page.pageModelId, locatorPointId: locator.id }
      );
    }
  }

  for (const edge of brain.navigationEdges) {
    const from = normalizeRoute(edge.fromUrl);
    const to = normalizeRoute(edge.toUrl);
    const label = canonicalActionLabel(edge.text);
    add(
      "navigation",
      `navigation:${from}:${to}:${label}`,
      edge.text,
      { from, to, text: label },
      edge.sourceRefs,
      { fromUrl: edge.fromUrl, toUrl: edge.toUrl, explorationId: edge.explorationId }
    );
  }

  for (const state of brain.states) {
    const stateKey = `${normalizeRoute(state.url)}:${hashValue({
      visibleElements: state.visibleElements.map(normalizeSemanticTerm).sort(),
      dialogs: state.dialogs.map(normalizeSemanticTerm).sort(),
      controlValues: state.controlValues ?? []
    }).slice(0, 12)}`;
    add(
      "state",
      `state:${stateKey}`,
      state.url,
      {
        url: normalizeRoute(state.url),
        visibleElements: state.visibleElements.map(normalizeSemanticTerm).sort(),
        dialogs: state.dialogs.map(normalizeSemanticTerm).sort(),
        controlValues: state.controlValues ?? []
      },
      state.sourceRefs,
      { url: state.url }
    );
  }

  for (const transition of brain.stateTransitions) {
    const page = normalizeRoute(transition.pageUrl);
    const target = canonicalActionLabel(transition.targetName);
    const action = normalizeSemanticTerm(transition.action);
    const input = normalizeSemanticTerm(transition.inputValue ?? "");
    add(
      "transition",
      `transition:${page}:${action}:${target}:${input}`,
      transition.targetName,
      {
        page,
        action,
        target,
        input,
        transitionKind: transition.transitionKind ?? (transition.urlChanged ? "navigation" : "state"),
        urlChanged: transition.urlChanged,
        visibleAdded: transition.visibleAdded.map(normalizeSemanticTerm).sort(),
        visibleRemoved: transition.visibleRemoved.map(normalizeSemanticTerm).sort(),
        dialogAdded: transition.dialogAdded.map(normalizeSemanticTerm).sort(),
        dialogRemoved: transition.dialogRemoved.map(normalizeSemanticTerm).sort(),
        changedControls: transition.changedControls ?? []
      },
      transition.sourceRefs,
      {
        selector: transition.targetSelector,
        targetRole: transition.targetRole,
        beforeStateId: transition.beforeStateId,
        afterStateId: transition.afterStateId,
        pageModelId: transition.pageModelId
      }
    );
  }

  for (const workflow of brain.workflows) {
    const page = brain.pages.find((candidate) => candidate.pageModelId === workflow.pageModelId);
    const pageKey = normalizeRoute(page?.route ?? workflow.pageModelId);
    add(
      "workflow",
      `workflow:${pageKey}:${workflow.actionStepIds.join(",")}`,
      workflow.pageName,
      { page: pageKey, actionCount: workflow.actionStepIds.length, apiCount: workflow.apiFlowIds.length },
      workflow.sourceRefs,
      { pageModelId: workflow.pageModelId }
    );
  }

  for (const flow of brain.apiFlows) {
    const requests = flow.requests.map((request) => ({
      method: request.method,
      url: normalizeRoute(request.url),
      status: request.status
    }));
    add(
      "api-flow",
      `api-flow:${normalizeSemanticTerm(flow.name)}`,
      flow.name,
      { name: normalizeSemanticTerm(flow.name), requests },
      flow.sourceRefs,
      { trainingSessionId: flow.trainingSessionId, apiFlowId: flow.apiFlowId }
    );
  }

  return [...assets.values()].sort((left, right) => left.semanticId.localeCompare(right.semanticId));
}

export function diffSystemBrainSnapshots(
  from: SystemBrainSnapshot,
  to: SystemBrainSnapshot
): SystemBrainChangeSet {
  const before = new Map(from.assets.map((asset) => [asset.semanticId, asset]));
  const after = new Map(to.assets.map((asset) => [asset.semanticId, asset]));
  const changes: SystemBrainChange[] = [];
  const now = new Date().toISOString();

  for (const [semanticId, asset] of after) {
    const previous = before.get(semanticId);
    if (!previous) {
      changes.push(change({
        semanticId,
        kind: asset.kind,
        changeType: "added",
        after: asset,
        confidence: 1,
        impact: "recompile",
        status: "needs-review",
        reasons: ["New System Brain evidence was observed."],
        sourceRefs: asset.sourceRefs
      }));
      continue;
    }
    if (
      previous.kind === "locator" &&
      previous.contentHash === asset.contentHash &&
      previous.metadata.selector !== asset.metadata.selector
    ) {
      changes.push(change({
        semanticId,
        kind: asset.kind,
        changeType: "locator-changed",
        before: previous,
        after: asset,
        confidence: 1,
        impact: "none",
        status: "auto-accepted",
        reasons: ["Only the locator selector changed; the semantic target and role are unchanged."],
        sourceRefs: [...previous.sourceRefs, ...asset.sourceRefs]
      }));
      continue;
    }
    if (previous.contentHash === asset.contentHash && previous.label !== asset.label) {
      changes.push(change({
        semanticId,
        kind: asset.kind,
        changeType: "renamed",
        before: previous,
        after: asset,
        confidence: 0.95,
        impact: "none",
        status: "auto-accepted",
        reasons: ["The semantic identity stayed stable after normalizing the label."],
        sourceRefs: [...previous.sourceRefs, ...asset.sourceRefs]
      }));
      continue;
    }
    if (previous.contentHash !== asset.contentHash) {
      const behaviorChange = asset.kind === "transition" || asset.kind === "workflow" || asset.kind === "api-flow";
      changes.push(change({
        semanticId,
        kind: asset.kind,
        changeType: behaviorChange ? "behavior-changed" : "evidence-refreshed",
        before: previous,
        after: asset,
        confidence: 1,
        impact: behaviorChange ? "recompile" : "none",
        status: behaviorChange ? "needs-review" : "auto-accepted",
        reasons: [
          behaviorChange
            ? "The observed workflow or transition behavior changed and requires review."
            : "The observed evidence changed without a workflow-level behavior change."
        ],
        sourceRefs: [...previous.sourceRefs, ...asset.sourceRefs]
      }));
    } else if (previous.sourceRefs.join("\u0000") !== asset.sourceRefs.join("\u0000")) {
      changes.push(change({
        semanticId,
        kind: asset.kind,
        changeType: "evidence-refreshed",
        before: previous,
        after: asset,
        confidence: 1,
        impact: "none",
        status: "auto-accepted",
        reasons: ["The evidence reference changed while the observed content stayed stable."],
        sourceRefs: [...previous.sourceRefs, ...asset.sourceRefs]
      }));
    }
  }

  for (const [semanticId, asset] of before) {
    if (after.has(semanticId)) continue;
    changes.push(change({
      semanticId,
      kind: asset.kind,
      changeType: "removed",
      before: asset,
      confidence: 0.8,
      impact: "blocked",
      status: "needs-review",
      reasons: ["The asset was not observed in this run; one absence does not prove deletion."],
      sourceRefs: asset.sourceRefs
    }));
  }

  const summary = {
    added: count(changes, "added"),
    removed: count(changes, "removed"),
    renamed: count(changes, "renamed"),
    locatorChanged: count(changes, "locator-changed"),
    behaviorChanged: count(changes, "behavior-changed"),
    evidenceRefreshed: count(changes, "evidence-refreshed")
  };
  return {
    id: id("systemBrainChangeSet"),
    knowledgeProjectId: to.knowledgeProjectId,
    systemId: to.systemId,
    fromSnapshotId: from.id,
    toSnapshotId: to.id,
    status: changes.some((item) => item.status === "conflicted")
      ? "conflicted"
      : changes.some((item) => item.status === "needs-review")
        ? "needs-review"
        : "clean",
    changes,
    summary,
    createdAt: now
  };
}

export function canonicalActionLabel(value: string) {
  return canonicalActionAlias(value);
}

function normalizeRoute(value: string) {
  try {
    const url = new URL(value, "http://brain-creator.local");
    return `${url.pathname}${url.search}`.replace(/\/$/u, "") || "/";
  } catch {
    return normalizeSemanticTerm(value).replace(/\/$/u, "") || "/";
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function hashValue(value: unknown) {
  const input = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

function change(input: Omit<SystemBrainChange, "sourceRefs"> & { sourceRefs: string[] }) {
  return input;
}

function count(changes: SystemBrainChange[], changeType: SystemBrainChange["changeType"]) {
  return changes.filter((item) => item.changeType === changeType).length;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
