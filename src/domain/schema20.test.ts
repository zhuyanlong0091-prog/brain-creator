import { describe, expect, it } from "vitest";
import {
  CURRENT_REPOSITORY_SCHEMA_VERSION,
  InMemoryBrainCreatorRepository,
  shardedRepositoryCollectionKeys
} from "./repository.js";

describe("repository schema 20", () => {
  it("exposes the L3 knowledge, scenario, assurance, and onboarding collections", () => {
    const repository = new InMemoryBrainCreatorRepository();

    expect(CURRENT_REPOSITORY_SCHEMA_VERSION).toBe(20);
    expect(repository.schemaVersion).toBe(20);
    expect(repository.businessObjectModels).toEqual([]);
    expect(repository.decisionTableModels).toEqual([]);
    expect(repository.semanticBindings).toEqual([]);
    expect(repository.businessScenarios).toEqual([]);
    expect(repository.scenarioAssuranceContracts).toEqual([]);
    expect(repository.scenarioTrustRecords).toEqual([]);
    expect(repository.onboardingPlans).toEqual([]);
    expect(shardedRepositoryCollectionKeys()).toEqual(expect.arrayContaining([
      "businessObjectModels",
      "decisionTableModels",
      "semanticBindings",
      "businessScenarios",
      "scenarioAssuranceContracts",
      "scenarioTrustRecords",
      "onboardingPlans"
    ]));
  });

  it("does not infer verified or trusted scenario records from legacy executable cases", () => {
    const repository = new InMemoryBrainCreatorRepository();

    expect(repository.scenarioTrustRecords).toEqual([]);
  });
});
