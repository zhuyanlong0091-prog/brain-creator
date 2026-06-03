import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

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
