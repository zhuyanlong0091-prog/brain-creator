import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { browserExecutablePath } from "../agent/authStateVerifier.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BrainCreatorService } from "../domain/service.js";
import type {
  Gap,
  PageCaptureEvidence,
  SystemExploration,
  SystemExplorationBudget
} from "../domain/types.js";
import { id } from "../shared/id.js";
import type { KnowledgeService } from "./service.js";

export type SystemExplorationPage = {
  depth: number;
  evidence: PageCaptureEvidence;
  links: Array<{ text: string; url: string }>;
};

export type SystemExplorerResult = {
  pages: SystemExplorationPage[];
  blockers: string[];
  warnings: string[];
  budgetExhausted: boolean;
};

export type SystemExplorerInput = {
  explorationId: string;
  startUrl: string;
  allowedUrls: string[];
  budget: SystemExplorationBudget;
  artifactDir: string;
  storageStatePath?: string;
};

export type SystemExplorer = {
  explore(input: SystemExplorerInput): Promise<SystemExplorerResult>;
};

type CoordinatorInput = {
  repository: InMemoryBrainCreatorRepository;
  service: BrainCreatorService;
  knowledgeService: KnowledgeService;
  workDir: string;
  explorer?: SystemExplorer;
};

type ExploreInput = {
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  startUrl?: string;
  budget?: Partial<SystemExplorationBudget>;
};

const DEFAULT_BUDGET: SystemExplorationBudget = {
  maxPages: 5,
  maxDepth: 2,
  maxDurationMs: 60_000
};

export class SystemExplorationCoordinator {
  private readonly explorer: SystemExplorer;

  constructor(private readonly input: CoordinatorInput) {
    this.explorer = input.explorer ?? new PlaywrightSystemExplorer();
  }

