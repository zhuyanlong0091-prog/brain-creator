// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrainCreatorService } from "./service";
import { JsonFileBrainCreatorRepository } from "./repository";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonFileBrainCreatorRepository", () => {
  it("restores page assets after the service is recreated", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    firstService.discoverPageModel({
      projectId: "project-1",
      route: "/orders",
      name: "Orders",
      authProfileId: "auth_1",
      domText: "Create Order Submit"
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(
      secondService.searchAssets({
        projectId: "project-1",
        query: "order"
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "page-model" })]));
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-repository-"));
  tempDirs.push(dir);
  return dir;
}
