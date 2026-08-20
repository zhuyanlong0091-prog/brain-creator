import { describe, expect, it } from "vitest";
import {
  browserObservationCapability,
  playwrightTestArgs
} from "./browserObservation.js";

describe("browser observation mode", () => {
  it("keeps headless execution as the default", () => {
    expect(playwrightTestArgs("tests/generated/case.spec.ts", {
      structuredReporter: true
    })).toEqual([
      "playwright",
      "test",
      "tests/generated/case.spec.ts",
      "--workers=1",
      "--reporter=json",
      "--trace=on"
    ]);
  });

  it("opens a headed browser only for observe mode", () => {
    expect(playwrightTestArgs("tests/generated/case.spec.ts", {
      browserMode: "observe",
      structuredReporter: true
    })).toEqual([
      "playwright",
      "test",
      "tests/generated/case.spec.ts",
      "--workers=1",
      "--headed",
      "--reporter=json",
      "--trace=on"
    ]);
  });

  it("reports when observe mode has no interactive desktop", () => {
    expect(browserObservationCapability("observe", {
      platform: "linux",
      env: { CI: "true" }
    })).toEqual({
      requestedMode: "observe",
      effectiveMode: undefined,
      available: false,
      reason: "Visible browser observation is unavailable in CI. Use browserMode=headless or run from an interactive desktop session."
    });
    expect(browserObservationCapability("observe", {
      platform: "linux",
      env: {}
    })).toEqual(expect.objectContaining({
      requestedMode: "observe",
      available: false,
      reason: expect.stringContaining("DISPLAY or WAYLAND_DISPLAY")
    }));
  });

  it("allows an interactive Windows desktop and ordinary headless execution", () => {
    expect(browserObservationCapability("observe", {
      platform: "win32",
      env: { SESSIONNAME: "Console" }
    })).toEqual({
      requestedMode: "observe",
      effectiveMode: "observe",
      available: true
    });
    expect(browserObservationCapability("headless", {
      platform: "linux",
      env: { CI: "true" }
    })).toEqual({
      requestedMode: "headless",
      effectiveMode: "headless",
      available: true
    });
  });
});
