import { join, resolve } from "node:path";

export function resolveBrainCreatorWorkspace(cwd = process.cwd()) {
  return resolve(process.env.BRAIN_CREATOR_WORKSPACE ?? cwd);
}

export function resolveBrainCreatorDataFile(cwd = process.cwd()) {
  if (process.env.BRAIN_CREATOR_DATA_FILE) {
    return resolve(process.env.BRAIN_CREATOR_DATA_FILE);
  }
  return join(resolveBrainCreatorWorkspace(cwd), ".brain-creator", "local-assets.json");
}
