import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { browserExecutablePath } from "../agent/authStateVerifier.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BrainCreatorService } from "../domain/service.js";
import type {
  Gap,
  PageCaptureEvidence,
  SystemExploration,
  SystemExplorationBudget,
  SystemInteractionState
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import type { KnowledgeService } from "./service.js";

export type SystemExplorationPage = {
  depth: number;
  evidence: PageCaptureEvidence;
  links: Array<{ text: string; url: string }>;
  interactions?: SystemInteractionEvidence[];
};

export type SystemInteractionEvidence = {
  target: {
    name: string;
    role: string;
    selector: string;
    kind: "tab" | "disclosure" | "select";
  };
  action: "click" | "select";
  inputValue?: string;
  before: SystemInteractionState;
  after: SystemInteractionState;
  visibleAdded: string[];
  visibleRemoved: string[];
  dialogAdded: string[];
  dialogRemoved: string[];
  urlChanged: boolean;
  blockedRequests: Array<{ method: string; url: string }>;
  status: "observed" | "no-change" | "blocked" | "failed";
  screenshotPath?: string;
};

export type SafeInteractionCandidate = {
  name: string;
  role: string;
  selector: string;
  tag: string;
  ariaExpanded?: string;
  ariaControls?: string;
  currentValue?: string;
  options?: Array<{ value: string; label: string; disabled: boolean }>;
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
  interactionMode: "off" | "safe";
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
  interactionMode?: "off" | "safe";
  budget?: Partial<SystemExplorationBudget>;
};

const DEFAULT_BUDGET: SystemExplorationBudget = {
  maxPages: 5,
  maxDepth: 2,
  maxDurationMs: 60_000,
  maxInteractionsPerPage: 0
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
    const interactionMode = request.interactionMode ?? "off";
    if (interactionMode === "off" && budget.maxInteractionsPerPage > 0) {
      throw new Error("maxInteractionsPerPage requires interactionMode=safe");
    }
    if (interactionMode === "safe" && budget.maxInteractionsPerPage === 0) {
      budget.maxInteractionsPerPage = 3;
    }
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
      ? await resolveProtectedStorageStatePath(workDir, storageStateValue)
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
      interactionMode,
      budget,
      pageModelIds: [],
      navigationEdges: [],
      interactionTransitions: [],
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
        interactionMode,
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
      exploration.interactionTransitions = result.pages.flatMap((page) => {
        const pageUrl = canonicalUrl(page.evidence.finalUrl);
        const pageModelId = captured.get(pageUrl);
        if (!pageModelId) return [];
        return (page.interactions ?? []).map((transition) => ({
          id: id("systemInteraction"),
          pageModelId,
          pageUrl,
          targetName: transition.target.name,
          targetRole: transition.target.role,
          targetSelector: transition.target.selector,
          targetKind: transition.target.kind,
          action: transition.action,
          inputValue: transition.inputValue,
          before: transition.before,
          after: transition.after,
          visibleAdded: transition.visibleAdded,
          visibleRemoved: transition.visibleRemoved,
          dialogAdded: transition.dialogAdded,
          dialogRemoved: transition.dialogRemoved,
          urlChanged: transition.urlChanged,
          blockedRequests: transition.blockedRequests,
          status: transition.status,
          screenshotPath: transition.screenshotPath
        }));
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
          const interactions =
            input.interactionMode === "safe" && input.budget.maxInteractionsPerPage > 0
              ? await probeSafeInteractions({
                  page,
                  pageUrl: finalUrl,
                  allowedUrls: input.allowedUrls,
                  artifactDir: input.artifactDir,
                  pageIndex: pages.length,
                  limit: input.budget.maxInteractionsPerPage,
                  deadline
                })
              : [];
          pages.push({
            depth: candidate.depth,
            evidence: {
              ...capture,
              consoleErrors,
              networkFailures
            },
            links,
            interactions
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

export function classifySafeInteractionCandidate(candidate: SafeInteractionCandidate):
  | { allowed: true; action: "click"; kind: "tab" | "disclosure" }
  | { allowed: true; action: "select"; kind: "select"; inputValue: string }
  | { allowed: false; reason: string } {
  const label = candidate.name.trim();
  if (!label || isUnsafeInteractionLabel(label)) {
    return { allowed: false, reason: "The control label is missing or suggests a write action" };
  }
  if (!candidate.selector || /nth-of-type|nth-child/i.test(candidate.selector)) {
    return { allowed: false, reason: "The control has no stable selector" };
  }
  if (candidate.tag === "select") {
    const option = candidate.options?.find(
      (item) => !item.disabled && item.value !== candidate.currentValue && item.value !== ""
    );
    return option
      ? { allowed: true, action: "select", kind: "select", inputValue: option.value }
      : { allowed: false, reason: "The select has no safe alternative option" };
  }
  if (
    candidate.role.toLowerCase() === "tab" ||
    candidate.ariaExpanded !== undefined ||
    Boolean(candidate.ariaControls)
  ) {
    return {
      allowed: true,
      action: "click",
      kind: candidate.role.toLowerCase() === "tab" ? "tab" : "disclosure"
    };
  }
  return { allowed: false, reason: "Only tabs, disclosure controls, and native selects are safe" };
}

async function probeSafeInteractions(input: {
  page: import("@playwright/test").Page;
  pageUrl: string;
  allowedUrls: string[];
  artifactDir: string;
  pageIndex: number;
  limit: number;
  deadline: number;
}): Promise<SystemInteractionEvidence[]> {
  const candidates = (await collectInteractionCandidates(input.page))
    .map((candidate) => ({ candidate, decision: classifySafeInteractionCandidate(candidate) }))
    .filter(
      (
        item
      ): item is {
        candidate: SafeInteractionCandidate;
        decision:
          | { allowed: true; action: "click"; kind: "tab" | "disclosure" }
          | { allowed: true; action: "select"; kind: "select"; inputValue: string };
      } => item.decision.allowed
    )
    .slice(0, input.limit);
  const transitions: SystemInteractionEvidence[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    if (Date.now() >= input.deadline) break;
    const { candidate, decision } = candidates[index];
    const before = await captureInteractionState(input.page);
    const blockedRequests: Array<{ method: string; url: string }> = [];
    const routeHandler = async (route: import("@playwright/test").Route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const requestUrl = request.url();
      const unsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(method);
      const guardedRequest =
        request.isNavigationRequest() ||
        request.resourceType() === "xhr" ||
        request.resourceType() === "fetch";
      const unsafeRequestUrl =
        guardedRequest && !isReadOnlyNavigationUrl(requestUrl);
      const outsideAllowlist =
        guardedRequest && !isAllowedExplorationUrl(requestUrl, input.allowedUrls);
      if (unsafeMethod || unsafeRequestUrl || outsideAllowlist) {
        blockedRequests.push({ method, url: requestUrl });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    };
    await input.page.route("**/*", routeHandler);
    let after = before;
    let status: SystemInteractionEvidence["status"] = "failed";
    let screenshotPath: string | undefined;
    try {
      const target = input.page.locator(candidate.selector).first();
      if (!(await target.isVisible())) {
        throw new Error("Safe interaction target is not visible");
      }
      if (decision.action === "select") {
        await target.selectOption(decision.inputValue, {
          timeout: interactionTimeout(input.deadline)
        });
      } else {
        await target.click({ timeout: interactionTimeout(input.deadline) });
      }
      const settleMs = Math.min(300, Math.max(0, input.deadline - Date.now()));
      if (settleMs > 0) await input.page.waitForTimeout(settleMs);
      after = await captureInteractionState(input.page);
      status =
        blockedRequests.length > 0
          ? "blocked"
          : statesDiffer(before, after)
            ? "observed"
            : "no-change";
      if (status === "observed") {
        screenshotPath = join(
          input.artifactDir,
          `interaction-${String(input.pageIndex + 1).padStart(2, "0")}-${String(
            index + 1
          ).padStart(2, "0")}.png`
        );
        await input.page
          .screenshot({ path: screenshotPath, fullPage: true })
          .catch(() => {
            screenshotPath = undefined;
          });
      }
    } catch {
      status = blockedRequests.length > 0 ? "blocked" : "failed";
    } finally {
      await input.page.unroute("**/*", routeHandler).catch(() => undefined);
    }
    transitions.push({
      target: {
        name: candidate.name,
        role: candidate.role,
        selector: candidate.selector,
        kind: decision.kind
      },
      action: decision.action,
      inputValue: decision.action === "select" ? decision.inputValue : undefined,
      before,
      after,
      visibleAdded: difference(after.visibleElements, before.visibleElements),
      visibleRemoved: difference(before.visibleElements, after.visibleElements),
      dialogAdded: difference(after.dialogs, before.dialogs),
      dialogRemoved: difference(before.dialogs, after.dialogs),
      urlChanged: before.url !== after.url,
      blockedRequests,
      status,
      screenshotPath
    });
    if (Date.now() < input.deadline) {
      await input.page
        .goto(input.pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: interactionTimeout(input.deadline)
        })
        .catch(() => undefined);
      const settleMs = Math.min(200, Math.max(0, input.deadline - Date.now()));
      if (settleMs > 0) await input.page.waitForTimeout(settleMs);
    }
  }
  return transitions;
}

async function collectInteractionCandidates(
  page: import("@playwright/test").Page
): Promise<SafeInteractionCandidate[]> {
  return page
    .locator('[role="tab"], button[aria-expanded], button[aria-controls], select')
    .evaluateAll((elements) =>
      elements.slice(0, 50).flatMap((element) => {
        const html = element as unknown as {
          tagName: string;
          id: string;
          textContent?: string | null;
          getAttribute(name: string): string | null;
        };
        const select = element as unknown as {
          value?: string;
          labels?: ArrayLike<{ textContent?: string | null }>;
          options?: ArrayLike<{
            value: string;
            textContent?: string | null;
            disabled: boolean;
          }>;
        };
        const tag = html.tagName.toLowerCase();
        const testId = html.getAttribute("data-testid");
        const nameValue = html.getAttribute("name");
        const ariaControls = html.getAttribute("aria-controls") ?? undefined;
        const ariaExpanded = html.getAttribute("aria-expanded") ?? undefined;
        const selector = testId
          ? `[data-testid=${JSON.stringify(testId)}]`
          : html.id
            ? `[id=${JSON.stringify(html.id)}]`
            : nameValue
              ? `${tag}[name=${JSON.stringify(nameValue)}]`
              : ariaControls
                ? `[aria-controls=${JSON.stringify(ariaControls)}]`
                : "";
        const name =
          html.getAttribute("aria-label") ||
          (select.labels
            ? Array.from(select.labels)
                .map((label) =>
                  (label.textContent ?? "")
                    .replace(html.textContent ?? "", "")
                    .trim()
                )
                .filter(Boolean)
                .join(" ")
            : "") ||
          nameValue ||
          (html.textContent ?? "").trim();
        const options = select.options
          ? Array.from(select.options).map((option) => ({
              value: option.value,
              label: (option.textContent ?? "").trim(),
              disabled: option.disabled
            }))
          : undefined;
        return [{
          name,
          role: html.getAttribute("role") || (tag === "select" ? "combobox" : "button"),
          selector,
          tag,
          ariaExpanded,
          ariaControls,
          currentValue: select.value,
          options
        }];
      })
    );
}

async function captureInteractionState(
  page: import("@playwright/test").Page
): Promise<SystemInteractionState> {
  const visibleElements = await page
    .locator(
      'button, input, select, textarea, a[href], [role="tab"], [role="dialog"], [aria-label]'
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const html = element as unknown as {
          textContent?: string | null;
          getAttribute(name: string): string | null;
          getBoundingClientRect(): { width: number; height: number };
        };
        const formControl = element as unknown as {
          labels?: ArrayLike<{ textContent?: string | null }>;
        };
        const bounds = html.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return [];
        const name =
          html.getAttribute("aria-label") ||
          html.getAttribute("placeholder") ||
          (formControl.labels
            ? Array.from(formControl.labels)
                .map((label) =>
                  (label.textContent ?? "")
                    .replace(html.textContent ?? "", "")
                    .trim()
                )
                .filter(Boolean)
                .join(" ")
            : "") ||
          html.getAttribute("name") ||
          (html.textContent ?? "").trim();
        return name ? [name] : [];
      })
    );
  const dialogs = await page.locator('[role="dialog"]').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const html = element as unknown as {
        textContent?: string | null;
        getAttribute(name: string): string | null;
        getBoundingClientRect(): { width: number; height: number };
      };
      const bounds = html.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return [];
      const label =
        html.getAttribute("aria-label") || (html.textContent ?? "").trim().slice(0, 120);
      return label ? [label] : [];
    })
  );
  const state = {
    url: canonicalUrl(page.url()),
    visibleElements: uniqueSorted(visibleElements),
    dialogs: uniqueSorted(dialogs)
  };
  return {
    id: `state-${createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16)}`,
    ...state
  };
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
        const input = element as unknown as {
          type?: string;
          labels?: ArrayLike<{ textContent?: string | null }>;
        };
        const tag = html.tagName.toLowerCase();
        const text = (html.innerText || html.textContent || "").trim();
        const associatedLabel = input.labels
          ? Array.from(input.labels)
              .map((label) =>
                (label.textContent ?? "")
                  .replace(html.textContent ?? "", "")
                  .trim()
              )
              .filter(Boolean)
              .join(" ")
          : "";
        const name =
          html.getAttribute("aria-label") ||
          html.getAttribute("placeholder") ||
          associatedLabel ||
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
    maxDurationMs: input?.maxDurationMs ?? DEFAULT_BUDGET.maxDurationMs,
    maxInteractionsPerPage:
      input?.maxInteractionsPerPage ?? DEFAULT_BUDGET.maxInteractionsPerPage
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
  if (
    !Number.isInteger(budget.maxInteractionsPerPage) ||
    budget.maxInteractionsPerPage < 0 ||
    budget.maxInteractionsPerPage > 10
  ) {
    throw new Error("Exploration maxInteractionsPerPage must be between 0 and 10");
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
    if ((page.interactions?.length ?? 0) > budget.maxInteractionsPerPage) {
      throw new Error("Explorer output exceeded the approved interaction budget");
    }
    for (const interaction of page.interactions ?? []) {
      if (
        interaction.status === "observed" &&
        interaction.blockedRequests.length > 0
      ) {
        throw new Error("Explorer marked a blocked interaction as observed");
      }
      if (
        isUnsafeInteractionLabel(interaction.target.name) ||
        (interaction.target.kind === "select" && interaction.action !== "select") ||
        (interaction.target.kind !== "select" && interaction.action !== "click") ||
        (interaction.target.kind === "tab" &&
          interaction.target.role.toLowerCase() !== "tab")
      ) {
        throw new Error("Explorer output contains an interaction outside the safe policy");
      }
      if (
        !isAllowedExplorationUrl(interaction.before.url, allowedUrls) ||
        !isAllowedExplorationUrl(interaction.after.url, allowedUrls)
      ) {
        throw new Error("Explorer interaction state is outside the business system allowlist");
      }
      if (
        !page.evidence.interactiveElements.some(
          (element) =>
            element.selector === interaction.target.selector &&
            element.name === interaction.target.name
        )
      ) {
        throw new Error("Explorer interaction target is not present in the captured page evidence");
      }
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

function isUnsafeInteractionLabel(value: string) {
  return /\b(?:save|delete|remove|approve|reject|submit|publish|create|add|confirm|send|pay|upload|import|export|enable|disable|logout|signout)\b|保存|删除|移除|审批|通过|驳回|拒绝|提交|发布|创建|新建|新增|确认|发送|支付|上传|导入|导出|启用|停用|退出/i.test(
    value
  );
}

function statesDiffer(left: SystemInteractionState, right: SystemInteractionState) {
  return (
    left.url !== right.url ||
    left.visibleElements.join("\u0000") !== right.visibleElements.join("\u0000") ||
    left.dialogs.join("\u0000") !== right.dialogs.join("\u0000")
  );
}

function difference(left: string[], right: string[]) {
  const excluded = new Set(right);
  return left.filter((item) => !excluded.has(item));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function interactionTimeout(deadline: number) {
  return Math.max(1, Math.min(5_000, deadline - Date.now()));
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
