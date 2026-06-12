import type { AgentLoopState } from "../domain/types.js";

export type AgentTransitionEvent =
  | "connect_system"
  | "build_context"
  | "generate_plan"
  | "wait_for_approval"
  | "wait_for_auth"
  | "approve"
  | "run"
  | "generate"
  | "test"
  | "heal"
  | "block"
  | "complete"
  | "cancel";

const transitions: Record<AgentLoopState, Partial<Record<AgentTransitionEvent, AgentLoopState>>> = {
  idle: {
    connect_system: "intent_detected",
    build_context: "context_building",
    cancel: "cancelled"
  },
  intent_detected: {
    build_context: "context_building",
    complete: "completed",
    block: "blocked",
    cancel: "cancelled"
  },
  context_building: {
    generate_plan: "planning",
    complete: "completed",
    block: "blocked",
    cancel: "cancelled"
  },
  planning: {
    wait_for_approval: "waiting_for_approval",
    wait_for_auth: "waiting_for_auth",
    block: "blocked",
    cancel: "cancelled"
  },
  waiting_for_approval: {
    approve: "approved",
    cancel: "cancelled"
  },
  waiting_for_auth: {
    build_context: "context_building",
    cancel: "cancelled"
  },
  approved: {
    generate: "generating",
    run: "generating",
    cancel: "cancelled"
  },
  generating: {
    test: "testing",
    block: "blocked",
    cancel: "cancelled"
  },
  testing: {
    heal: "healing",
    complete: "completed",
    block: "blocked",
    cancel: "cancelled"
  },
  healing: {
    test: "testing",
    block: "blocked",
    complete: "completed",
    cancel: "cancelled"
  },
  blocked: {
    build_context: "context_building",
    cancel: "cancelled"
  },
  completed: {
    build_context: "context_building"
  },
  cancelled: {
    build_context: "context_building"
  }
};

export function nextAgentState(
  current: AgentLoopState,
  event: AgentTransitionEvent
): AgentLoopState {
  const next = transitions[current][event];
  if (!next) {
    throw new Error(`Invalid Brain Creator agent transition: ${current} -> ${event}`);
  }
  return next;
}
