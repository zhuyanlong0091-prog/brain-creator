import { InMemoryBrainCreatorRepository } from "@/src/domain/repository";
import { BrainCreatorService } from "@/src/domain/service";

let repository = new InMemoryBrainCreatorRepository();
let service = new BrainCreatorService(repository);

export function getBrainCreatorService() {
  return service;
}

export function resetBrainCreatorService() {
  repository = new InMemoryBrainCreatorRepository();
  service = new BrainCreatorService(repository);
}
