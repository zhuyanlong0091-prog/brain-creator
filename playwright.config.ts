import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const executablePath = browserExecutablePath();

export default defineConfig({
  testDir: "./tests/generated",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});

function browserExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.platform === "win32"
      ? `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.platform === "win32"
      ? `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}
