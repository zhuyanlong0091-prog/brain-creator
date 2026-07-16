import { join, resolve } from "node:path";

type WorkspaceEnv = {
  BRAIN_CREATOR_WORKSPACE?: string;
  BRAIN_CREATOR_DATA_FILE?: string;
  BRAIN_CREATOR_KNOWLEDGE_DIR?: string;
};

export function resolveBrainCreatorWorkspace(
  cwd = process.cwd(),
  env: WorkspaceEnv = process.env
) {
  return resolve(env.BRAIN_CREATOR_WORKSPACE ?? cwd);
}

export function resolveBrainCreatorDataFile(
  cwd = process.cwd(),
  env: WorkspaceEnv = process.env
) {
  if (env.BRAIN_CREATOR_DATA_FILE) {
    return resolve(env.BRAIN_CREATOR_DATA_FILE);
  }
  return join(resolveBrainCreatorWorkspace(cwd, env), ".brain-creator", "local-assets.json");
}

export function resolveBrainCreatorKnowledgeDir(
  cwd = process.cwd(),
  env: WorkspaceEnv = process.env
) {
  if (env.BRAIN_CREATOR_KNOWLEDGE_DIR) {
    return resolve(env.BRAIN_CREATOR_KNOWLEDGE_DIR);
  }
  return join(resolveBrainCreatorWorkspace(cwd, env), ".brain-creator", "knowledge");
}
