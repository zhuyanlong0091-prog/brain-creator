import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const packageInfo = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const hash = createHash("sha256");
async function digest(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await digest(path);
    else if (entry.name !== "build-identity.json") hash.update(relative(dist, path).replaceAll("\\", "/")).update("\0").update(await readFile(path)).update("\0");
  }
}
await digest(dist);
let commit = "unknown";
let dirty = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
} catch { /* Source exports may not contain Git metadata. */ }
await writeFile(join(dist, "build-identity.json"), JSON.stringify({ packageVersion: packageInfo.version, commit, dirty, buildId: hash.digest("hex"), builtAt: new Date().toISOString() }, null, 2) + "\n");
