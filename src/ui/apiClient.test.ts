import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";

describe("apiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data from a successful API envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { id: "auth_1" },
            errors: [],
            traceId: "trace-1"
          }),
          { status: 200 }
        )
      )
    );

    await expect(apiRequest("/api/auth-profiles", { method: "POST" })).resolves.toEqual({
      id: "auth_1"
    });
  });

  it("throws the API error message when the envelope fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            errors: ["Auth profile not found"],
            traceId: "trace-2"
          }),
          { status: 404 }
        )
      )
    );

    await expect(apiRequest("/api/auth-profiles/missing/verify")).rejects.toThrow(
      "Auth profile not found"
    );
  });

  it("throws a network error without swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(apiRequest("/api/assets/search")).rejects.toThrow("network down");
  });
});
