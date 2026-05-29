import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/generated",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        "C:\\Users\\28917\\AppData\\Local\\ms-playwright\\chromium-1194\\chrome-win\\chrome.exe"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
