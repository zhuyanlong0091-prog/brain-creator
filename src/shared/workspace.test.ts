import { afterEach, describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorKnowledgeDir,
  resolveBrainCreatorWorkspace
} from "./workspace.js";

const previousWorkspace = process.env.BRAIN_CREATOR_WORKSPACE;
const previousDataFile = process.env.BRAIN_CREATOR_DATA_FILE;
const previousKnowledgeDir = process.env.BRAIN_CREATOR_KNOWLEDGE_DIR;

afterEach(() => {
  restoreEnv("BRAIN_CREATOR_WORKSPACE", previousWorkspace);
  restoreEnv("BRAIN_CREATOR_DATA_FILE", previousDataFile);
  restoreEnv("BRAIN_CREATOR_KNOWLEDGE_DIR", previousKnowledgeDir);
});

describe("Brain Creator workspace resolution", () => {
  it("uses BRAIN_CREATOR_WORKSPACE when it is configured", () => {
    process.env.BRAIN_CREATOR_WORKSPACE = "fixtures/business-app";

    expect(resolveBrainCreatorWorkspace("ignored")).toBe(
      resolve("fixtures/business-app")
    );
  });

  it("uses the current process directory when no workspace override exists", () => {
    delete process.env.BRAIN_CREATOR_WORKSPACE;

    expect(resolveBrainCreatorWorkspace("caller-project")).toBe(
      resolve("caller-project")
    );
  });

  it("stores local assets under the resolved workspace by default", () => {
    delete process.env.BRAIN_CREATOR_DATA_FILE;
    process.env.BRAIN_CREATOR_WORKSPACE = "business-workspace";

    expect(resolveBrainCreatorDataFile("ignored")).toBe(
      join(resolve("business-workspace"), ".brain-creator", "local-assets.json")
    );
  });

  it("uses BRAIN_CREATOR_DATA_FILE when it is configured", () => {
    process.env.BRAIN_CREATOR_DATA_FILE = "custom/assets.json";

    expect(resolveBrainCreatorDataFile("business-workspace")).toBe(
      resolve("custom/assets.json")
    );
  });

  it("stores generated knowledge under the resolved workspace by default", () => {
    delete process.env.BRAIN_CREATOR_KNOWLEDGE_DIR;

    expect(resolveBrainCreatorKnowledgeDir("business-workspace")).toBe(
      join(resolve("business-workspace"), ".brain-creator", "knowledge")
    );
  });

  it("uses BRAIN_CREATOR_KNOWLEDGE_DIR when it is configured", () => {
    process.env.BRAIN_CREATOR_KNOWLEDGE_DIR = "external-vault";

    expect(resolveBrainCreatorKnowledgeDir("business-workspace")).toBe(resolve("external-vault"));
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
