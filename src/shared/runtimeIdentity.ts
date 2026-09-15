import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BRAIN_CREATOR_VERSION } from "../version.js";

type BuildIdentity = {
  packageVersion: string;
  commit: string;
  buildId: string;
  builtAt: string;
  dirty: boolean | "unknown";
};

export type RuntimeIdentityContext = {
  workspace: string;
  schemaVersion: number;
  provider: string;
  processKind?: "mcp" | "cli";
};

export function createRuntimeIdentityReader(options: { metadataPath?: string } = {}) {
  let build: BuildIdentity = {
    packageVersion: BRAIN_CREATOR_VERSION,
    commit: "unknown", buildId: "unknown", builtAt: "unknown", dirty: "unknown"
  };
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  try {
    if (!options.metadataPath && import.meta.url.endsWith(".ts")) {
      const cwd = fileURLToPath(new URL("../../", import.meta.url));
      const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      const commit = git(["rev-parse", "HEAD"]);
      const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=normal"]));
      build = { ...build, commit, dirty, buildId: `source:${commit}${dirty ? ":dirty" : ""}` };
    } else {
      const value = JSON.parse(readFileSync(options.metadataPath ?? new URL("../build-identity.json", import.meta.url), "utf8"));
      if (typeof value.packageVersion === "string" && (value.commit === "unknown" || /^[a-f0-9]{40,64}$/.test(value.commit)) &&
          typeof value.buildId === "string" && typeof value.builtAt === "string" && (typeof value.dirty === "boolean" || value.dirty === "unknown")) {
        build = { packageVersion: value.packageVersion, commit: value.commit, buildId: value.buildId, builtAt: value.builtAt, dirty: value.dirty };
      }
    }
  } catch { /* Legacy packages without build provenance remain explicitly unknown. */ }
  const pinned = Object.freeze(build);
  return (context: RuntimeIdentityContext) => ({ ...pinned, pid: process.pid, startedAt, ...context, processKind: context.processKind ?? "cli" });
}

// Capture once, before hot configuration reloads or an on-disk package upgrade.
export const readRuntimeIdentity = createRuntimeIdentityReader();
