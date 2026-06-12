import { describe, expect, it } from "vitest";
import { nextAgentState } from "./stateMachine.js";

describe("nextAgentState", () => {
  it("allows the normal plan approval flow", () => {
    expect(nextAgentState("idle", "connect_system")).toBe("intent_detected");
    expect(nextAgentState("intent_detected", "build_context")).toBe("context_building");
    expect(nextAgentState("context_building", "generate_plan")).toBe("planning");
    expect(nextAgentState("planning", "wait_for_approval")).toBe("waiting_for_approval");
    expect(nextAgentState("waiting_for_approval", "approve")).toBe("approved");
  });

  it("rejects running before approval", () => {
    expect(() => nextAgentState("planning", "run")).toThrow("Invalid Brain Creator agent transition");
    expect(() => nextAgentState("waiting_for_approval", "run")).toThrow(
      "Invalid Brain Creator agent transition"
    );
  });
});
