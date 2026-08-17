// @vitest-environment node

import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainCreatorService } from "../domain/service.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";
import {
  classifySafeInteractionCandidate,
  isAllowedExplorationUrl,
  isReadOnlyNavigationUrl,
  interactionLocator,
  PlaywrightSystemExplorer,
  stableChildFrameEntries,
  SystemExplorationCoordinator,
  type SystemExplorer
} from "./systemExplorer.js";
import { bindStepsToSystemBrain } from "./systemBrain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("System exploration coordinator", () => {
  it("keeps popup interaction selectors scoped to the captured popup", () => {
    const locator = { first: () => "popup-locator" };
    const page = {
      url: () => "https://orders.example.test/details",
      locator: vi.fn(() => locator)
    } as unknown as import("@playwright/test").Page;
    const candidate = {
      name: "Popup details",
      role: "button",
      selector: '[id="popup-details"]',
      tag: "button",
      surface: {
        kind: "popup" as const,
        url: "https://orders.example.test/details"
      }
    };

    expect(interactionLocator(page, candidate, ["https://orders.example.test/"]).first()).toBe(
      "popup-locator"
    );
    expect(() =>
      interactionLocator(
        { ...page, url: () => "https://orders.example.test/other" } as unknown as import("@playwright/test").Page,
        candidate,
        ["https://orders.example.test/"]
      )
    ).toThrow("Popup surface is unavailable");
  });

  it("keeps child frame ordinals stable before allowlist filtering", () => {
    const main = { url: () => "https://orders.example.test/" };
    const outside = { url: () => "https://outside.example.test/frame" };
    const inside = { url: () => "https://orders.example.test/frame" };
    const page = {
      mainFrame: () => main,
      frames: () => [main, outside, inside]
    } as unknown as import("@playwright/test").Page;

    expect(stableChildFrameEntries(page).map((item) => item.frameIndex)).toEqual([0, 1]);
    expect(stableChildFrameEntries(page).map((item) => item.frame.url())).toEqual([
      "https://outside.example.test/frame",
      "https://orders.example.test/frame"
    ]);
  });

  it("explores a popup state transition without falling back to the main document", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/popup") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`
          <button id="popup-details" aria-expanded="false" aria-controls="popup-panel">Popup details</button>
          <span id="popup-panel" hidden>Popup panel</span>
          <script>
            document.querySelector('#popup-details').onclick = () => {
              document.querySelector('#popup-details').setAttribute('aria-expanded', 'true');
              document.querySelector('#popup-panel').hidden = false;
            };
          </script>
        `);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<button id="open-popup" aria-expanded="false" aria-controls="popup">Open popup</button><script>document.querySelector("#open-popup").onclick = () => window.open("/popup", "_blank")</script>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    try {
      const fixture = await createLocalFixture(baseUrl);
      const result = await new SystemExplorationCoordinator({
        repository: fixture.repository,
        service: fixture.domainService,
        knowledgeService: fixture.knowledgeService,
        workDir: fixture.workDir,
        explorer: new PlaywrightSystemExplorer()
      }).explore({
        knowledgeProjectId: fixture.projectId,
        systemId: fixture.systemId,
        interactionMode: "safe",
        budget: {
          maxPages: 1,
          maxDepth: 0,
          maxDurationMs: 10_000,
          maxInteractionsPerPage: 2
        }
      });

      expect(result.exploration.status).toBe("completed");
      expect(result.exploration.interactionTransitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetName: "Popup details",
            status: "observed",
            surface: expect.objectContaining({ kind: "popup" }),
            visibleAdded: expect.arrayContaining(["Popup panel"])
          })
        ])
      );
      expect(result.brain.pages[0].surfaces).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "popup", url: `${baseUrl}popup` })])
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 30_000);

  it("explores allowlisted pages, persists navigation, and refreshes System Brain", async () => {
    const fixture = await createFixture();
    const explorer: SystemExplorer = {
      explore: vi.fn().mockResolvedValue({
        pages: [
          pageResult("https://orders.example.test/orders", "Orders", 0, [
            { text: "Create Order", url: "https://orders.example.test/orders/new" }
          ]),
          pageResult("https://orders.example.test/orders/new", "Create Order", 1, [])
        ],
        blockers: [],
        warnings: [],
        budgetExhausted: false
      })
    };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    const result = await coordinator.explore({
      knowledgeProjectId: fixture.projectId,
      systemId: fixture.systemId,
      startUrl: "https://orders.example.test/orders",
      budget: { maxPages: 4, maxDepth: 2, maxDurationMs: 60_000 }
    });

    expect(explorer.explore).toHaveBeenCalledWith(
      expect.objectContaining({
        startUrl: "https://orders.example.test/orders",
        allowedUrls: ["https://orders.example.test/"],
        budget: expect.objectContaining({ maxPages: 4, maxDepth: 2 })
      })
    );
    expect(result.exploration).toEqual(
      expect.objectContaining({
        status: "completed",
        pageModelIds: expect.any(Array),
        navigationEdges: [
          expect.objectContaining({
            text: "Create Order",
            fromPageModelId: expect.any(String),
            toPageModelId: expect.any(String)
          })
        ]
      })
    );
    expect(result.exploration.pageModelIds).toHaveLength(2);
    expect(result.brain.pages).toHaveLength(2);
    expect(result.brain.navigationEdges).toEqual([
      expect.objectContaining({ text: "Create Order" })
    ]);
    expect(result.brain.readiness.navigationEvidence).toBe(true);
    expect(
      fixture.repository.knowledgeNodes.some(
        (node) =>
          node.origin === "observed" &&
          node.systemId === fixture.systemId &&
          node.content.includes("Create Order")
      )
    ).toBe(true);
  });

  it("blocks invalid scopes before opening a browser", async () => {
    const fixture = await createFixture();
    const explorer: SystemExplorer = { explore: vi.fn() };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    await expect(
      coordinator.explore({
        knowledgeProjectId: fixture.projectId,
        systemId: fixture.systemId,
        startUrl: "https://attacker.example.test/orders"
      })
    ).rejects.toThrow("allowlist");
    expect(explorer.explore).not.toHaveBeenCalled();
    expect(fixture.repository.systemExplorations).toHaveLength(0);
  });

  it("uses origin and path boundaries for exploration allowlists", () => {
    expect(
      isAllowedExplorationUrl("https://orders.example.test/admin/users", [
        "https://orders.example.test/admin"
      ])
    ).toBe(true);
    expect(
      isAllowedExplorationUrl("https://orders.example.test/administer", [
        "https://orders.example.test/admin"
      ])
    ).toBe(false);
    expect(
      isAllowedExplorationUrl("file:///tmp/orders.html", [
        "https://orders.example.test"
      ])
    ).toBe(false);
    expect(
      isReadOnlyNavigationUrl("https://orders.example.test/orders?action=delete")
    ).toBe(false);
    expect(isReadOnlyNavigationUrl("https://orders.example.test/orders/new")).toBe(true);
  });

  it("only permits explicitly safe interaction candidates", () => {
    expect(
      classifySafeInteractionCandidate({
        name: "Recruiting Settings",
        role: "tab",
        selector: "[role=tab]",
        tag: "button"
      })
    ).toEqual(expect.objectContaining({ allowed: true, action: "click" }));
    expect(
      classifySafeInteractionCandidate({
        name: "More filters",
        role: "button",
        selector: "[aria-expanded=false]",
        tag: "button",
        ariaExpanded: "false"
      })
    ).toEqual(expect.objectContaining({ allowed: true, action: "click" }));
    expect(
      classifySafeInteractionCandidate({
        name: "Employee Type",
        role: "combobox",
        selector: "[name=employeeType]",
        tag: "select",
        currentValue: "",
        options: [
          { value: "", label: "Select", disabled: false },
          { value: "intern", label: "Intern", disabled: false }
        ]
      })
    ).toEqual(
      expect.objectContaining({ allowed: true, action: "select", inputValue: "intern" })
    );
    expect(
      classifySafeInteractionCandidate(
        {
          name: "Employee Type",
          role: "combobox",
          selector: '[name="employeeType"]',
          tag: "select",
          currentValue: "employee",
          options: [
            { value: "employee", label: "Employee", disabled: false },
            { value: "intern", label: "Intern", disabled: false }
          ]
        },
        { selectorValues: { '[name="employeeType"]': "Intern" } }
      )
    ).toEqual(expect.objectContaining({ allowed: true, inputValue: "intern" }));
    expect(
      classifySafeInteractionCandidate(
        {
          name: "Employee Type",
          role: "combobox",
          selector: '[name="employeeType"]',
          tag: "select",
          currentValue: "employee",
          options: [{ value: "employee", label: "Employee", disabled: false }]
        },
        { selectorValues: { '[name="employeeType"]': "Intern" } }
      )
    ).toEqual(expect.objectContaining({ allowed: false, reason: expect.stringContaining("Intern") }));
    for (const name of ["Save", "Delete", "Approve", "Submit", "创建", "删除", "审批"]) {
      expect(
        classifySafeInteractionCandidate({
          name,
          role: "button",
          selector: `[aria-label=${JSON.stringify(name)}]`,
          tag: "button",
          ariaExpanded: "false"
        })
      ).toEqual(expect.objectContaining({ allowed: false }));
    }
  });

  it("does not fall back to the main document when an iframe surface is missing", () => {
    const page = {
      frames: () => []
    } as unknown as import("@playwright/test").Page;

    expect(() =>
      interactionLocator(page, {
        name: "Frame Mode",
        role: "combobox",
        selector: '[id="frame-mode"]',
        tag: "select",
        surface: {
          kind: "iframe",
          url: "https://orders.example.test/frame",
          frameIndex: 1
        }
      })
    ).toThrow("Iframe surface is unavailable after page recovery");
  });

  it("preserves iframe ordinals when an earlier frame is outside the allowlist", () => {
    const mainFrame = { url: () => "https://orders.example.test/" };
    const outsideFrame = { url: () => "https://other.example.test/frame" };
    const targetFrame = {
      url: () => "https://orders.example.test/frame",
      locator: vi.fn(() => "target-locator")
    };
    const page = {
      mainFrame: () => mainFrame,
      frames: () => [mainFrame, outsideFrame, targetFrame]
    } as unknown as import("@playwright/test").Page;

    const locator = interactionLocator(
      page,
      {
        name: "Frame Mode",
        role: "combobox",
        selector: '[id="frame-mode"]',
        tag: "select",
        surface: {
          kind: "iframe",
          url: "https://orders.example.test/frame",
          frameIndex: 2
        }
      },
      ["https://orders.example.test/"]
    );

    expect(locator).toBe("target-locator");
    expect(targetFrame.locator).toHaveBeenCalledWith('[id="frame-mode"]');
  });

  it("rejects unavailable or cross-system scenario data leases before opening a browser", async () => {
    const fixture = await createFixture();
    const explorer: SystemExplorer = { explore: vi.fn() };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    await expect(
      coordinator.explore({
        knowledgeProjectId: fixture.projectId,
        systemId: fixture.systemId,
        interactionMode: "safe",
        scenario: {
          name: "Requires prepared data",
          dataRefs: ["fixture:order"],
          testDataLeaseIds: ["lease-missing"],
          selectorValues: {}
        }
      })
    ).rejects.toThrow("unavailable or cross-system test data lease");
    expect(explorer.explore).not.toHaveBeenCalled();
  });

  it("rejects secret-like scenario selector keys", async () => {
    const fixture = await createFixture();
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer: { explore: vi.fn() }
    });

    await expect(
      coordinator.explore({
        knowledgeProjectId: fixture.projectId,
        systemId: fixture.systemId,
        scenario: {
          name: "Invalid secret scenario",
          dataRefs: [],
          testDataLeaseIds: [],
          selectorValues: { password: "should-not-be-here" }
        }
      })
    ).rejects.toThrow("cannot carry secret selector values");
  });

  it("persists safe field transitions and exposes them to case binding", async () => {
    const fixture = await createFixture();
    const cascade = cascadePageResult();
    cascade.interactions[0].after.url = "https://orders.example.test/recruiting/details";
    cascade.interactions[0].urlChanged = true;
    (cascade.interactions[0] as { reacquiredPage?: boolean }).reacquiredPage = true;
    (cascade.interactions[0] as { recovery?: unknown }).recovery = {
      trigger: "interaction-failure",
      method: "new-page-and-reload",
      fromUrl: "https://orders.example.test/recruiting",
      toUrl: "https://orders.example.test/recruiting",
      attempts: 2,
      status: "recovered"
    };
    const explorer: SystemExplorer = {
      explore: vi.fn().mockResolvedValue({
        pages: [cascade],
        blockers: [],
        warnings: [],
        budgetExhausted: false
      })
    };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    const result = await coordinator.explore({
      knowledgeProjectId: fixture.projectId,
      systemId: fixture.systemId,
      startUrl: "https://orders.example.test/recruiting",
      interactionMode: "safe",
      budget: {
        maxPages: 2,
        maxDepth: 1,
        maxDurationMs: 30_000,
        maxInteractionsPerPage: 3
      }
    });
    const bound = bindStepsToSystemBrain(
      [
        {
          id: "step-select",
          order: 1,
          action: "select",
          instruction: "Select Intern as Employee Type",
          targetSemantic: "Employee Type",
          origin: "source",
          sourceRefs: ["requirement:employee-type"]
        },
        {
          id: "step-assert",
          order: 2,
          action: "assert",
          instruction: "Replacement Employee becomes visible",
          targetSemantic: "Replacement Employee",
          expected: "Replacement Employee is visible",
          origin: "source",
          sourceRefs: ["requirement:replacement"]
        }
      ],
      result.brain,
      "Recruiting Employee Type Intern Replacement Employee"
    );

    expect(result.exploration.interactionMode).toBe("safe");
    expect(result.exploration.interactionTransitions).toEqual([
      expect.objectContaining({
        pageModelId: expect.any(String),
        action: "select",
        inputValue: "intern",
        visibleAdded: ["Replacement Employee"],
        status: "observed",
        reacquiredPage: true,
        recovery: expect.objectContaining({
          trigger: "interaction-failure",
          method: "new-page-and-reload",
          attempts: 2,
          status: "recovered"
        })
      })
    ]);
    expect(result.exploration.navigationEdges).toEqual([
      expect.objectContaining({
        fromUrl: "https://orders.example.test/recruiting",
        toUrl: "https://orders.example.test/recruiting/details",
        text: "Employee Type",
        fromPageModelId: expect.any(String)
      })
    ]);
    expect(result.brain.stateTransitions).toEqual([
      expect.objectContaining({
        targetName: "Employee Type",
        visibleAdded: ["Replacement Employee"]
      })
    ]);
    expect(result.brain.readiness.stateEvidence).toBe(true);
    expect(bound.missingEvidence).toEqual([]);
    expect(bound.steps[0].sourceRefs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^system-interaction:/),
        "locator-point:" + result.brain.pages[0].locators[0].id
      ])
    );
    expect(bound.steps[1].sourceRefs).toEqual(
      expect.arrayContaining([expect.stringMatching(/^system-interaction:/)])
    );
  });

  it("turns authentication blockers into a resumable Gap and checkpoint", async () => {
    const fixture = await createFixture(true);
    const explorer: SystemExplorer = {
      explore: vi.fn().mockResolvedValue({
        pages: [],
        blockers: ["Authentication required: redirected to /login"],
        warnings: [],
        budgetExhausted: false
      })
    };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    const result = await coordinator.explore({
      knowledgeProjectId: fixture.projectId,
      systemId: fixture.systemId,
      authProfileId: fixture.authProfileId,
      startUrl: "https://orders.example.test/orders"
    });

    expect(result.exploration.status).toBe("blocked");
    expect(result.gaps).toEqual([
      expect.objectContaining({
        sourceType: "system-exploration",
        reason: expect.stringContaining("Authentication required")
      })
    ]);
    expect(fixture.repository.authCheckpoints).toEqual([
      expect.objectContaining({
        systemId: fixture.systemId,
        authProfileId: fixture.authProfileId,
        status: "awaiting-user"
      })
    ]);
  });

  it("rejects explorer output that exceeds the approved page or depth budget", async () => {
    const fixture = await createFixture();
    const explorer: SystemExplorer = {
      explore: vi.fn().mockResolvedValue({
        pages: [
          pageResult("https://orders.example.test/orders", "Orders", 0, []),
          pageResult("https://orders.example.test/orders/new", "Create Order", 2, [])
        ],
        blockers: [],
        warnings: [],
        budgetExhausted: false
      })
    };
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer
    });

    const result = await coordinator.explore({
      knowledgeProjectId: fixture.projectId,
      systemId: fixture.systemId,
      startUrl: "https://orders.example.test/orders",
      budget: { maxPages: 1, maxDepth: 1, maxDurationMs: 30_000 }
    });

    expect(result.exploration.status).toBe("blocked");
    expect(result.gaps[0].reason).toContain("budget");
    expect(fixture.repository.pageModels).toHaveLength(0);
  });

  it("rejects unsafe interaction evidence from a custom explorer", async () => {
    const fixture = await createFixture();
    const unsafePage = cascadePageResult();
    unsafePage.evidence.interactiveElements = [
      {
        name: "Save",
        role: "button",
        text: "Save",
        selector: "[data-testid=save]"
      }
    ];
    unsafePage.interactions[0].target = {
      name: "Save",
      role: "button",
      selector: "[data-testid=save]",
      kind: "disclosure"
    };
    unsafePage.interactions[0].action = "click";
    const coordinator = new SystemExplorationCoordinator({
      repository: fixture.repository,
      service: fixture.domainService,
      knowledgeService: fixture.knowledgeService,
      workDir: fixture.workDir,
      explorer: {
        explore: vi.fn().mockResolvedValue({
          pages: [unsafePage],
          blockers: [],
          warnings: [],
          budgetExhausted: false
        })
      }
    });

    const result = await coordinator.explore({
      knowledgeProjectId: fixture.projectId,
      systemId: fixture.systemId,
      interactionMode: "safe",
      budget: { maxInteractionsPerPage: 1 }
    });

    expect(result.exploration.status).toBe("blocked");
    expect(result.gaps[0].reason).toContain("safe policy");
    expect(fixture.repository.pageModels).toHaveLength(0);
  });

  it(
    "captures safe browser state changes while blocking write requests",
    async () => {
      let writeRequests = 0;
      const server = createServer((request, response) => {
        if (request.url === "/popup?close=1") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<title>Closing popup</title><script>window.close()</script>");
          return;
        }
        if (request.url === "/popup") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<title>Popup details</title><button>Popup action</button>");
          return;
        }
        if (request.url === "/frame") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`
            <label>Frame Mode
              <select id="frame-mode" onchange="location.href='/frame-next'">
                <option value="basic">Basic</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
          `);
          return;
        }
        if (request.url === "/frame-next") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`
            <label>Frame Mode
              <select id="frame-mode">
                <option value="advanced" selected>Advanced</option>
              </select>
            </label>
            <span>Advanced Mode</span>
          `);
          return;
        }
        if (request.url === "/outside-frame") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<button>Outside private control</button>");
          return;
        }
        if (request.method === "POST") writeRequests += 1;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`
          <!doctype html>
          <html>
            <head><title>Recruiting</title></head>
            <body>
              <div id="app-root">
                <label>
                  Employee Type
                  <select id="employee-type" onchange="remountEmployee(this.value)">
                    <option value="employee">Employee</option>
                    <option value="intern">Intern</option>
                  </select>
                </label>
                <input id="replacement" aria-label="Replacement Employee" hidden>
              </div>
              <iframe src="/frame" title="Embedded form"></iframe>
              <iframe src="/frame" title="Embedded form duplicate"></iframe>
              <iframe src="http://localhost:${address.port}/outside-frame" title="Outside surface"></iframe>
              <div id="shadow-host"></div>
              <wujie-app id="wujie-host"></wujie-app>
              <label>
                Sync Type
                <select id="sync-type" onchange="fetch('/api/sync', { method: 'POST' }).catch(() => {})">
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                </select>
              </label>
              <button id="save" aria-expanded="false" onclick="fetch('/api/save', { method: 'POST' })">
                Save
              </button>
              <button id="details" aria-controls="popup" aria-expanded="false" onclick="window.open('/popup', '_blank')">
                Open details
              </button>
              <button id="closing-details" aria-controls="closing-popup" aria-expanded="false" onclick="window.open('/popup?close=1', '_blank')">
                Open closing details
              </button>
              <script>
                const root = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
                window.remountEmployee = (value) => {
                  const root = document.querySelector('#app-root');
                  root.innerHTML = '<label>Employee Type <select id="employee-type"><option value="employee">Employee</option><option value="intern" selected>Intern</option></select></label><input id="replacement" aria-label="Replacement Employee"><span>App remounted</span>';
                };
                const shadowButton = document.createElement('button');
                shadowButton.id = 'shadow-details';
                shadowButton.setAttribute('aria-expanded', 'false');
                shadowButton.setAttribute('aria-controls', 'shadow-panel');
                shadowButton.textContent = 'Shadow details';
                const shadowPanel = document.createElement('span');
                shadowPanel.id = 'shadow-panel';
                shadowPanel.hidden = true;
                shadowPanel.textContent = 'Shadow panel';
                shadowButton.onclick = () => {
                  shadowButton.setAttribute('aria-expanded', 'true');
                  shadowPanel.hidden = false;
                };
                root.append(shadowButton, shadowPanel);
                const wujieRoot = document.querySelector('#wujie-host').attachShadow({ mode: 'open' });
                const wujieButton = document.createElement('button');
                wujieButton.id = 'wujie-details';
                wujieButton.setAttribute('aria-expanded', 'false');
                wujieButton.textContent = 'Wujie details';
                const wujiePanel = document.createElement('span');
                wujiePanel.hidden = true;
                wujiePanel.textContent = 'Wujie panel';
                wujieButton.onclick = () => {
                  wujieButton.setAttribute('aria-expanded', 'true');
                  wujiePanel.hidden = false;
                };
                wujieRoot.append(wujieButton, wujiePanel);
              </script>
            </body>
          </html>
        `);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/`;

      try {
        const fixture = await createLocalFixture(baseUrl);
        const coordinator = new SystemExplorationCoordinator({
          repository: fixture.repository,
          service: fixture.domainService,
          knowledgeService: fixture.knowledgeService,
          workDir: fixture.workDir,
          explorer: new PlaywrightSystemExplorer()
        });

        const result = await coordinator.explore({
          knowledgeProjectId: fixture.projectId,
          systemId: fixture.systemId,
          interactionMode: "safe",
          scenario: {
            id: "intern-replacement",
            name: "Intern replacement field discovery",
            role: "recruiter",
            prerequisiteState: "empty recruiting form",
            dataRefs: ["fixture:intern-recruiting"],
            testDataLeaseIds: [],
            selectorValues: { '[id="employee-type"]': "intern" }
          },
          budget: {
            maxPages: 1,
            maxDepth: 0,
            maxDurationMs: 30_000,
            maxInteractionsPerPage: 10
          }
        });

        const employeeType = result.exploration.interactionTransitions.find(
          (transition) => transition.targetName === "Employee Type"
        );
        const syncType = result.exploration.interactionTransitions.find(
          (transition) => transition.targetName === "Sync Type"
        );
        expect(result.brain.pages).toHaveLength(1);
        expect(result.exploration.scenario).toEqual(
          expect.objectContaining({
            id: "intern-replacement",
            role: "recruiter",
            dataRefs: ["fixture:intern-recruiting"]
          })
        );
        expect(result.exploration.warnings).toEqual(
          expect.arrayContaining([expect.stringContaining("Popup closed before capture")])
        );
        expect(employeeType).toEqual(
          expect.objectContaining({
            status: "observed",
            transitionKind: "state",
            scenarioId: "intern-replacement",
            visibleAdded: expect.arrayContaining(["Replacement Employee", "App remounted"])
          })
        );
        expect(
          result.brain.stateTransitions.find(
            (transition) => transition.targetName === "Employee Type"
          )
        ).toEqual(expect.objectContaining({ scenarioId: "intern-replacement" }));
        expect(syncType).toEqual(
          expect.objectContaining({
            status: "blocked",
            blockedRequests: [expect.objectContaining({ method: "POST" })],
            changedControls: [
              expect.objectContaining({
                name: "Sync Type",
                before: "manual",
                after: "automatic"
              })
            ]
          })
        );
        expect(
          result.exploration.interactionTransitions.some(
            (transition) => transition.targetName === "Save"
          )
        ).toBe(false);
        expect(result.brain.stateTransitions.map((transition) => transition.targetName)).toEqual(
          expect.arrayContaining(["Employee Type", "Frame Mode", "Shadow details", "Wujie details"])
        );
        expect(result.brain.stateTransitions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              targetName: "Frame Mode",
              scenarioId: "intern-replacement",
              surface: expect.objectContaining({ kind: "iframe" })
            }),
            expect.objectContaining({
              targetName: "Shadow details",
              surface: expect.objectContaining({
                kind: "shadow-root",
                hostSelectors: expect.arrayContaining([expect.stringContaining("shadow-host")])
              })
            }),
            expect.objectContaining({
              targetName: "Wujie details",
              surface: expect.objectContaining({
                kind: "wujie",
                hostSelectors: expect.arrayContaining([expect.stringContaining("wujie-host")])
              })
            })
          ])
        );
        expect(
          result.exploration.interactionTransitions.find(
            (transition) =>
              transition.targetName === "Frame Mode" &&
              transition.surface?.kind === "iframe" &&
              transition.surface.frameIndex === 0
          )?.after.surfaceUrls
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ url: expect.stringContaining("/frame-next") })
          ])
        );
        expect(result.brain.stateTransitions).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ targetName: "Sync Type" })])
        );
        expect(result.brain.pages[0].surfaces).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "iframe", frameIndex: 0 }),
            expect.objectContaining({ kind: "iframe", frameIndex: 1 }),
            expect.objectContaining({ kind: "shadow-root" }),
            expect.objectContaining({
              kind: "popup",
              title: "Popup details",
              domText: "Popup action",
              screenshotPath: expect.any(String)
            }),
            expect.objectContaining({ kind: "wujie" })
          ])
        );
        const popupSurface = result.brain.pages[0].surfaces?.find(
          (surface) => surface.kind === "popup"
        );
        expect(popupSurface?.screenshotPath).toBeTruthy();
        await expect(stat(popupSurface!.screenshotPath!)).resolves.toBeTruthy();
        expect(
          result.brain.pages[0].locators.some(
            (locator) => locator.name === "Outside private control"
          )
        ).toBe(false);
        const frameModes = result.exploration.interactionTransitions.filter(
          (transition) => transition.targetName === "Frame Mode"
        );
        expect(frameModes).toHaveLength(2);
        expect(frameModes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "observed",
              surface: expect.objectContaining({ kind: "iframe", frameIndex: 0 }),
              visibleAdded: expect.arrayContaining(["Advanced Mode"])
            }),
            expect.objectContaining({
              status: "observed",
              surface: expect.objectContaining({ kind: "iframe", frameIndex: 1 }),
              visibleAdded: expect.arrayContaining(["Advanced Mode"])
            })
          ])
        );
        const shadowDetails = result.exploration.interactionTransitions.find(
          (transition) => transition.targetName === "Shadow details"
        );
        expect(shadowDetails).toEqual(
          expect.objectContaining({
            status: "observed",
            surface: expect.objectContaining({ kind: "shadow-root" }),
            visibleAdded: expect.arrayContaining(["Shadow panel"])
          })
        );
        expect(writeRequests).toBe(0);

      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    },
    30_000
  );
});

