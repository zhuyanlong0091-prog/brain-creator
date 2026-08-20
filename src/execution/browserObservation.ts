import type { BrowserExecutionMode } from "../domain/types.js";

type BrowserRuntime = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
};

export type BrowserObservationCapability = {
  requestedMode: BrowserExecutionMode;
  effectiveMode?: BrowserExecutionMode;
  available: boolean;
  reason?: string;
};

export function browserObservationCapability(
  requestedMode: BrowserExecutionMode,
  runtime: BrowserRuntime = { platform: process.platform, env: process.env }
): BrowserObservationCapability {
  if (requestedMode === "headless") {
    return { requestedMode, effectiveMode: "headless", available: true };
  }
  if (isTruthy(runtime.env.CI)) {
    return {
      requestedMode,
      effectiveMode: undefined,
      available: false,
      reason:
        "Visible browser observation is unavailable in CI. Use browserMode=headless or run from an interactive desktop session."
    };
  }
  if (
    runtime.platform === "win32" &&
    runtime.env.SESSIONNAME?.toLowerCase() === "services"
  ) {
    return {
      requestedMode,
      effectiveMode: undefined,
      available: false,
      reason:
        "Visible browser observation requires an interactive Windows desktop session."
    };
  }
  if (
    runtime.platform === "linux" &&
    !runtime.env.DISPLAY &&
    !runtime.env.WAYLAND_DISPLAY
  ) {
    return {
      requestedMode,
      effectiveMode: undefined,
      available: false,
      reason:
        "Visible browser observation on Linux requires DISPLAY or WAYLAND_DISPLAY."
    };
  }
  return { requestedMode, effectiveMode: "observe", available: true };
}

export function playwrightTestArgs(
  testPath: string,
  input: {
    browserMode?: BrowserExecutionMode;
    structuredReporter: boolean;
  }
) {
  const args = ["playwright", "test", testPath, "--workers=1"];
  if (input.browserMode === "observe") args.push("--headed");
  if (input.structuredReporter) args.push("--reporter=json", "--trace=on");
  return args;
}

function isTruthy(value: string | undefined) {
  return Boolean(value && !["0", "false", "no", "off"].includes(value.toLowerCase()));
}
