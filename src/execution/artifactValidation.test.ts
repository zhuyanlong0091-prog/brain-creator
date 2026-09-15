import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { chromium } from "@playwright/test";
import { validateExecutionArtifacts } from "./artifactValidation.js";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function workspace() { const dir = await mkdtemp(join(tmpdir(), "bc-artifact-check-")); directories.push(dir); return dir; }

it("accepts a browser screenshot and trace and detects later replacement", async () => {
  const dir = await workspace();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.setContent("<main>Order approved</main>");
    await page.screenshot({ path: join(dir, "approved.png") });
    await context.tracing.stop({ path: join(dir, "trace.zip") });
    await context.close();
  } finally { await browser.close(); }
  const result = await validateExecutionArtifacts(dir, ["approved.png", "trace.zip"]);
  expect(result.reasons).toEqual([]);
  expect(result.status).toBe("valid");
  const hashes = Object.fromEntries(result.files.map((file) => [file.path, file.sha256]));
  await writeFile(join(dir, "approved.png"), "replacement");
  const changed = await validateExecutionArtifacts(dir, ["approved.png", "trace.zip"], hashes);
  expect(changed.status).toBe("invalid");
  expect(changed.reasons).toContain("Invalid artifact approved.png: artifact hash changed");
}, 30000);

it("rejects missing files, fake images and traces, and paths outside the run directory", async () => {
  const dir = await workspace();
  await writeFile(join(dir, "fake.png"), "not an image");
  await writeFile(join(dir, "trace.zip"), "not a trace");
  const result = await validateExecutionArtifacts(dir, ["missing.png", "fake.png", "trace.zip", "../outside.png"]);
  expect(result.status).toBe("invalid");
  expect(result.reasons).toHaveLength(4);
});

it("validates readable trace content and rejects a changed captured hash", async () => {
  const dir = await workspace();
  const zip = new AdmZip();
  zip.addFile("test.trace", Buffer.from('{"type":"context-options","version":8}\n'));
  zip.writeZip(join(dir, "trace.zip"));
  const result = await validateExecutionArtifacts(dir, ["trace.zip"]);
  expect(result.status).toBe("valid");
  expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await validateExecutionArtifacts(dir, ["trace.zip"], { "trace.zip": "0".repeat(64) })).status).toBe("invalid");
});
