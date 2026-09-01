import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicDocs = [
  "README.md",
  "docs/index.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/core-concepts.md",
  "docs/guides/requirement-to-test.md",
  "docs/guides/testcase-testdata-brain.md",
  "docs/cli-reference.md",
  "docs/mcp-installation.md",
  "docs/troubleshooting.md",
  "docs/zh-CN/index.md",
  "docs/zh-CN/getting-started.md",
  "docs/zh-CN/core-concepts.md",
  "docs/zh-CN/guides/requirement-to-test.md",
  "docs/zh-CN/guides/testcase-testdata-brain.md",
  "docs/zh-CN/agent-usage.md",
  "docs/zh-CN/e2e-session-resume-workflow.md",
  "docs/zh-CN/cli-reference.md",
  "docs/zh-CN/mcp-installation.md",
  "docs/zh-CN/troubleshooting.md",
  "docs/zh-CN/release-checklist.md"
];

const localizedPairs = [
  ["docs/index.md", "docs/zh-CN/index.md"],
  ["docs/getting-started.md", "docs/zh-CN/getting-started.md"],
  ["docs/core-concepts.md", "docs/zh-CN/core-concepts.md"],
  ["docs/guides/requirement-to-test.md", "docs/zh-CN/guides/requirement-to-test.md"],
  ["docs/guides/testcase-testdata-brain.md", "docs/zh-CN/guides/testcase-testdata-brain.md"],
  ["docs/agent-usage.md", "docs/zh-CN/agent-usage.md"],
  ["docs/e2e-session-resume-workflow.md", "docs/zh-CN/e2e-session-resume-workflow.md"],
  ["docs/cli-reference.md", "docs/zh-CN/cli-reference.md"],
  ["docs/mcp-installation.md", "docs/zh-CN/mcp-installation.md"],
  ["docs/troubleshooting.md", "docs/zh-CN/troubleshooting.md"],
  ["docs/release-checklist.md", "docs/zh-CN/release-checklist.md"]
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
        await expect(access(resolveDocumentationLink(file, target))).resolves.toBeUndefined();
      }
    }
  });

  it("keeps a complete Simplified Chinese primary documentation tree", async () => {
    for (const [english, chinese] of localizedPairs) {
      await expect(access(english)).resolves.toBeUndefined();
      await expect(access(chinese)).resolves.toBeUndefined();
      expect((await readFile(chinese, "utf8")).trim().length).toBeGreaterThan(300);
    }
  });

  it("configures bilingual local search and GitHub Pages deployment", async () => {
    const config = await readFile("docs/.vitepress/config.ts", "utf8");
    const workflow = await readFile(".github/workflows/docs.yml", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(config).toContain('base: "/brain-creator/"');
    expect(config).toContain('provider: "local"');
    expect(config).toContain('"zh-CN"');
    expect(config).toContain("/zh-CN/getting-started");
    expect(workflow).toContain("npm run docs:build");
    expect(workflow).toContain("actions/upload-pages-artifact@v4");
    expect(workflow).toContain("actions/deploy-pages@v4");
    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(packageJson.scripts["docs:dev"]).toBe("vitepress dev docs");
    expect(packageJson.scripts["docs:build"]).toBe("vitepress build docs");
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

function resolveDocumentationLink(sourceFile: string, target: string) {
  if (!target.startsWith("/")) {
    return path.resolve(path.dirname(sourceFile), target);
  }

  const relative = target.replace(/^\//, "").replace(/\/$/, "");
  if (!relative) {
    return path.resolve("docs/index.md");
  }

  const candidate = path.resolve("docs", relative);
  return path.extname(candidate) ? candidate : `${candidate}.md`;
}
