import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isCliEntryPoint } from "./entrypoint.js";

describe("CLI entrypoint detection", () => {
  it("accepts the real module path", () => {
    const modulePath = fileURLToPath(import.meta.url);
    expect(isCliEntryPoint(pathToFileURL(modulePath).href, modulePath)).toBe(true);
  });

  it("does not execute when the module is imported", () => {
    expect(isCliEntryPoint(import.meta.url, "C:\\workspace\\other-module.js")).toBe(false);
  });
});