  async explore(request: ExploreInput) {
    const { repository, service, knowledgeService, workDir } = this.input;
    const project = repository.knowledgeProjects.find(
      (candidate) => candidate.id === request.knowledgeProjectId
    );
    if (!project) {
      throw new Error("Knowledge project not found");
    }
    if (!project.systemIds.includes(request.systemId)) {
      throw new Error("Business system is not bound to the selected knowledge project");
    }
    const system = repository.systemProfiles.find(
      (candidate) => candidate.id === request.systemId
    );
    if (!system || system.status === "cancelled") {
      throw new Error("Business system not found");
    }
    const startUrl = canonicalUrl(request.startUrl ?? system.baseUrl);
    const allowedUrls = uniqueUrls([system.baseUrl, ...system.urlAllowlist]);
    if (!isAllowedExplorationUrl(startUrl, allowedUrls)) {
      throw new Error("Exploration start URL is outside the business system allowlist");
    }
    const budget = normalizeBudget(request.budget);
    const authProfile = request.authProfileId
      ? repository.authProfiles.find((profile) => profile.id === request.authProfileId)
      : undefined;
    if (request.authProfileId && (!authProfile || authProfile.projectId !== system.id)) {
      throw new Error("Auth profile does not belong to the selected business system");
    }
    if (authProfile && authProfile.status !== "succeeded") {
      throw new Error("Auth profile must be verified before system exploration");
    }
    const captureAuth = service.getCaptureAuth(request.authProfileId);
    const storageStateValue = captureAuth?.secrets.storageStatePath;
    const storageStatePath = storageStateValue
      ? isAbsolute(storageStateValue)
        ? resolve(storageStateValue)
        : resolve(workDir, storageStateValue)
      : undefined;
    const now = new Date().toISOString();
    const explorationId = id("exploration");
    const artifactDir = join(
      workDir,
      ".brain-creator",
      "system-explorations",
      explorationId
    );
    const exploration: SystemExploration = {
      id: explorationId,
      knowledgeProjectId: project.id,
      systemId: system.id,
      authProfileId: request.authProfileId,
      startUrl,
      status: "running",
      budget,
      pageModelIds: [],
      navigationEdges: [],
      warnings: [],
      gapIds: [],
      artifactDir,
      createdAt: now,
      updatedAt: now
    };
    repository.systemExplorations.push(exploration);
    repository.persist();

    try {
      await mkdir(artifactDir, { recursive: true });
      const result = await this.explorer.explore({
        explorationId,
        startUrl,
        allowedUrls,
        budget,
        artifactDir,
        storageStatePath
      });
      assertResultWithinBudget(result, budget, allowedUrls);
      const captured = new Map<string, string>();
      for (const page of uniquePages(result.pages)) {
        const recorded = service.discoverPageModel({
          projectId: system.id,
          route: page.evidence.finalUrl,
          name: page.evidence.title,
          authProfileId: request.authProfileId ?? "",
          domText: page.evidence.domText,
          captureMode: "browser",
          targetUrl: page.evidence.finalUrl,
          browserCapture: page.evidence
        });
        captured.set(canonicalUrl(page.evidence.finalUrl), recorded.pageModel.id);
        exploration.pageModelIds.push(recorded.pageModel.id);
      }
      exploration.navigationEdges = result.pages.flatMap((page) => {
        const fromUrl = canonicalUrl(page.evidence.finalUrl);
        const fromPageModelId = captured.get(fromUrl);
        if (!fromPageModelId) return [];
        return page.links.flatMap((link) => {
          const toUrl = safeCanonicalUrl(link.url);
          if (!toUrl || !isAllowedExplorationUrl(toUrl, allowedUrls)) return [];
          return [{
            fromUrl,
            toUrl,
            text: link.text.trim() || toUrl,
            fromPageModelId,
            toPageModelId: captured.get(toUrl)
          }];
        });
      });
      exploration.warnings = [
        ...result.warnings,
        ...(result.budgetExhausted ? ["Exploration stopped at the approved budget."] : [])
      ];
      const blockers = result.blockers.filter(Boolean);
      const gaps = blockers.map((reason) =>
        createExplorationGap(repository, project.id, exploration.id, reason)
      );
      exploration.gapIds = gaps.map((gap) => gap.id);
      exploration.status =
        exploration.pageModelIds.length === 0
          ? "blocked"
          : blockers.length > 0
            ? "partial"
            : "completed";
      exploration.completedAt = new Date().toISOString();
      exploration.updatedAt = exploration.completedAt;
      if (exploration.status === "blocked" && gaps.length === 0) {
        const gap = createExplorationGap(
          repository,
          project.id,
          exploration.id,
          "System exploration did not capture any allowlisted page evidence."
        );
        gaps.push(gap);
        exploration.gapIds.push(gap.id);
      }
      if (
        request.authProfileId &&
        blockers.some((blocker) => isAuthenticationBlocker(blocker))
      ) {
        service.createAuthCheckpoint({
          systemId: system.id,
          authProfileId: request.authProfileId,
          reason: blockers.find(isAuthenticationBlocker) ?? "Authentication is required",
          resumeInstruction:
            "Refresh the browser storage state, verify the AuthProfile, then run explore-system again."
        });
      }
      repository.persist();
      return {
        exploration,
        gaps,
        brain: await knowledgeService.refreshSystemBrain(project.id, system.id)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const gap = createExplorationGap(
        repository,
        project.id,
        exploration.id,
        `System exploration failed: ${reason}`
      );
      exploration.status = "blocked";
      exploration.gapIds = [gap.id];
      exploration.warnings = [reason];
      exploration.completedAt = new Date().toISOString();
      exploration.updatedAt = exploration.completedAt;
      if (request.authProfileId && isAuthenticationBlocker(reason)) {
        service.createAuthCheckpoint({
          systemId: system.id,
          authProfileId: request.authProfileId,
          reason,
          resumeInstruction:
            "Refresh the browser storage state, verify the AuthProfile, then run explore-system again."
        });
      }
      repository.persist();
      return {
        exploration,
        gaps: [gap],
        brain: knowledgeService.getSystemBrain(project.id, system.id)
      };
    }
  }

  list(knowledgeProjectId: string, systemId?: string) {
    return this.input.repository.systemExplorations.filter(
      (item) =>
        item.knowledgeProjectId === knowledgeProjectId &&
        (!systemId || item.systemId === systemId)
    );
  }
}

export class PlaywrightSystemExplorer implements SystemExplorer {
  async explore(input: SystemExplorerInput): Promise<SystemExplorerResult> {
    const executablePath = browserExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    const context = await browser.newContext(
      input.storageStatePath ? { storageState: input.storageStatePath } : {}
    );
    const queue: Array<{ url: string; depth: number }> = [
      { url: canonicalUrl(input.startUrl), depth: 0 }
    ];
    const queued = new Set(queue.map((item) => item.url));
    const visited = new Set<string>();
    const pages: SystemExplorationPage[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];
    const deadline = Date.now() + input.budget.maxDurationMs;
    let budgetExhausted = false;

    try {
      while (queue.length > 0 && pages.length < input.budget.maxPages) {
        if (Date.now() >= deadline) {
          budgetExhausted = true;
          break;
        }
        const candidate = queue.shift();
        if (!candidate || visited.has(candidate.url)) continue;
        visited.add(candidate.url);
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const networkFailures: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("requestfailed", (request) => {
          networkFailures.push(
            `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`
          );
        });
        try {
          await page.goto(candidate.url, {
            waitUntil: "domcontentloaded",
            timeout: Math.max(1, Math.min(15_000, deadline - Date.now()))
          });
          const settleMs = Math.min(300, Math.max(0, deadline - Date.now()));
          if (settleMs > 0) await page.waitForTimeout(settleMs);
          const finalUrl = canonicalUrl(page.url());
          if (!isAllowedExplorationUrl(finalUrl, input.allowedUrls)) {
            warnings.push(`Ignored redirect outside allowlist: ${finalUrl}`);
            continue;
          }
          if (await isLoginOrChallengePage(page, finalUrl)) {
            blockers.push(`Authentication required at ${finalUrl}`);
            continue;
          }
          const capture = await capturePage(page, finalUrl, pages.length, input.artifactDir);
          const links = (await page.locator("a[href]").evaluateAll((anchors) =>
            anchors.map((anchor) => ({
              text: (anchor.textContent ?? "").trim(),
              url: (anchor as unknown as { href: string }).href
            }))
          ))
            .map((link) => ({ text: link.text, url: safeCanonicalUrl(link.url) }))
            .filter(
              (link): link is { text: string; url: string } =>
                Boolean(
                  link.url &&
                    isAllowedExplorationUrl(link.url, input.allowedUrls) &&
                    isReadOnlyNavigationUrl(link.url)
                )
            );
          pages.push({
            depth: candidate.depth,
            evidence: {
              ...capture,
              consoleErrors,
              networkFailures
            },
            links
          });
          if (candidate.depth < input.budget.maxDepth) {
            for (const link of links) {
              if (!queued.has(link.url) && !visited.has(link.url)) {
                queued.add(link.url);
                queue.push({ url: link.url, depth: candidate.depth + 1 });
              }
            }
          }
        } catch (error) {
          warnings.push(
            `Could not capture ${candidate.url}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        } finally {
          await page.close().catch(() => undefined);
        }
      }
      if (queue.length > 0 && pages.length >= input.budget.maxPages) {
        budgetExhausted = true;
      }
      if (pages.length === 0 && blockers.length === 0) {
        blockers.push("No page evidence could be captured within the exploration budget.");
      }
      return { pages, blockers, warnings, budgetExhausted };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

async function capturePage(
  page: import("@playwright/test").Page,
  finalUrl: string,
  index: number,
  artifactDir: string
): Promise<PageCaptureEvidence> {
  const screenshotPath = join(artifactDir, `page-${String(index + 1).padStart(2, "0")}.png`);
  const issues: string[] = [];
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    issues.push(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const domText = await page.locator("body").innerText().catch(() => "");
  const interactiveElements = await page
    .locator(
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]'
    )
    .evaluateAll((elements) =>
      elements.slice(0, 200).map((element, position) => {
        const html = element as unknown as {
          tagName: string;
          innerText?: string;
          textContent?: string | null;
          id: string;
          getAttribute(name: string): string | null;
        };
        const tag = html.tagName.toLowerCase();
        const input = element as unknown as { type?: string };
        const text = (html.innerText || html.textContent || "").trim();
        const name =
          html.getAttribute("aria-label") ||
          html.getAttribute("placeholder") ||
          html.getAttribute("name") ||
          text ||
          `${tag}-${position + 1}`;
        const explicitRole = html.getAttribute("role");
        const role =
          explicitRole ||
          (tag === "a"
            ? "link"
            : tag === "button"
              ? "button"
              : tag === "select"
                ? "combobox"
                : tag === "textarea"
                  ? "textbox"
                  : tag === "input" && input.type === "checkbox"
                    ? "checkbox"
                    : tag === "input" && input.type === "radio"
                      ? "radio"
                      : tag === "input"
                        ? "textbox"
                        : tag);
        const testId = html.getAttribute("data-testid");
        const idValue = html.id;
        const nameValue = html.getAttribute("name");
        const selector = testId
          ? `[data-testid=${JSON.stringify(testId)}]`
          : idValue
            ? `[id=${JSON.stringify(idValue)}]`
            : nameValue
              ? `${tag}[name=${JSON.stringify(nameValue)}]`
              : `${tag}:nth-of-type(${position + 1})`;
        return { name, role, text, selector };
      })
    );
  if (interactiveElements.length === 0) {
    issues.push("No interactive elements found");
  }
  return {
    title: (await page.title()) || finalUrl,
    finalUrl,
    domText: domText.slice(0, 50_000),
    screenshotPath,
    interactiveElements,
    consoleErrors: [],
    networkFailures: [],
    issues
  };
}

async function isLoginOrChallengePage(
  page: import("@playwright/test").Page,
  url: string
) {
  const path = new URL(url).pathname;
  if (/(?:^|\/)(?:login|sign-in|signin|sso|cas)(?:\/|$)/i.test(path)) return true;
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    return true;
  }
  const text = await page.locator("body").innerText().catch(() => "");
  return /\b(?:captcha|two-factor|2fa)\b|验证码|人机验证/i.test(text.slice(0, 10_000));
}

function normalizeBudget(input?: Partial<SystemExplorationBudget>): SystemExplorationBudget {
  const budget = {
    maxPages: input?.maxPages ?? DEFAULT_BUDGET.maxPages,
    maxDepth: input?.maxDepth ?? DEFAULT_BUDGET.maxDepth,
    maxDurationMs: input?.maxDurationMs ?? DEFAULT_BUDGET.maxDurationMs
  };
  if (!Number.isInteger(budget.maxPages) || budget.maxPages < 1 || budget.maxPages > 25) {
    throw new Error("Exploration maxPages must be an integer between 1 and 25");
  }
  if (!Number.isInteger(budget.maxDepth) || budget.maxDepth < 0 || budget.maxDepth > 4) {
    throw new Error("Exploration maxDepth must be an integer between 0 and 4");
  }
  if (
    !Number.isInteger(budget.maxDurationMs) ||
    budget.maxDurationMs < 5_000 ||
    budget.maxDurationMs > 300_000
  ) {
    throw new Error("Exploration maxDurationMs must be between 5000 and 300000");
  }
  return budget;
}

function assertResultWithinBudget(
  result: SystemExplorerResult,
  budget: SystemExplorationBudget,
  allowedUrls: string[]
) {
  if (result.pages.length > budget.maxPages) {
    throw new Error("Explorer output exceeded the approved page budget");
  }
  for (const page of result.pages) {
    if (!Number.isInteger(page.depth) || page.depth < 0 || page.depth > budget.maxDepth) {
      throw new Error("Explorer output exceeded the approved depth budget");
    }
    if (!isAllowedExplorationUrl(page.evidence.finalUrl, allowedUrls)) {
      throw new Error("Explorer output contains a page outside the business system allowlist");
    }
    if (page.evidence.domText.length > 50_000) {
      throw new Error("Explorer output contains DOM evidence above the 50000 character limit");
    }
    if (page.evidence.interactiveElements.length > 200) {
      throw new Error("Explorer output contains more than 200 interactive elements on one page");
    }
  }
}

export function isAllowedExplorationUrl(candidate: string, allowedUrls: string[]) {
  const value = safeUrl(candidate);
  if (!value || !["http:", "https:"].includes(value.protocol)) return false;
  return allowedUrls.some((allowed) => {
    const scope = safeUrl(allowed);
    if (!scope || scope.origin !== value.origin) return false;
    const scopePath = normalizePath(scope.pathname);
    const candidatePath = normalizePath(value.pathname);
    return (
      scopePath === "/" ||
      candidatePath === scopePath ||
      candidatePath.startsWith(`${scopePath}/`)
    );
  });
}

export function isReadOnlyNavigationUrl(candidate: string) {
  const url = new URL(candidate);
  const unsafeAction =
    /(?:^|\/)(?:logout|signout|delete|remove|approve|reject|submit|publish|disable|enable)(?:\/|$)/i.test(
      url.pathname
    ) ||
    [...url.searchParams].some(
      ([key, value]) =>
        /^(?:action|op|operation|command)$/i.test(key) &&
        /^(?:logout|signout|delete|remove|approve|reject|submit|publish|disable|enable)$/i.test(
          value
        )
    );
  return !unsafeAction;
}

function uniquePages(pages: SystemExplorationPage[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = canonicalUrl(page.evidence.finalUrl);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueUrls(urls: string[]) {
  return [...new Set(urls.map(canonicalUrl))];
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("System exploration only supports http and https URLs");
  }
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

function safeCanonicalUrl(value: string) {
  try {
    return canonicalUrl(value);
  } catch {
    return undefined;
  }
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function normalizePath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

function isAuthenticationBlocker(reason: string) {
  return /auth|login|sign-in|storage state|captcha|2fa|验证码|登录|认证/i.test(reason);
}

function createExplorationGap(
  repository: InMemoryBrainCreatorRepository,
  knowledgeProjectId: string,
  explorationId: string,
  reason: string
): Gap {
  const now = new Date().toISOString();
  const gap: Gap = {
    id: id("gap"),
    projectId: knowledgeProjectId,
    sourceType: "system-exploration",
    sourceId: explorationId,
    reason,
    severity: "high",
    owner: "qa",
    status: "open",
    createdAt: now,
    updatedAt: now
  };
  repository.gaps.push(gap);
  return gap;
}
