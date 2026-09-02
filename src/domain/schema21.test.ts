import { describe, expect, it } from "vitest";
import {
  CURRENT_REPOSITORY_SCHEMA_VERSION,
  InMemoryBrainCreatorRepository,
  shardedRepositoryCollectionKeys
} from "./repository.js";

describe("repository schema 21", () => {
  it("exposes the L3 knowledge, scenario, assurance, and onboarding collections", () => {
    const repository = new InMemoryBrainCreatorRepository();

    expect(CURRENT_REPOSITORY_SCHEMA_VERSION).toBe(21);
    expect(repository.schemaVersion).toBe(21);
    expect(repository.businessObjectModels).toEqual([]);
    expect(repository.decisionTableModels).toEqual([]);
    expect(repository.semanticBindings).toEqual([]);
    expect(repository.businessScenarios).toEqual([]);
    expect(repository.scenarioAssuranceContracts).toEqual([]);
    expect(repository.scenarioTrustRecords).toEqual([]);
    expect(repository.onboardingPlans).toEqual([]);
    expect(repository.evaluationTrials).toEqual([]);
    expect(repository.sourceSnapshots).toEqual([]);
    expect(repository.projectionManifests).toEqual([]);
    expect(repository.interventionRecords).toEqual([]);
    expect(shardedRepositoryCollectionKeys()).toEqual(expect.arrayContaining([
      "businessObjectModels",
      "decisionTableModels",
      "semanticBindings",
      "businessScenarios",
      "scenarioAssuranceContracts",
      "scenarioTrustRecords",
      "onboardingPlans",
      "evaluationTrials",
      "sourceSnapshots",
      "projectionManifests",
      "interventionRecords"
    ]));
  });

  it("does not infer verified or trusted scenario records from legacy executable cases", () => {
    const repository = new InMemoryBrainCreatorRepository();

    expect(repository.scenarioTrustRecords).toEqual([]);
  });
});
