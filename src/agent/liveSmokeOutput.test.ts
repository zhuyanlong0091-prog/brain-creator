import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractMarkdown, extractTypeScript, extractTypeScriptArtifact } from "./liveSmokeOutput.js";

describe("live smoke output parsing", () => {
  it("extracts TypeScript from fenced code", () => {
    const output = [
      "Here is the file:",
      "```ts",
      "import { test, expect } from '@playwright/test';",
      "test('order total', async ({ page }) => {",
      "  await expect(page.getByText('Order total: 42')).toBeVisible();",
      "});",
      "```"
    ].join("\n");

    expect(extractTypeScript(output)).toContain("import { test, expect } from '@playwright/test';");
  });

  it("extracts TypeScript from the first import line and discards surrounding prose", () => {
    const output = [
      "The generator created a test.",
      "import { test, expect } from '@playwright/test';",
      "test('order total', async ({ page }) => {",
      "  await expect(page.getByText('Order total: 42')).toBeVisible();",
      "});",
      "Done."
    ].join("\n");

    const source = extractTypeScript(output);

    expect(source.startsWith("import { test, expect } from '@playwright/test';")).toBe(true);
    expect(source).not.toContain("The generator created a test.");
  });

  it("rejects prose that merely mentions Playwright without returning a test file", () => {
    const output = [
      "The playwright-test-generator successfully created the complete TypeScript Playwright test file.",
      "- Imports `test` and `expect` from `@playwright/test`",
      "- Asserts `Order total: 42`"
    ].join("\n");

    expect(() => extractTypeScript(output)).toThrow("No TypeScript Playwright source found");
  });

  it("reads TypeScript from the expected artifact when stdout is prose-only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "brain-creator-live-output-"));
    const outputPath = join(directory, "generated.spec.ts");
    await writeFile(
      outputPath,
      [
        "import { test, expect } from '@playwright/test';",
        "test('order total', async ({ page }) => {",
        "  await expect(page.getByText('Order total: 42')).toBeVisible();",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );

    const source = await extractTypeScriptArtifact(
      "The playwright-test-generator successfully generated the test file.",
      outputPath
    );

    expect(source).toContain("import { test, expect } from '@playwright/test';");
  });

  it("extracts Markdown from fenced markdown", () => {
    expect(extractMarkdown("```markdown\n# Brain Creator\n```")).toBe("# Brain Creator\n");
  });
});
