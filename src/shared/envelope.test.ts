import { describe, expect, it } from "vitest";
import { BrainCreatorError, errorEnvelope, successEnvelope } from "./envelope.js";

describe("shared envelope helpers", () => {
  it("creates success envelopes", () => {
    const envelope = successEnvelope({ id: "system_1" });

    expect(envelope).toEqual({
      success: true,
      data: { id: "system_1" },
      errors: [],
      traceId: expect.stringMatching(/^[0-9a-f-]{36}$/)
    });
  });

  it("creates structured bilingual error envelopes with stable codes", () => {
    const envelope = errorEnvelope(
      new BrainCreatorError({
        code: "BC_AUTH_REQUIRED",
        message: "No auth",
        userMessage: {
          enUS: "Authentication is required.",
          zhCN: "需要先完成鉴权。"
        },
        nextAction: "configure-auth",
        retryable: false
      })
    );

    expect(envelope).toEqual({
      success: false,
      data: null,
      errors: ["No auth"],
      traceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      error: {
        code: "BC_AUTH_REQUIRED",
        userMessage: {
          enUS: "Authentication is required.",
          zhCN: "需要先完成鉴权。"
        },
        technicalMessage: "No auth",
        nextAction: "configure-auth",
        retryable: false
      }
    });
  });

  it("uses a new trace id for every envelope", () => {
    expect(successEnvelope({}).traceId).not.toBe(successEnvelope({}).traceId);
  });

  it("classifies common runtime failures with actionable bilingual codes", () => {
    expect(errorEnvelope(new Error("Structured Playwright Reporter output was missing"))).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "BC_REPORTER_MISSING",
          nextAction: "inspect-reporter-output",
          retryable: false
        })
      })
    );
    expect(errorEnvelope(new Error("Agent bridge command timed out"))).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "BC_AGENT_BRIDGE_TIMEOUT",
          nextAction: "configure-agent-bridge",
          retryable: true
        })
      })
    );
    expect(errorEnvelope(new Error("Brain Creator store is locked by another writer"))).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "BC_STORE_LOCKED",
          nextAction: "retry-store-operation",
          retryable: true
        })
      })
    );
  });
});
