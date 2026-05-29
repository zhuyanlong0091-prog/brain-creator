import { describe, expect, it } from "vitest";
import { BrainCreatorService } from "./service.js";
import { InMemoryBrainCreatorRepository } from "./repository.js";

function createService() {
  return new BrainCreatorService(new InMemoryBrainCreatorRepository());
}

describe("BrainCreatorService", () => {
  it("creates business systems that can be reused as isolated onboarding contexts", () => {
    const service = createService();

    const ordersSystem = service.createSystemProfile({
      name: "Orders Console",
      environment: "staging",
      baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
      defaultLocale: "zh-CN",
      urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
    });
    const crmSystem = service.createSystemProfile({
      name: "CRM Console",
      environment: "test",
      baseUrl: "https://crm.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://crm.example.test"]
    });

    expect(ordersSystem).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^system_/),
        name: "Orders Console",
        environment: "staging",
        status: "succeeded"
      })
    );
    expect(service.listSystemProfiles().map((system) => system.name)).toEqual([
      "Orders Console",
      "CRM Console"
    ]);
    expect(crmSystem.id).not.toBe(ordersSystem.id);
  });

  it("prevents page modeling and case generation from crossing business systems", () => {
    const service = createService();
    const ordersSystem = service.createSystemProfile({
      name: "Orders Console",
      environment: "staging",
      baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
      defaultLocale: "zh-CN",
      urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
    });
    const crmSystem = service.createSystemProfile({
      name: "CRM Console",
      environment: "test",
      baseUrl: "https://crm.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://crm.example.test"]
    });
    const auth = service.createAuthProfile({
      projectId: ordersSystem.id,
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    const discovery = service.discoverPageModel({
      projectId: ordersSystem.id,
      route: "/orders",
      name: "Orders",
      authProfileId: auth.id,
      domText: "Create Order Submit Search"
    });

    expect(() =>
      service.discoverPageModel({
        projectId: crmSystem.id,
        route: "/crm",
        name: "CRM",
        authProfileId: auth.id,
        domText: "Create"
      })
    ).toThrow("Auth profile belongs to another business system");
    expect(() =>
      service.generateCase({
        projectId: crmSystem.id,
        sourceRequirement: "Create Order",
        pageModelId: discovery.pageModel.id
      })
    ).toThrow("Page model belongs to another business system");
  });

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

  it("keeps auth secrets available for browser capture without returning them", () => {
    const service = createService();
    const profile = service.createAuthProfile({
      projectId: "project-1",
      env: "test",
      role: "qa-admin",
      loginMethod: "token",
      secrets: {
        token: "private-token"
      }
    });

    const captureAuth = service.getCaptureAuth(profile.id);

    expect(profile.encryptedSecrets.token).toBe("[REDACTED]");
    expect(captureAuth).toEqual({
      loginMethod: "token",
      secrets: {
        token: "private-token"
      }
    });
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

  it("discovers a page model from browser capture evidence", () => {
    const service = createService();

    const result = service.discoverPageModel({
      projectId: "project-1",
      route: "/orders",
      name: "Orders",
      authProfileId: "auth_1",
      domText: "",
      captureMode: "browser",
      targetUrl: "http://127.0.0.1:3000/fixtures/model-target",
      browserCapture: {
        title: "Orders Fixture",
        finalUrl: "http://127.0.0.1:3000/fixtures/model-target",
        domText: "Orders Create Order Search",
        screenshotPath: "C:/tmp/orders.png",
        interactiveElements: [
          {
            name: "Create Order",
            role: "button",
            text: "Create Order",
            selector: "[data-brain-label=\"create-order\"]"
          },
          {
            name: "Search orders",
            role: "textbox",
            text: "Search orders",
            selector: "input[name=\"orders-search\"]"
          }
        ],
        consoleErrors: ["fixture console failure"],
        networkFailures: ["GET http://127.0.0.1:3000/missing.js"],
        issues: []
      }
    });

    expect(result.pageModel.route).toBe("http://127.0.0.1:3000/fixtures/model-target");
    expect(result.pageModel.name).toBe("Orders Fixture");
    expect(result.pageModel.screenshotId).toBe("C:/tmp/orders.png");
    expect(result.locatorPoints.map((point) => point.name)).toEqual([
      "Create Order",
      "Search orders"
    ]);
    expect(result.probeResult.type).toBe("browser-capture");
    expect(result.probeResult.issues).toEqual([
      "Console error: fixture console failure",
      "Network failure: GET http://127.0.0.1:3000/missing.js"
    ]);
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

  it("summarizes onboarding completeness for a business system", () => {
    const service = createService();
    const system = service.createSystemProfile({
      name: "Orders Console",
      environment: "staging",
      baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
      defaultLocale: "zh-CN",
      urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
    });
    const profile = service.createAuthProfile({
      projectId: system.id,
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    const discovery = service.discoverPageModel({
      projectId: system.id,
      route: "/orders",
      name: "Orders",
      authProfileId: profile.id,
      domText: "Create Order Submit"
    });
    const session = service.createTrainingSession({
      projectId: system.id,
      pageModelId: discovery.pageModel.id
    });
    service.completeTrainingSession({
      sessionId: session.id,
      actions: [
        {
          type: "click",
          targetLocatorId: discovery.locatorPoints[0].id,
          inputValue: "",
          assertion: "request captured"
        }
      ],
      apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }]
    });
    service.generateCase({
      projectId: system.id,
      sourceRequirement: "Unknown approval path",
      pageModelId: discovery.pageModel.id
    });

    const overview = service.getSystemOverview(system.id);

    expect(overview.completeness).toEqual({
      authConfigured: true,
      pageModeled: true,
      trainingEvidence: true,
      caseGenerated: true,
      openGaps: 1
    });
    expect(overview.assetCounts).toEqual(
      expect.objectContaining({
        pageModels: 1,
        locatorPoints: 2,
        trainingSessions: 1,
        apiFlows: 1,
        generatedCases: 1,
        gaps: 1
      })
    );
  });

  it("returns page model asset details with linked evidence inside the same system", () => {
    const service = createService();
    const system = service.createSystemProfile({
      name: "Orders Console",
      environment: "staging",
      baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
      defaultLocale: "zh-CN",
      urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
    });
    const profile = service.createAuthProfile({
      projectId: system.id,
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    const discovery = service.discoverPageModel({
      projectId: system.id,
      route: "/orders",
      name: "Orders",
      authProfileId: profile.id,
      domText: "Create Order Submit"
    });
    const session = service.createTrainingSession({
      projectId: system.id,
      pageModelId: discovery.pageModel.id
    });
    service.completeTrainingSession({
      sessionId: session.id,
      actions: [
        {
          type: "click",
          targetLocatorId: discovery.locatorPoints[0].id,
          inputValue: "",
          assertion: "request captured"
        }
      ],
      apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }]
    });

    const detail = service.getAssetDetail({
      projectId: system.id,
      type: "page-model",
      id: discovery.pageModel.id
    });

    expect(detail.asset).toEqual(expect.objectContaining({ id: discovery.pageModel.id }));
    expect(detail.related.locatorPoints).toHaveLength(2);
    expect(detail.related.probeResults).toHaveLength(1);
    expect(detail.related.trainingSessions).toHaveLength(1);
    expect(detail.related.apiFlows).toHaveLength(1);
  });

  it("stores browser training artifacts on completion", () => {
    const service = createService();
    const session = service.createTrainingSession({
      projectId: "project-1",
      pageModelId: "page_1"
    });

    const completed = service.completeTrainingSession({
      sessionId: session.id,
      actions: [
        {
          type: "click",
          targetLocatorId: "locator_1",
          inputValue: "",
          assertion: "request captured"
        }
      ],
      apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }],
      artifacts: {
        traceUrl: "C:/tmp/trace.zip",
        harUrl: "C:/tmp/network.har",
        screenshotUrl: "C:/tmp/screenshot.png"
      }
    });

    expect(completed.session.status).toBe("succeeded");
    expect(completed.session.traceUrl).toBe("C:/tmp/trace.zip");
    expect(completed.session.harUrl).toBe("C:/tmp/network.har");
    expect(completed.session.screenshotUrl).toBe("C:/tmp/screenshot.png");
    expect(completed.apiFlow.requests[0]).toEqual({
      method: "POST",
      url: "/api/orders",
      status: 201
    });
  });

  it("creates a training gap when browser recording has no API requests", () => {
    const service = createService();
    const session = service.createTrainingSession({
      projectId: "project-1",
      pageModelId: "page_1"
    });

    const completed = service.completeTrainingSession({
      sessionId: session.id,
      actions: [
        {
          type: "click",
          targetLocatorId: "locator_1",
          inputValue: "",
          assertion: "request captured"
        }
      ],
      apiRequests: [],
      artifacts: {
        traceUrl: "C:/tmp/trace.zip",
        harUrl: "C:/tmp/network.har",
        screenshotUrl: "C:/tmp/screenshot.png"
      }
    });

    expect(completed.session.status).toBe("failed");
    expect(completed.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "training-session",
          sourceId: session.id,
          reason: "No API requests captured during training"
        })
      ])
    );
  });

  it("marks training failed when browser recording cannot run", () => {
    const service = createService();
    const session = service.createTrainingSession({
      projectId: "project-1",
      pageModelId: "page_1"
    });

    const failed = service.failTrainingSession(session.id, "Training action selector is required");

    expect(failed.session.status).toBe("failed");
    expect(failed.gap).toEqual(
      expect.objectContaining({
        sourceType: "training-session",
        sourceId: session.id,
        reason: "Training action selector is required"
      })
    );
  });

  it("creates glossary terms and returns them from asset search", () => {
    const service = createService();

    const term = service.createGlossaryTerm({
      projectId: "project-1",
      key: "order.submit",
      zhCN: "提交订单",
      enUS: "Submit order",
      aliases: ["下单", "Create Order"],
      pageScope: "/orders"
    });

    expect(term.key).toBe("order.submit");
    expect(term.aliases).toEqual(["下单", "Create Order"]);

    const assets = service.searchAssets({
      projectId: "project-1",
      query: "submit"
    });

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: term.id,
          type: "glossary-term",
          label: "order.submit"
        })
      ])
    );
  });

  it("lists glossary terms by project and query", () => {
    const service = createService();
    service.createGlossaryTerm({
      projectId: "project-1",
      key: "order.submit",
      zhCN: "提交订单",
      enUS: "Submit order",
      aliases: ["下单"],
      pageScope: "/orders"
    });
    service.createGlossaryTerm({
      projectId: "project-2",
      key: "invoice.submit",
      zhCN: "提交发票",
      enUS: "Submit invoice",
      aliases: [],
      pageScope: "/invoices"
    });

    const terms = service.listGlossaryTerms({
      projectId: "project-1",
      query: "下单"
    });

    expect(terms).toHaveLength(1);
    expect(terms[0].key).toBe("order.submit");
  });
});
