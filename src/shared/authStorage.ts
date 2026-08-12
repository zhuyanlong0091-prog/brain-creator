import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export async function resolveProtectedStorageStatePath(
  workspace: string,
  storageStatePath: string
) {
  const root = resolve(workspace);
  const candidate = isAbsolute(storageStatePath)
    ? resolve(storageStatePath)
    : resolve(root, storageStatePath);
  assertInside(root, candidate);

  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate).catch(() => candidate);
  assertInside(canonicalRoot, canonicalCandidate);
  return canonicalCandidate;
}

function assertInside(root: string, candidate: string) {
  const offset = relative(root, candidate);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Auth storage state must stay inside the Brain Creator workspace");
  }
}
