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

  it("redacts protected values from bug reports and gap lifecycle notes", () => {
    const service = createService();
    const system = service.createSystemProfile({
      name: "Orders Console",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    service.createAuthProfile({
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "bug-token-123" }
    });

    const bug = service.createBugReport({
      systemId: system.id,
      sourceId: "case-1",
      caseNo: "TC-001",
      caseTitle: "Create order",
      module: "Orders",
      priority: "P1",
      expectedResult: "No secret should be shown",
      actualResult: "token=bug-token-123",
      reproductionSteps: ["Submit token=bug-token-123"],
      evidencePaths: [],
      gapIds: []
    });
    expect(bug.actualResult).toBe("token=[REDACTED]");
    expect(bug.reproductionSteps).toEqual(["Submit token=[REDACTED]"]);

    const gap = service.reportGap({
      projectId: system.id,
      sourceType: "execution",
      sourceId: "case-1",
      reason: "token=bug-token-123",
      severity: "high",
      owner: "qa"
    });
    const transitioned = service.transitionGap({
      gapId: gap.id,
      projectId: system.id,
      operation: "resolve",
      note: "Resolved after token=bug-token-123 was removed",
      evidenceRefs: []
    });
    expect(transitioned.reason).toBe("token=[REDACTED]");
    expect(transitioned.lifecycle?.at(-1)?.note).toContain("token=[REDACTED]");
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

  it("updates and deletes glossary terms inside one business system", () => {
    const service = createService();
    const term = service.createGlossaryTerm({
      projectId: "system-1",
      key: "order.submit",
      zhCN: "Submit order",
      enUS: "Submit order",
      aliases: ["checkout"],
      pageScope: "/orders"
    });
    service.createGlossaryTerm({
      projectId: "system-2",
      key: "crm.lead",
      zhCN: "Lead",
      enUS: "Lead",
      aliases: [],
      pageScope: "/leads"
    });

    const updated = service.updateGlossaryTerm({
      projectId: "system-1",
      termId: term.id,
      key: "checkout.submit",
      zhCN: "Submit checkout",
      enUS: "Submit checkout",
      aliases: ["place order"],
      pageScope: "/checkout"
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: term.id,
        key: "checkout.submit",
        aliases: ["place order"],
        pageScope: "/checkout"
      })
    );
    expect(() =>
      service.updateGlossaryTerm({
        projectId: "system-2",
        termId: term.id,
        key: "wrong.system",
        zhCN: "Wrong",
        enUS: "Wrong",
        aliases: [],
        pageScope: "/"
      })
    ).toThrow("Glossary term belongs to another business system");

    const deleted = service.deleteGlossaryTerm({
      projectId: "system-1",
      termId: term.id
    });

    expect(deleted.id).toBe(term.id);
    expect(service.listGlossaryTerms({ projectId: "system-1", query: "" })).toEqual([]);
  });

  it("confirms planner-discovered terms into the system glossary", () => {
    const service = createService();
    const testCase = service.createTestCase({
      systemId: "system-1",
      requirement: "Plan robot purchase",
      scenarios: [],
      newTerms: [
        {
          id: "term_candidate_1",
          projectId: "system-1",
          key: "product.robot",
          zhCN: "Robot product",
          enUS: "Robot product",
          aliases: ["robot"],
          pageScope: "/products",
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z"
        },
        {
          id: "term_candidate_2",
          projectId: "system-1",
          key: "checkout.total",
          zhCN: "Order amount",
          enUS: "Order amount",
          aliases: [],
          pageScope: "/checkout",
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      ruleCheckResult: { passed: true, checks: [] }
    });

    const result = service.confirmCandidateTerms({
      caseId: testCase.id,
      confirmTermIds: ["term_candidate_1"],
      ignoreTermIds: ["term_candidate_2"]
    });

    expect(result.confirmedTerms.map((term) => term.key)).toEqual(["product.robot"]);
    expect(result.ignoredTerms.map((term) => term.key)).toEqual(["checkout.total"]);
    expect(result.testCase.newTerms).toEqual([]);
    expect(service.listGlossaryTerms({ projectId: "system-1", query: "robot" })).toEqual([
      expect.objectContaining({ id: "term_candidate_1", key: "product.robot" })
    ]);
  });

  it("manages business rules per system", () => {
    const service = createService();

    const rule = service.createBusinessRule({
      systemId: "system-1",
      name: "Payment amount check",
      condition: "Payment flow must verify order amount",
      severity: "block"
    });
    service.createBusinessRule({
      systemId: "system-2",
      name: "CRM owner check",
      condition: "Lead must have an owner",
      severity: "warn"
    });

    expect(rule).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^rule_/),
        systemId: "system-1",
        name: "Payment amount check",
        severity: "block"
      })
    );
    expect(service.listBusinessRules("system-1")).toEqual([rule]);

    expect(service.deleteBusinessRule({ systemId: "system-1", ruleId: rule.id })).toEqual(rule);
    expect(() =>
      service.deleteBusinessRule({
        systemId: "system-1",
        ruleId: service.listBusinessRules("system-2")[0].id
      })
    ).toThrow("Business rule belongs to another business system");

    expect(service.listBusinessRules("system-1")).toEqual([]);
    expect(service.listBusinessRules("system-2")).toHaveLength(1);
  });

  it("creates, updates, approves, and lists structured test cases per system", () => {
    const service = createService();

    const testCase = service.createTestCase({
      systemId: "system-1",
      requirement: "测试购买机器人的完整流程",
      scenarios: [
        {
          id: "scenario_1",
          title: "购买机器人",
          priority: "critical",
          steps: [
            { action: "navigate", target: "商品列表" },
            { action: "click", target: "机器人商品" },
            { action: "assert", target: "订单金额", expected: "金额正确" }
          ],
          businessRuleRef: "rule_1"
        }
      ],
      newTerms: [
        {
          id: "term_candidate_1",
          projectId: "system-1",
          key: "product.robot",
          zhCN: "机器人",
          enUS: "Robot",
          aliases: ["Robot"],
          pageScope: "/products",
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      ruleCheckResult: {
        passed: true,
        checks: [
          {
            ruleId: "rule_1",
            ruleName: "Payment amount check",
            covered: true,
            detail: "订单金额断言已覆盖"
          }
        ]
      }
    });

    expect(testCase.status).toBe("draft");
    expect(service.getTestCase(testCase.id)).toEqual(testCase);
    expect(service.listTestCases("system-1")).toEqual([testCase]);

    const updated = service.updateTestCaseScenarios(testCase.id, [
      {
        id: "scenario_2",
        title: "购买机器人并校验支付金额",
        priority: "critical",
        steps: [{ action: "assert", target: "支付金额", expected: "等于订单金额" }]
      }
    ]);
    const approved = service.approveTestCase(testCase.id);

    expect(updated.scenarios[0].title).toBe("购买机器人并校验支付金额");
    expect(approved.status).toBe("approved");
    expect(service.listTestCases("missing-system")).toEqual([]);
  });

  it("does not update scenarios after a test case is approved", () => {
    const service = createService();
    const testCase = service.createTestCase({
      systemId: "system-1",
      requirement: "Plan robot purchase",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    service.approveTestCase(testCase.id);

    expect(() =>
      service.updateTestCaseScenarios(testCase.id, [
        {
          id: "scenario_1",
          title: "Change after approval",
          priority: "high",
          steps: [{ action: "assert", target: "Order status", expected: "Paid" }]
        }
      ])
    ).toThrow("Only draft test cases can be updated");
  });

  it("cancels and resumes a test case around a manual auth checkpoint", () => {
    const service = createService();
    const system = service.createSystemProfile({
      name: "Google Gmail Login",
      environment: "external-first-run",
      baseUrl: "https://workspace.google.com/intl/zh-CN/gmail/",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://accounts.google.com/", "https://mail.google.com/"]
    });
    const auth = service.createAuthProfile({
      projectId: system.id,
      env: "external-first-run",
      role: "manual-user",
      loginMethod: "script",
      secrets: { mode: "manual-browser-login-required" }
    });
    const testCase = service.createTestCase({
      systemId: system.id,
      requirement: "首次 Gmail 登录验证",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    const checkpoint = service.createAuthCheckpoint({
      systemId: system.id,
      authProfileId: auth.id,
      testCaseId: testCase.id,
      reason: "User must complete Google password and 2FA manually",
      resumeInstruction: "Resume after Inbox is visible"
    });

    const cancelled = service.cancelTestCase(testCase.id, "User closed the login page");

    expect(cancelled.testCase.status).toBe("cancelled");
    expect(cancelled.gap).toEqual(
      expect.objectContaining({
        projectId: system.id,
        sourceType: "user-interruption",
        sourceId: testCase.id,
        status: "open"
      })
    );
    expect(() => service.resumeTestCase(testCase.id)).toThrow(
      "Manual auth checkpoints must be completed or cancelled before resuming"
    );
    expect(() => service.approveTestCase(testCase.id)).toThrow("Only draft test cases can be approved");

    expect(service.completeAuthCheckpoint(checkpoint.id).status).toBe("completed");
    expect(() => service.cancelAuthCheckpoint(checkpoint.id)).toThrow(
      "Only awaiting-user auth checkpoints can be updated"
    );
    const resumed = service.resumeTestCase(testCase.id);

    expect(resumed.testCase.status).toBe("draft");
    expect(resumed.resolvedGaps).toEqual([
      expect.objectContaining({ sourceType: "user-interruption", status: "resolved" })
    ]);
  });

  it("reports external preflight gaps and archives systems and auth without deleting them", () => {
    const service = createService();
    const system = service.createSystemProfile({
      name: "Google Gmail Login",
      environment: "external-first-run",
      baseUrl: "https://workspace.google.com/intl/zh-CN/gmail/",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://accounts.google.com/"]
    });
    const auth = service.createAuthProfile({
      projectId: system.id,
      env: "external-first-run",
      role: "manual-user",
      loginMethod: "script",
      secrets: { mode: "manual-browser-login-required" }
    });

    const gap = service.reportGap({
      projectId: system.id,
      sourceType: "external-preflight",
      sourceId: system.id,
      reason: "net::ERR_CONNECTION_CLOSED",
      severity: "high",
      owner: "qa"
    });

    expect(gap).toEqual(
      expect.objectContaining({
        projectId: system.id,
        sourceType: "external-preflight",
        reason: "net::ERR_CONNECTION_CLOSED"
      })
    );
    expect(service.archiveAuthProfile(auth.id).status).toBe("cancelled");
    expect(service.archiveSystemProfile(system.id).status).toBe("cancelled");
    expect(service.listAuthProfiles(system.id)).toHaveLength(1);
    expect(service.listSystemProfiles()).toContainEqual(
      expect.objectContaining({ id: system.id, status: "cancelled" })
    );
  });

  it("records agent and chain runs per system", () => {
    const service = createService();
    const agentRun = {
      id: "agent_1",
      systemId: "system-1",
      agent: "planner" as const,
      status: "succeeded" as const,
      inputSummary: "测试购买机器人",
      outputPaths: ["specs/robot-purchase.md"],
      duration: 1200,
      logs: ["planner completed"],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    const chainRun = {
      id: "chain_1",
      systemId: "system-1",
      testCaseId: "case_1",
      status: "succeeded" as const,
      planRunId: agentRun.id,
      specPath: "specs/robot-purchase.md",
      testPath: "tests/generated/robot-purchase.spec.ts",
      gaps: [],
      createdAt: "2026-05-29T00:00:00.000Z",
      completedAt: "2026-05-29T00:01:00.000Z"
    };

    service.recordAgentRun(agentRun);
    service.recordChainRun(chainRun);

    expect(service.getAgentRun(agentRun.id)).toEqual(agentRun);
    expect(service.listAgentRuns("system-1")).toEqual([agentRun]);
    expect(service.getChainRun(chainRun.id)).toEqual(chainRun);
    expect(service.listChainRuns("system-1")).toEqual([chainRun]);
  });

  it("lists generated spec and test file artifacts per system", () => {
    const service = createService();
    service.recordAgentRun({
      id: "agent_1",
      systemId: "system-1",
      agent: "planner",
      status: "succeeded",
      inputSummary: "Plan robot checkout",
      outputPaths: ["specs/robot-plan.md"],
      duration: 100,
      logs: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });
    service.recordAgentRun({
      id: "agent_2",
      systemId: "system-2",
      agent: "generator",
      status: "succeeded",
      inputSummary: "Generate billing test",
      outputPaths: ["tests/generated/billing.spec.ts"],
      duration: 100,
      logs: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });
    service.recordChainRun({
      id: "chain_1",
      systemId: "system-1",
      testCaseId: "case_1",
      status: "succeeded",
      specPath: "specs/robot-chain.md",
      testPath: "tests/generated/robot.spec.ts",
      gaps: [],
      createdAt: "2026-05-29T00:00:00.000Z",
      completedAt: "2026-05-29T00:01:00.000Z"
    });

    expect(service.listTestSpecs("system-1")).toEqual([
      expect.objectContaining({
        type: "test-spec",
        path: "specs/robot-plan.md",
        sourceType: "agent-run",
        sourceId: "agent_1"
      }),
      expect.objectContaining({
        type: "test-spec",
        path: "specs/robot-chain.md",
        sourceType: "chain-run",
        sourceId: "chain_1",
        testCaseId: "case_1"
      })
    ]);
    expect(service.listTestFiles("system-1")).toEqual([
      expect.objectContaining({
        type: "test-file",
        path: "tests/generated/robot.spec.ts",
        sourceType: "chain-run",
        sourceId: "chain_1"
      })
    ]);
  });

  it("lists and resolves gaps per system without crossing system boundaries", () => {
    const service = createService();
    const session = service.createTrainingSession({
      projectId: "system-1",
      pageModelId: "page_1"
    });
    const failed = service.failTrainingSession(session.id, "No API requests captured");
    service.failTrainingSession(
      service.createTrainingSession({ projectId: "system-2", pageModelId: "page_2" }).id,
      "Other system gap"
    );

    expect(service.listGaps({ projectId: "system-1", status: "open" })).toEqual([
      expect.objectContaining({
        id: failed.gap.id,
        projectId: "system-1",
        status: "open"
      })
    ]);

    const resolved = service.resolveGap({
      projectId: "system-1",
      gapId: failed.gap.id
    });

    expect(resolved.status).toBe("resolved");
    expect(service.listGaps({ projectId: "system-1", status: "open" })).toEqual([]);
    expect(() =>
      service.resolveGap({
        projectId: "system-2",
        gapId: failed.gap.id
      })
    ).toThrow("Gap belongs to another business system");
  });

  it("records auditable dismiss and reopen transitions for gaps", () => {
    const service = createService();
    const failed = service.failTrainingSession(
      service.createTrainingSession({ projectId: "system-1", pageModelId: "page_1" }).id,
      "No stable locator evidence"
    );

    const dismissed = service.transitionGap({
      projectId: "system-1",
      gapId: failed.gap.id,
      operation: "dismiss",
      note: "Accepted as an out-of-scope browser limitation.",
      evidenceRefs: ["evidence:review-1"]
    });
    const reopened = service.transitionGap({
      projectId: "system-1",
      gapId: failed.gap.id,
      operation: "reopen",
      note: "New browser evidence makes this actionable.",
      evidenceRefs: ["evidence:review-2"]
    });

    expect(dismissed.status).toBe("dismissed");
    expect(reopened.status).toBe("open");
    expect(reopened.lifecycle).toEqual([
      expect.objectContaining({ operation: "dismiss", evidenceRefs: ["evidence:review-1"] }),
      expect.objectContaining({ operation: "reopen", evidenceRefs: ["evidence:review-2"] })
    ]);
  });

  it("searches v2 business rules, test cases, and run history as system assets", () => {
    const service = createService();
    service.createBusinessRule({
      systemId: "system-1",
      name: "Robot payment rule",
      condition: "购买机器人必须校验支付金额",
      severity: "block"
    });
    const testCase = service.createTestCase({
      systemId: "system-1",
      requirement: "测试购买 robot 机器人",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    service.recordAgentRun({
      id: "agent_1",
      systemId: "system-1",
      agent: "planner",
      status: "succeeded",
      inputSummary: "Planner explored robot purchase",
      outputPaths: ["specs/robot.md"],
      duration: 10,
      logs: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });
    service.recordChainRun({
      id: "chain_1",
      systemId: "system-1",
      testCaseId: testCase.id,
      status: "succeeded",
      specPath: "specs/robot.md",
      testPath: "tests/generated/robot.spec.ts",
      gaps: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });

    const assets = service.searchAssets({ projectId: "system-1", query: "robot" });

    expect(assets.map((asset) => asset.type)).toEqual(
      expect.arrayContaining(["business-rule", "test-case", "agent-run", "chain-run"])
    );
  });

  it("returns v2 asset details inside the same system", () => {
    const service = createService();
    const rule = service.createBusinessRule({
      systemId: "system-1",
      name: "Robot payment rule",
      condition: "购买机器人必须校验支付金额",
      severity: "block"
    });
    const testCase = service.createTestCase({
      systemId: "system-1",
      requirement: "测试购买 robot 机器人",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });

    expect(
      service.getAssetDetail({
        projectId: "system-1",
        type: "business-rule",
        id: rule.id
      }).asset
    ).toEqual(rule);
    expect(
      service.getAssetDetail({
        projectId: "system-1",
        type: "test-case",
        id: testCase.id
      }).asset
    ).toEqual(testCase);
  });
});