async function createFixture(withAuth = false) {
  const workDir = await mkdtemp(join(tmpdir(), "brain-exploration-"));
  tempDirs.push(workDir);
  const repository = new InMemoryBrainCreatorRepository();
  const domainService = new BrainCreatorService(repository);
  const knowledgeService = new KnowledgeService(repository, join(workDir, "knowledge"));
  const system = domainService.createSystemProfile({
    name: "Order Console",
    environment: "test",
    baseUrl: "https://orders.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://orders.example.test"]
  });
  const project = await knowledgeService.createProject({
    name: "Order Knowledge",
    key: "order-knowledge",
    defaultLocale: "en-US"
  });
  knowledgeService.bindSystem(project.id, system.id);
  let authProfileId: string | undefined;
  if (withAuth) {
    const auth = domainService.createAuthProfile({
      projectId: system.id,
      env: "test",
      role: "tester",
      loginMethod: "cookie",
      secrets: { storageStatePath: "auth/state.json" }
    });
    domainService.verifyAuthProfile(auth.id);
    authProfileId = auth.id;
  }
  return {
    workDir,
    repository,
    domainService,
    knowledgeService,
    projectId: project.id,
    systemId: system.id,
    authProfileId
  };
}

function pageResult(
  finalUrl: string,
  title: string,
  depth: number,
  links: Array<{ text: string; url: string }>
) {
  return {
    depth,
    evidence: {
      title,
      finalUrl,
      domText: `${title} page`,
      screenshotPath: `evidence/${title.toLowerCase().replaceAll(" ", "-")}.png`,
      interactiveElements: [
        {
          name: title === "Orders" ? "Create Order" : "Order Name",
          role: title === "Orders" ? "link" : "textbox",
          text: title === "Orders" ? "Create Order" : "Order Name",
          selector:
            title === "Orders" ? "[data-testid=create-order]" : "[name=orderName]"
        }
      ],
      consoleErrors: [],
      networkFailures: [],
      issues: []
    },
    links
  };
}

