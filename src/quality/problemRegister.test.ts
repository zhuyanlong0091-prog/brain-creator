// @vitest-environment node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("sanitized execution quality problem register", () => {
  it("tracks all 41 numbered problems with accurate category totals", async () => {
    const content = await readFile(
      join(process.cwd(), "docs", "quality", "problem-register.md"),
      "utf8"
    );
    const ids = [...content.matchAll(/^\| ([A-G]\d+) \|/gm)].map((match) => match[1]);
    const counts = Object.fromEntries(
      [..."ABCDEFG"].map((category) => [
        category,
        ids.filter((id) => id.startsWith(category)).length
      ])
    );

    expect(new Set(ids).size).toBe(41);
    expect(counts).toEqual({ A: 8, B: 5, C: 4, D: 8, E: 7, F: 5, G: 4 });
    expect(content).toContain("| total | 41 |");
  });

  it("does not copy real environment identifiers or credentials", async () => {
    const content = await readFile(
      join(process.cwd(), "docs", "quality", "problem-register.md"),
      "utf8"
    );

    for (const forbidden of ["https://", "password=", "token=", "cookie="]) {
      expect(content).not.toContain(forbidden);
    }
  });
});
