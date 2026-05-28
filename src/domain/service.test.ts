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
