import { describe, expect, it } from "vitest";
import { errorEnvelope, successEnvelope } from "./envelope.js";

describe("shared envelope helpers", () => {
  it("creates success envelopes", () => {
    expect(successEnvelope({ id: "system_1" })).toEqual({
      success: true,
      data: { id: "system_1" },
      errors: [],
      traceId: "local-trace"
    });
  });

  it("creates error envelopes from unknown errors", () => {
    expect(errorEnvelope(new Error("No auth"))).toEqual({
      success: false,
      data: null,
      errors: ["No auth"],
      traceId: "local-trace"
    });
  });
});
