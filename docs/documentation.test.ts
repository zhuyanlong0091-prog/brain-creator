import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicDocs = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/core-concepts.md",
  "docs/guides/requirement-to-test.md",
  "docs/cli-reference.md",
  "docs/mcp-installation.md",
  "docs/troubleshooting.md"
];

describe("public documentation", () => {
  it("uses a task-oriented documentation hierarchy", async () => {
    const home = await readFile("docs/README.md", "utf8");
    const quickstart = await readFile("docs/getting-started.md", "utf8");
    const concepts = await readFile("docs/core-concepts.md", "utf8");
    const troubleshooting = await readFile("docs/troubleshooting.md", "utf8");

    expect(home).toContain("## Start Here");
    expect(home).toContain("## Choose A Workflow");
    expect(quickstart).toContain("## Prerequisites");
    expect(quickstart).toContain("## 1. Install");
    expect(quickstart).toContain("## 5. Review The Result");
    expect(concepts).toContain("## Requirement Brain");
    expect(concepts).toContain("## System Brain");
    expect(troubleshooting).toContain("## Find Your Symptom");
    expect(troubleshooting).toContain("npx brain-creator doctor --json");
  });

  it("keeps every local Markdown link resolvable", async () => {
    for (const file of publicDocs) {
      const content = await readFile(file, "utf8");
      const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

      for (const link of links) {
        if (/^(https?:|mailto:|#)/.test(link)) {
          continue;
        }
        const target = decodeURIComponent(link.split("#", 1)[0]);
        if (!target) {
          continue;
        }
        await expect(access(path.resolve(path.dirname(file), target))).resolves.toBeUndefined();
      }
    }
  });

  it("provides a machine-readable documentation index", async () => {
    const content = await readFile("docs/llms.txt", "utf8");

    for (const marker of [
      "Documentation home",
      "Quickstart",
      "Core concepts",
      "Requirement to test",
      "CLI reference",
      "MCP installation",
      "Troubleshooting"
    ]) {
      expect(content).toContain(marker);
    }
  });
});
