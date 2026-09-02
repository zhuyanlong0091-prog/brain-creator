import type { RequirementSource } from "../domain/types.js";

export type RequirementSourceComplexity = {
  level: "simple" | "complex";
  reasons: string[];
  recommendedProvider: "host-agent";
};

const STRUCTURED_BLOCK_TYPES = new Set(["table", "image", "flowchart", "state-machine", "diagram"]);

/**
 * Keep the deterministic parser available for small offline inputs, while
 * routing anything that needs document structure or visual interpretation to
 * the isolated Host Harness.
 */
export function assessRequirementSourceComplexity(
  source: Pick<RequirementSource, "content" | "blocks" | "attachments">
): RequirementSourceComplexity {
  const reasons: string[] = [];
  if (source.attachments.length > 0) reasons.push("The source has attachments that need contextual interpretation");
  if (source.blocks.some((block) => STRUCTURED_BLOCK_TYPES.has(block.type))) {
    reasons.push("The source contains structured or visual document blocks");
  }
  if (source.content.length > 4_000) reasons.push("The source exceeds the offline parser context threshold");
  if (/(workflow|state machine|decision table|审批流程|状态机|流程图|条件分支|跨角色)/i.test(source.content)) {
    reasons.push("The source describes a workflow, state, decision, or actor interaction");
  }
  return {
    level: reasons.length > 0 ? "complex" : "simple",
    reasons,
    recommendedProvider: "host-agent"
  };
}
