import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { chromium, type Browser } from "@playwright/test";

export type ArtifactValidation = {
  status: "valid" | "invalid";
  files: Array<{ path: string; sha256: string }>;
  reasons: string[];
};

export async function validateExecutionArtifacts(
  root: string | undefined,
  references: string[],
  expectedHashes: Record<string, string> = {}
): Promise<ArtifactValidation> {
  const files: ArtifactValidation["files"] = [];
  const reasons: string[] = [];
  if (!root || !references.length) return { status: "invalid", files, reasons: ["Evidence root and artifact references are required."] };
  let browser: Browser | undefined;
  try {
    const ownedRoot = await realpath(root);
    for (const ref of new Set(references)) {
      try {
        const path = await realpath(resolve(ownedRoot, ref));
        const owned = relative(ownedRoot, path);
        if (!owned || owned === ".." || owned.startsWith("../") || owned.startsWith("..\\") || isAbsolute(owned)) throw new Error("outside evidence root");
        const info = await stat(path);
        if (!info.isFile() || info.size === 0 || info.size > 100 * 1024 * 1024) throw new Error("empty or oversized artifact");
        const bytes = await readFile(path);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (expectedHashes[ref] && expectedHashes[ref] !== sha256) throw new Error("artifact hash changed");
        if (/\.(png|jpe?g|webp)$/i.test(path)) {
          const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
            : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg"
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : undefined;
          if (!mime || bytes.length > 20 * 1024 * 1024) throw new Error("unsupported image content");
          browser ??= await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, timeout: 10000 });
          const page = await browser.newPage();
          try {
            const decoded = await page.evaluate(async (url) => {
              const globals = globalThis as unknown as {
                Image: new () => { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number };
              };
              const image = new globals.Image();
              image.src = url;
              return Promise.race([image.decode().then(() => image.naturalWidth > 0 && image.naturalHeight > 0).catch(() => false), new Promise<boolean>((done) => setTimeout(() => done(false), 5000))]);
            }, `data:${mime};base64,${bytes.toString("base64")}`);
            if (!decoded) throw new Error("image cannot be decoded");
          } finally { await page.close(); }
        } else if (/trace[^/\\]*\.zip$/i.test(path)) {
          const entries = new AdmZip(bytes).getEntries().filter((entry) => entry.entryName.endsWith(".trace"));
          if (!entries.length || entries.reduce((total, entry) => total + entry.header.size, 0) > 100 * 1024 * 1024) throw new Error("missing or oversized trace events");
          for (const entry of entries) {
            const lines = entry.getData().toString("utf8").split(/\r?\n/).filter(Boolean);
            if (!lines.length || lines.some((line) => typeof JSON.parse(line)?.type !== "string")) throw new Error("invalid trace events");
          }
        }
        files.push({ path: ref, sha256 });
      } catch (error) {
        reasons.push(`Invalid artifact ${ref}: ${error instanceof Error ? error.message : "unreadable"}`);
      }
    }
  } catch { reasons.push("Evidence root is unavailable."); }
  finally { await browser?.close(); }
  return { status: reasons.length ? "invalid" : "valid", files, reasons };
}
