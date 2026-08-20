import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub CI workflow", () => {
  it("runs tests and type checks for pull requests", async () => {
    const content = await readFile(".github/workflows/ci.yml", "utf8");

    expect(content).toContain("pull_request");
    expect(content).toContain("npm ci");
    expect(content).toContain("npx playwright install --with-deps chromium");
    expect(content).toContain("npm test");
    expect(content).toContain("npx tsc --noEmit");
  });

  it("keeps generated Playwright auth seeds out of Vitest discovery", async () => {
    const content = await readFile("vitest.config.ts", "utf8");

    expect(content).toContain("tests/seed-*.spec.ts");
    expect(content).toContain("**/.brain-creator/**");
  });
});
