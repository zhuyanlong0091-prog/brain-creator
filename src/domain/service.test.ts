import { describe, expect, it } from "vitest";
import { BrainCreatorService } from "./service";
import { InMemoryBrainCreatorRepository } from "./repository";

function createService() {
  return new BrainCreatorService(new InMemoryBrainCreatorRepository());
}

describe("BrainCreatorService", () => {
  it("redacts auth secrets in returned profiles", () => {
    const service = createService();

    const profile = service.createAuthProfile({
      projectId: "project-1",
      env: "test",
      role: "qa-admin",
      loginMethod: "token",
      secrets: {
        token: "secret-token"
      }
    });

    expect(profile.encryptedSecrets.token).toBe("[REDACTED]");
    expect(profile.status).toBe("pending");
  });

  it("discovers a page model with locator points and probe result", () => {
    const service = createService();
    const profile = service.createAuthProfile({
      projectId: "project-1",
      env: "test",
      role: "qa-admin",
      loginMethod: "cookie",
      secrets: {
        cookie: "session=abc"
      }
    });

    const result = service.discoverPageModel({
      projectId: "project-1",
      route: "/orders",
      name: "Orders",
      authProfileId: profile.id,
      domText: "Create Order Submit Search"
    });

    expect(result.pageModel.status).toBe("succeeded");
    expect(result.locatorPoints.map((point) => point.name)).toEqual([
      "Create Order",
      "Submit",
      "Search"
    ]);
    expect(result.probeResult.issues).toEqual([]);
  });

  it("creates a gap instead of hallucinating generated steps without locators", () => {
    const service = createService();

    const generated = service.generateCase({
      projectId: "project-1",
      sourceRequirement: "Create a payroll approval",
      pageModelId: "missing-page"
    });

    expect(generated.status).toBe("blocked");
    expect(generated.steps).toEqual([]);
    expect(generated.gaps).toHaveLength(1);
    expect(generated.gaps[0].reason).toContain("No locator evidence");
  });

  it("searches assets across page models, locators, sessions, api flows, cases, and gaps", () => {
    const service = createService();
    const profile = service.createAuthProfile({
      projectId: "project-1",
      env: "test",
      role: "qa-admin",
      loginMethod: "token",
      secrets: {
        token: "secret-token"
      }
    });
    const discovery = service.discoverPageModel({
      projectId: "project-1",
      route: "/orders",
      name: "Orders",
      authProfileId: profile.id,
      domText: "Create Order Submit"
    });
    const session = service.createTrainingSession({
      projectId: "project-1",
      pageModelId: discovery.pageModel.id
    });
    service.completeTrainingSession({
      sessionId: session.id,
      actions: [
        {
          type: "click",
          targetLocatorId: discovery.locatorPoints[0].id,
          inputValue: "",
          assertion: "order form opens"
        }
      ],
      apiRequests: [
        {
          method: "POST",
          url: "/api/orders",
          status: 201
        }
      ]
    });
    service.generateCase({
      projectId: "project-1",
      sourceRequirement: "Create Order",
      pageModelId: discovery.pageModel.id
    });

    const assets = service.searchAssets({
      projectId: "project-1",
      query: "order"
    });

    expect(assets.map((asset) => asset.type)).toEqual(
      expect.arrayContaining([
        "page-model",
        "locator-point",
        "training-session",
        "api-flow",
        "generated-case"
      ])
    );
  });
});
