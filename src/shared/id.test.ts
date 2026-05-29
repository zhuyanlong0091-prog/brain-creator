import { describe, expect, it } from "vitest";
import { id } from "./id.js";

describe("shared id helper", () => {
  it("creates prefixed ids", () => {
    expect(id("system")).toMatch(/^system_[a-z0-9]{8}$/);
  });
});
