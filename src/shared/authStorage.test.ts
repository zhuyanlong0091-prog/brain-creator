// @vitest-environment node

import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProtectedStorageStatePath } from "./authStorage.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("protected auth storage paths", () => {
  it("accepts workspace-relative storage state and resolves it", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-auth-path-"));
    tempDirs.push(root);
    await mkdir(join(root, ".brain-creator", "auth"), { recursive: true });
    const path = join(root, ".brain-creator", "auth", "state.json");
    await writeFile(path, "{}", "utf8");

    expect(await resolveProtectedStorageStatePath(root, ".brain-creator/auth/state.json")).toBe(path);
  });

  it("rejects lexical traversal and symlinks outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-auth-path-"));
    const outside = await mkdtemp(join(tmpdir(), "brain-auth-outside-"));
    tempDirs.push(root, outside);
    await writeFile(join(outside, "state.json"), "{}", "utf8");
    await expect(resolveProtectedStorageStatePath(root, "../outside/state.json")).rejects.toThrow(
      "must stay inside"
    );
    await symlink(outside, join(root, "linked"), "junction");
    await expect(resolveProtectedStorageStatePath(root, "linked/state.json")).rejects.toThrow(
      "must stay inside"
    );
  });
});