async function createLocalFixture(baseUrl: string) {
  const workDir = await mkdtemp(join(tmpdir(), "brain-local-exploration-"));
  tempDirs.push(workDir);
  const repository = new InMemoryBrainCreatorRepository();
  const domainService = new BrainCreatorService(repository);
  const knowledgeService = new KnowledgeService(repository, join(workDir, "knowledge"));
  const system = domainService.createSystemProfile({
    name: "Recruiting",
    environment: "test",
    baseUrl,
    defaultLocale: "en-US",
    urlAllowlist: [baseUrl]
  });
  const project = await knowledgeService.createProject({
    name: "Recruiting Knowledge",
    key: "recruiting-knowledge",
    defaultLocale: "en-US"
  });
  knowledgeService.bindSystem(project.id, system.id);
  return {
    workDir,
    repository,
    domainService,
    knowledgeService,
    projectId: project.id,
    systemId: system.id
  };
}

function cascadePageResult() {
  const url = "https://orders.example.test/recruiting";
  return {
    depth: 0,
    evidence: {
      title: "Recruiting",
      finalUrl: url,
      domText: "Employee Type",
      screenshotPath: "evidence/recruiting.png",
      interactiveElements: [
        {
          name: "Employee Type",
          role: "combobox",
          text: "Employee Type",
          selector: "[name=employeeType]"
        }
      ],
      consoleErrors: [],
      networkFailures: [],
      issues: []
    },
    links: [],
    interactions: [
      {
        target: {
          name: "Employee Type",
          role: "combobox",
          selector: "[name=employeeType]",
          kind: "select"
        },
        action: "select",
        inputValue: "intern",
        before: {
          id: "state-before",
          url,
          visibleElements: ["Employee Type"],
          dialogs: []
        },
        after: {
          id: "state-after",
          url,
          visibleElements: ["Employee Type", "Replacement Employee"],
          dialogs: []
        },
        visibleAdded: ["Replacement Employee"],
        visibleRemoved: [],
        dialogAdded: [],
        dialogRemoved: [],
        urlChanged: false,
        blockedRequests: [],
        status: "observed",
        screenshotPath: "evidence/recruiting-interaction.png"
      }
    ]
  };
}
