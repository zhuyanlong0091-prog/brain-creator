// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainCreatorService } from "../domain/service.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";
import {
  isAllowedExplorationUrl,
  isReadOnlyNavigationUrl,
  SystemExplorationCoordinator,
  type SystemExplorer
} from "./systemExplorer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("System exploration coordinator", () => {
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
