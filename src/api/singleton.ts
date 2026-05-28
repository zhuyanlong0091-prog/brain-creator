import { join } from "node:path";
import {
  InMemoryBrainCreatorRepository,
  JsonFileBrainCreatorRepository
} from "@/src/domain/repository";
import { BrainCreatorService } from "@/src/domain/service";

let repository = createDefaultRepository();
let service = new BrainCreatorService(repository);

export function getBrainCreatorService() {
  if (!process.env.VITEST) {
    return new BrainCreatorService(createDefaultRepository());
  }
  return service;
}

export function resetBrainCreatorService() {
  repository = new InMemoryBrainCreatorRepository();
  service = new BrainCreatorService(repository);
}

function createDefaultRepository() {
  if (process.env.VITEST) {
    return new InMemoryBrainCreatorRepository();
  }
  return new JsonFileBrainCreatorRepository(
    process.env.BRAIN_CREATOR_ASSET_STORE ??
      join(process.cwd(), ".brain-creator", "local-assets.json")
  );
}
