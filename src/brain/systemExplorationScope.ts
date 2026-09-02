import type { SystemBrain } from "../knowledge/systemBrain.js";
import { canonicalPageIdentityKey } from "../shared/pageIdentity.js";
import type { SystemExplorationScope } from "../domain/types.js";
import type { SystemBrainSnapshot, SystemPageIdentity } from "./types.js";

export function planSystemBrainExploration(input: {
  mode: "full" | "incremental";
  startUrl: string;
  brain: SystemBrain;
  identities: SystemPageIdentity[];
  confirmedSnapshot?: SystemBrainSnapshot;
  lowConfidenceThreshold?: number;
}): SystemExplorationScope {
  if (input.mode === "full" || !input.confirmedSnapshot) {
    return {
      mode: "full",
      targetPageIdentityIds: [],
      targetRoutes: [input.startUrl],
      reasons: [
        input.mode === "full"
          ? "A full System Brain exploration was explicitly requested."
          : "No confirmed System Brain baseline exists for incremental exploration."
      ],
      skippedPageCount: 0,
      reason: input.mode === "full"
        ? "Full exploration requested"
        : "Incremental exploration requires a confirmed baseline"
    };
  }

  const baselinePages = new Map(
    input.confirmedSnapshot.assets
      .filter((asset) => asset.kind === "page")
      .map((asset) => [asset.semanticId, asset])
  );
  const targetPageIdentityIds: string[] = [];
  const targetRoutes: string[] = [];
  const reasons: string[] = [];
  let skippedPageCount = 0;
  const threshold = input.lowConfidenceThreshold ?? 0.8;
  for (const page of input.brain.pages) {
    const identityKey = canonicalPageIdentityKey(page.route);
    const identity = input.identities.find(
      (candidate) => candidate.identityKey === identityKey
    );
    const baseline = baselinePages.get(identityKey);
    const pageReasons: string[] = [];
    if (!identity || !baseline) pageReasons.push("not covered by the confirmed snapshot");
    if (baseline && baseline.metadata.pageModelId !== page.pageModelId) {
      pageReasons.push("page model revision changed");
    }
    if (
      page.probeIssueCount > 0 ||
      page.locators.some((locator) => locator.confidence < threshold)
    ) {
      pageReasons.push("low-confidence or probe issues require re-checking");
    }
    const hasBehaviorEvidence =
      input.brain.workflows.some((workflow) => workflow.pageModelId === page.pageModelId) ||
      input.brain.navigationEdges.some((edge) => edge.fromPageModelId === page.pageModelId) ||
      input.brain.stateTransitions.some((transition) => transition.pageModelId === page.pageModelId);
    if (!hasBehaviorEvidence) pageReasons.push("behavior surface is not covered");
    if (pageReasons.length === 0) {
      skippedPageCount += 1;
      continue;
    }
    if (identity) targetPageIdentityIds.push(identity.id);
    targetRoutes.push(page.route);
    reasons.push(`${page.name} (${page.route}): ${pageReasons.join("; ")}`);
  }

  if (targetRoutes.length === 0) {
    return {
      mode: "incremental",
      baseSnapshotId: input.confirmedSnapshot.id,
      targetPageIdentityIds: [],
      targetRoutes: [input.startUrl],
      reasons: ["No stale region is known; verify the configured entry page for liveness."],
      skippedPageCount,
      reason: "No known stale region"
    };
  }
  return {
    mode: "incremental",
    baseSnapshotId: input.confirmedSnapshot.id,
    targetPageIdentityIds: unique(targetPageIdentityIds),
    targetRoutes: unique(targetRoutes),
    reasons,
    skippedPageCount
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}
