import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHARDED_REPOSITORY_SCHEMA_VERSION,
  shardedRepositoryCollectionKeys
} from "../domain/repository.js";

export type StoreHealth = {
  status: "pass" | "warn" | "fail";
  storeDir: string;
  manifestPath: string;
  legacyPath: string;
  indexPath: string;
  legacyPresent: boolean;
  temporaryFiles: string[];
  message: string;
  remediation?: string;
};

export function inspectStoreHealth(input: {
  storeDir: string;
  legacyPath: string;
}): StoreHealth {
  const manifestPath = join(input.storeDir, "manifest.json");
  const indexPath = join(input.storeDir, "indexes", "asset-index.json");
  const legacyPresent = existsSync(input.legacyPath);
  const temporaryFiles = existsSync(input.storeDir)
    ? readdirSync(input.storeDir, { recursive: true })
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => entry.endsWith(".tmp") || entry.endsWith(".write.lock"))
    : [];

  if (!existsSync(manifestPath)) {
    return {
      status: legacyPresent ? "warn" : "warn",
      storeDir: input.storeDir,
      manifestPath,
      legacyPath: input.legacyPath,
      indexPath,
      legacyPresent,
      temporaryFiles,
      message: legacyPresent
        ? "A legacy local-assets.json is present and will be migrated on the next Brain Creator start."
        : "The schema 17 store has not been initialized yet.",
      remediation: "Start Brain Creator once to initialize or migrate the local store."
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (
      manifest.format !== "sharded" ||
      manifest.schemaVersion !== SHARDED_REPOSITORY_SCHEMA_VERSION ||
      !Array.isArray(manifest.collections) ||
      manifest.collections.length !== shardedRepositoryCollectionKeys().length ||
      shardedRepositoryCollectionKeys().some((key) => !(manifest.collections as unknown[]).includes(key))
    ) {
      return failHealth(input, manifestPath, indexPath, legacyPresent, temporaryFiles, "The sharded manifest is invalid.");
    }
    const missingCollections = shardedRepositoryCollectionKeys().filter(
      (key) => !existsSync(join(input.storeDir, "collections", `${key}.json`))
    );
    if (missingCollections.length > 0) {
      return failHealth(
        input,
        manifestPath,
        indexPath,
        legacyPresent,
        temporaryFiles,
        `The sharded store is missing collection shards: ${missingCollections.join(", ")}.`
      );
    }
  } catch {
    return failHealth(input, manifestPath, indexPath, legacyPresent, temporaryFiles, "The sharded manifest cannot be parsed.");
  }

  if (temporaryFiles.length > 0) {
    return {
      status: "warn",
      storeDir: input.storeDir,
      manifestPath,
      legacyPath: input.legacyPath,
      indexPath,
      legacyPresent,
      temporaryFiles,
      message: "The sharded store contains unfinished temporary or lock files.",
      remediation: "Review the files after confirming no Brain Creator process is running."
    };
  }

  if (!existsSync(indexPath)) {
    return {
      status: "warn",
      storeDir: input.storeDir,
      manifestPath,
      legacyPath: input.legacyPath,
      indexPath,
      legacyPresent,
      temporaryFiles,
      message: "The sharded store index is missing.",
      remediation: "Use the repository index rebuild operation before relying on asset lookup."
    };
  }

  return {
    status: legacyPresent ? "warn" : "pass",
    storeDir: input.storeDir,
    manifestPath,
    legacyPath: input.legacyPath,
    indexPath,
    legacyPresent,
    temporaryFiles,
    message: legacyPresent
      ? "Schema 17 store is healthy, but the legacy source file remains as a migration backup."
      : "Schema 17 sharded store, manifest, and index are healthy.",
    remediation: legacyPresent ? "Keep the legacy file until the migration is accepted, then archive it separately." : undefined
  };
}

function failHealth(
  input: { storeDir: string; legacyPath: string },
  manifestPath: string,
  indexPath: string,
  legacyPresent: boolean,
  temporaryFiles: string[],
  message: string
): StoreHealth {
  return {
    status: "fail",
    storeDir: input.storeDir,
    manifestPath,
    legacyPath: input.legacyPath,
    indexPath,
    legacyPresent,
    temporaryFiles,
    message,
    remediation: "Restore the manifest or recover from the timestamped migration backup before continuing."
  };
}
