// @vitest-environment node

import { describe, expect, it } from "vitest";
import { classifyExecutionFailure } from "./failureClassifier.js";

describe("classifyExecutionFailure", () => {
  it.each([
    ["Login returned 401", "", "auth_failure"],
    ["Locator button[name=Save] not found", "", "locator_failure"],
    ["Generated test has SyntaxError", "", "automation_failure"],
    ["Request timed out with ECONNRESET", "", "network_failure"],
    ["Expected visible but actual hidden", "", "assertion_failure"],
    ["Could not prepare customer fixture", "test-data-provider", "test_data_failure"],
    ["Browser process exited before execution", "", "execution_failure"]
  ])("classifies %s", (reason, sourceType, expected) => {
    expect(classifyExecutionFailure(reason, sourceType)).toBe(expected);
  });
});
