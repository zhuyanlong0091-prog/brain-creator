import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { browserExecutablePath } from "../agent/authStateVerifier.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BrainCreatorService } from "../domain/service.js";
import type {
  ExplorationScenario,
  Gap,
  InteractionSurfaceRef,
  PageCaptureEvidence,
  SystemExploration,
  SystemExplorationBudget,
  SystemExplorationNavigationEdge,
  SystemInteractionState
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import {
  capturePopupSurfaceEvidence,
  collectBrowserSurfaceEvidence,
  stableChildFrameEntries as stableBrowserChildFrameEntries
} from "./browserSurface.js";
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
  changedControls?: Array<{ name: string; before: string; after: string }>;
  urlChanged: boolean;
  transitionKind?: "navigation" | "state";
  blockedRequests: Array<{ method: string; url: string }>;
  status: "observed" | "no-change" | "blocked" | "failed";
  surface?: InteractionSurfaceRef;
  reacquiredPage?: boolean;
  screenshotPath?: string;
  scenarioId?: string;
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
  surface?: InteractionSurfaceRef;
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
  scenario?: ExplorationScenario;
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
  scenario?: Omit<ExplorationScenario, "id"> & { id?: string };
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
    const scenario = normalizeExplorationScenario(request.scenario);
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
    const invalidLeaseIds = (scenario?.testDataLeaseIds ?? []).filter((leaseId) => {
      const lease = repository.testDataLeases.find((item) => item.id === leaseId);
      return !lease || lease.systemId !== system.id || lease.status !== "active";
    });
    if (invalidLeaseIds.length > 0) {
      throw new Error(
        `Exploration scenario references unavailable or cross-system test data lease(s): ${invalidLeaseIds.join(", ")}`
      );
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
      ...(scenario ? { scenario } : {}),
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
        scenario,
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
          surface: transition.surface,
          action: transition.action,
          inputValue: transition.inputValue,
          before: transition.before,
          after: transition.after,
          visibleAdded: transition.visibleAdded,
          visibleRemoved: transition.visibleRemoved,
          dialogAdded: transition.dialogAdded,
          dialogRemoved: transition.dialogRemoved,
          changedControls: transition.changedControls,
          urlChanged: transition.urlChanged,
          transitionKind: transition.transitionKind,
          blockedRequests: transition.blockedRequests,
          status: transition.status,
          reacquiredPage: transition.reacquiredPage,
          screenshotPath: transition.screenshotPath,
          scenarioId: transition.scenarioId
        }));
      });
      exploration.navigationEdges = mergeNavigationEdges([
        ...exploration.navigationEdges,
        ...exploration.interactionTransitions.flatMap((transition) => {
          if (
            transition.status !== "observed" ||
            !transition.urlChanged ||
            !isAllowedExplorationUrl(transition.after.url, allowedUrls)
          ) {
            return [];
          }
          const toUrl = canonicalUrl(transition.after.url);
          return [{
            fromUrl: transition.pageUrl,
            toUrl,
            text: transition.targetName,
            fromPageModelId: transition.pageModelId,
            toPageModelId: captured.get(toUrl)
          }];
        })
      ]);
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
        const popups: Array<import("@playwright/test").Page> = [];
        page.on("popup", (popup) => popups.push(popup));
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
          const capture = await capturePage(
            page,
            finalUrl,
            pages.length,
            input.artifactDir,
            input.allowedUrls
          );
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
          let interactions =
            input.interactionMode === "safe" && input.budget.maxInteractionsPerPage > 0
              ? await probeSafeInteractions({
                  page,
                  context,
                  pageUrl: finalUrl,
                  allowedUrls: input.allowedUrls,
                  artifactDir: input.artifactDir,
                  pageIndex: pages.length,
                  limit: input.budget.maxInteractionsPerPage,
                  deadline,
                  warnings,
                  blockers,
                  popups,
                scenario: input.scenario
              })
              : [];
          if (input.interactionMode === "safe" && input.budget.maxInteractionsPerPage > interactions.length) {
            interactions = [
              ...interactions,
              ...(await probeSafePopupInteractions({
                popups,
                allowedUrls: input.allowedUrls,
                artifactDir: input.artifactDir,
                pageIndex: pages.length,
                limit: input.budget.maxInteractionsPerPage - interactions.length,
                deadline,
                warnings,
                blockers,
                scenario: input.scenario
              }))
            ];
          }
          for (const [popupIndex, popup] of popups.entries()) {
            try {
              if (popup.isClosed()) {
                warnings.push("Popup closed before capture; main page evidence was retained.");
                continue;
              }
              await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
              if (popup.isClosed()) {
                warnings.push("Popup closed before capture; main page evidence was retained.");
                continue;
              }
              const popupUrl = safeCanonicalUrl(popup.url());
              if (!popupUrl || !isAllowedExplorationUrl(popupUrl, input.allowedUrls)) {
                warnings.push(`Ignored popup outside allowlist: ${popup.url() || "unknown"}`);
                continue;
              }
              const popupSurface = await capturePopupSurfaceEvidence(
                popup,
                finalUrl,
                join(
                  input.artifactDir,
                  `popup-${String(pages.length + 1).padStart(2, "0")}-${String(
                    popupIndex + 1
                  ).padStart(2, "0")}.png`
                )
              );
              capture.surfaces = [...(capture.surfaces ?? []), popupSurface];
              if (!queued.has(popupUrl) && !visited.has(popupUrl)) {
                queued.add(popupUrl);
                queue.push({ url: popupUrl, depth: candidate.depth + 1 });
              }
            } catch (error) {
              warnings.push(
                `Could not capture popup: ${error instanceof Error ? error.message : String(error)}`
              );
            } finally {
              await popup.close().catch(() => undefined);
            }
          }
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
          for (const interaction of interactions) {
            if (
              interaction.status === "observed" &&
              interaction.urlChanged &&
              isAllowedExplorationUrl(interaction.after.url, input.allowedUrls) &&
              !queued.has(interaction.after.url) &&
              !visited.has(interaction.after.url)
            ) {
              queued.add(interaction.after.url);
              queue.push({ url: interaction.after.url, depth: candidate.depth + 1 });
            }
          }
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

export function classifySafeInteractionCandidate(
  candidate: SafeInteractionCandidate,
  scenario?: Pick<ExplorationScenario, "selectorValues">
):
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
  if (
    candidate.surface &&
    (candidate.surface.kind === "shadow-root" || candidate.surface.kind === "wujie") &&
    (candidate.surface.hostSelectors?.length ?? 0) === 0
  ) {
    return { allowed: false, reason: "The shadow surface has no stable host selector" };
  }
  if (candidate.tag === "select") {
    const requestedValue = scenario?.selectorValues[candidate.selector] ??
      scenario?.selectorValues[candidate.name];
    const option = requestedValue
      ? candidate.options?.find(
          (item) =>
            !item.disabled &&
            (item.value === requestedValue || item.label === requestedValue)
        )
      : candidate.options?.find(
          (item) => !item.disabled && item.value !== candidate.currentValue && item.value !== ""
        );
    return option
      ? { allowed: true, action: "select", kind: "select", inputValue: option.value }
      : {
          allowed: false,
          reason: requestedValue
            ? `The requested scenario value is unavailable: ${requestedValue}`
            : "The select has no safe alternative option"
        };
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
  context: import("@playwright/test").BrowserContext;
  pageUrl: string;
  allowedUrls: string[];
  artifactDir: string;
  pageIndex: number;
  limit: number;
  deadline: number;
  warnings: string[];
  blockers: string[];
  popups: Array<import("@playwright/test").Page>;
  scenario?: ExplorationScenario;
}): Promise<SystemInteractionEvidence[]> {
  let activePage = input.page;
  let activePageUrl = input.pageUrl;
  const registerPopupListener = (page: import("@playwright/test").Page) => {
    page.on("popup", (popup) => input.popups.push(popup));
  };
  const rememberActivePageUrl = (page: import("@playwright/test").Page) => {
    const url = safeCanonicalUrl(page.url());
    if (url && isAllowedExplorationUrl(url, input.allowedUrls)) activePageUrl = url;
  };
  const recoveryUrl = () =>
    isAllowedExplorationUrl(activePageUrl, input.allowedUrls) ? activePageUrl : input.pageUrl;
  const candidates = (await collectInteractionCandidates(activePage, input.allowedUrls))
    .map((candidate) => ({
      candidate,
      decision: classifySafeInteractionCandidate(candidate, input.scenario)
    }))
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
    let reacquiredPage = false;
    if (activePage.isClosed()) {
      const replacement = await reacquirePage(input.context, recoveryUrl(), input.deadline);
      if (!replacement) {
        const reason = `Surface recovery failed before interacting with ${candidateName(candidates[index]?.candidate)} at ${recoveryUrl()}`;
        input.warnings.push(reason);
        input.blockers.push(reason);
        break;
      }
      activePage = replacement;
      registerPopupListener(activePage);
      reacquiredPage = true;
    }
    const { candidate, decision } = candidates[index];
    let before: SystemInteractionState;
    try {
      before = await captureInteractionState(activePage, input.allowedUrls);
    } catch {
      const reason = `Surface recovery failed while reading interaction state at ${recoveryUrl()}`;
      input.warnings.push(reason);
      input.blockers.push(reason);
      break;
    }
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
    await activePage.route("**/*", routeHandler);
    const routedPages = new Set<import("@playwright/test").Page>([activePage]);
    let after = before;
    let status: SystemInteractionEvidence["status"] = "failed";
    let screenshotPath: string | undefined;
    try {
      let actionCompleted = false;
      for (let attempt = 0; attempt < 2 && !actionCompleted; attempt += 1) {
        try {
          const target = interactionLocator(activePage, candidate, input.allowedUrls).first();
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
          actionCompleted = true;
        } catch (error) {
          if (attempt > 0 || Date.now() >= input.deadline) throw error;
          rememberActivePageUrl(activePage);
          const replacement = await reacquirePage(input.context, recoveryUrl(), input.deadline);
          if (!replacement) throw error;
          await activePage.unroute("**/*", routeHandler).catch(() => undefined);
          activePage = replacement;
          registerPopupListener(activePage);
          routedPages.add(activePage);
          await activePage.route("**/*", routeHandler);
          reacquiredPage = true;
        }
      }
      const settleMs = Math.min(300, Math.max(0, input.deadline - Date.now()));
      if (settleMs > 0) await activePage.waitForTimeout(settleMs);
      if (activePage.isClosed()) {
        const replacement = await reacquirePage(input.context, recoveryUrl(), input.deadline);
        if (!replacement) throw new Error("Active page closed and could not be reacquired");
        activePage = replacement;
        registerPopupListener(activePage);
        reacquiredPage = true;
      }
      rememberActivePageUrl(activePage);
      after = await captureInteractionState(activePage, input.allowedUrls);
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
        await activePage
          .screenshot({ path: screenshotPath, fullPage: true })
          .catch(() => {
            screenshotPath = undefined;
          });
      }
    } catch (error) {
      status = blockedRequests.length > 0 ? "blocked" : "failed";
      if (candidate.surface && status === "failed") {
        const reason = `Surface interaction failed for ${candidate.surface.kind} at ${candidate.surface.url}: ${error instanceof Error ? error.message : String(error)}`;
        input.warnings.push(reason);
        input.blockers.push(reason);
      }
    } finally {
      await Promise.all(
        [...routedPages].map((page) => page.unroute("**/*", routeHandler).catch(() => undefined))
      );
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
      changedControls: changedControls(before.controlValues, after.controlValues),
      urlChanged: before.url !== after.url,
      ...(status === "observed"
        ? { transitionKind: before.url !== after.url ? "navigation" as const : "state" as const }
        : {}),
      blockedRequests,
      status,
      surface: candidate.surface,
      ...(reacquiredPage ? { reacquiredPage: true } : {}),
      screenshotPath,
      ...(input.scenario ? { scenarioId: input.scenario.id } : {})
    });
    if (Date.now() < input.deadline) {
      try {
        await activePage.goto(input.pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: interactionTimeout(input.deadline)
        });
      } catch (error) {
        const reason = `Surface recovery failed while resetting the page to ${input.pageUrl}: ${error instanceof Error ? error.message : String(error)}`;
        input.warnings.push(reason);
        input.blockers.push(reason);
        break;
      }
      activePageUrl = input.pageUrl;
      const settleMs = Math.min(200, Math.max(0, input.deadline - Date.now()));
      if (settleMs > 0) await activePage.waitForTimeout(settleMs);
    }
  }
  return transitions;
}

async function collectInteractionCandidates(
  page: import("@playwright/test").Page,
  allowedUrls: string[]
): Promise<SafeInteractionCandidate[]> {
  const main = await collectInteractionCandidatesFromSurface(page, {
    kind: "document",
    url: canonicalUrl(page.url())
  });
  const frames = await Promise.all(
    stableChildFrameEntries(page).map(async ({ frame, frameIndex }) => {
      if (!isAllowedExplorationUrl(frame.url(), allowedUrls)) return [];
      return collectInteractionCandidatesFromSurface(frame, {
        kind: "iframe",
        url: canonicalUrl(frame.url()),
        parentUrl: canonicalUrl(page.url()),
        frameIndex
      });
    })
  );
  const shadow = await collectOpenShadowInteractionCandidates(page, {
    kind: "shadow-root",
    url: canonicalUrl(page.url()),
    parentUrl: canonicalUrl(page.url())
  });
  return [...main, ...frames.flat(), ...shadow];
}

function candidateName(candidate?: SafeInteractionCandidate) {
  return candidate?.name?.trim() || "the selected interaction";
}

async function collectOpenShadowInteractionCandidates(
  page: import("@playwright/test").Page,
  surfaceRef: InteractionSurfaceRef
): Promise<SafeInteractionCandidate[]> {
  return page.evaluate(() => {
    const documentLike = (globalThis as unknown as {
      document: {
        querySelectorAll(selector: string): ArrayLike<ElementLike>;
      };
    }).document;
    type ElementLike = {
      tagName: string;
      id: string;
      textContent?: string | null;
      value?: string;
      labels?: ArrayLike<{ textContent?: string | null }>;
      options?: ArrayLike<{ value: string; textContent?: string | null; disabled: boolean }>;
      getAttribute(name: string): string | null;
      matches(selector: string): boolean;
      getRootNode(): { host?: ElementLike };
      shadowRoot?: { querySelectorAll(selector: string): ArrayLike<ElementLike> } | null;
    };
    const selectors = '[role="tab"], button[aria-expanded], button[aria-controls], select';
    const stableHostSelector = (element: ElementLike) => {
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid=${JSON.stringify(testId)}]`;
      if (element.id) return `[id=${JSON.stringify(element.id)}]`;
      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`;
      return undefined;
    };
    const collect = (
      root: { querySelectorAll(selector: string): ArrayLike<ElementLike> },
      inWujie: boolean,
      hostSelectors: string[]
    ) => {
      const results: Array<{
        name: string;
        role: string;
        selector: string;
        tag: string;
        ariaExpanded?: string;
        ariaControls?: string;
        currentValue?: string;
        options?: Array<{ value: string; label: string; disabled: boolean }>;
        surfaceKind: "shadow-root" | "wujie";
        hostSelectors: string[];
      }> = [];
      for (const element of Array.from(root.querySelectorAll(selectors))) {
        const tag = element.tagName.toLowerCase();
        const testId = element.getAttribute("data-testid");
        const nameValue = element.getAttribute("name");
        const ariaControls = element.getAttribute("aria-controls") ?? undefined;
        const selector = testId
          ? `[data-testid=${JSON.stringify(testId)}]`
          : element.id
            ? `[id=${JSON.stringify(element.id)}]`
            : nameValue
              ? `${tag}[name=${JSON.stringify(nameValue)}]`
              : ariaControls
                ? `[aria-controls=${JSON.stringify(ariaControls)}]`
                : "";
        const name = element.getAttribute("aria-label") ||
          (element.labels
            ? Array.from(element.labels)
                .map((label) => (label.textContent ?? "").trim())
                .filter(Boolean)
                .join(" ")
            : "") ||
          nameValue ||
          (element.textContent ?? "").trim();
        results.push({
          name,
          role: element.getAttribute("role") || (tag === "select" ? "combobox" : "button"),
          selector,
          tag,
          ariaExpanded: element.getAttribute("aria-expanded") ?? undefined,
          ariaControls,
          currentValue: element.value,
          options: element.options
            ? Array.from(element.options).map((option) => ({
                value: option.value,
                label: (option.textContent ?? "").trim(),
                disabled: option.disabled
              }))
            : undefined,
          surfaceKind: inWujie ? "wujie" : "shadow-root",
          hostSelectors
        });
      }
      for (const host of Array.from(root.querySelectorAll("*"))) {
        if (host.shadowRoot) {
          const hostSelector = stableHostSelector(host);
          results.push(
            ...collect(
              host.shadowRoot,
              inWujie || host.matches("[data-wujie], wujie-app, [class*='wujie']"),
              hostSelector ? [...hostSelectors, hostSelector] : []
            )
          );
        }
      }
      return results;
    };
    const results: ReturnType<typeof collect> = [];
    for (const host of Array.from(documentLike.querySelectorAll("*"))) {
      if (host.shadowRoot) {
        const hostSelector = stableHostSelector(host);
        results.push(
          ...collect(
            host.shadowRoot,
            host.matches("[data-wujie], wujie-app, [class*='wujie']"),
            hostSelector ? [hostSelector] : []
          )
        );
      }
    }
    return results;
  }).then((candidates) => candidates.map((candidate) => ({
    ...candidate,
    surface: {
      ...surfaceRef,
      kind: candidate.surfaceKind,
      ...(candidate.hostSelectors.length > 0
        ? { hostSelectors: candidate.hostSelectors }
        : {})
    }
  })));
}

async function collectInteractionCandidatesFromSurface(
  surface: import("@playwright/test").Page | import("@playwright/test").Frame,
  surfaceRef: InteractionSurfaceRef
): Promise<SafeInteractionCandidate[]> {
  const candidates = await surface
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
  return Promise.all(
    candidates.map(async (candidate) => {
      const surfaceState = await surface
        .locator(candidate.selector)
        .first()
          .evaluate((element) => {
          const root = element.getRootNode() as {
            toString(): string;
            host?: {
              id: string;
              tagName: string;
              getAttribute(name: string): string | null;
              matches(selector: string): boolean;
              getRootNode(): unknown;
            };
          };
          const hostSelectors: string[] = [];
          let currentRoot = root;
          while (currentRoot.host) {
            const host = currentRoot.host;
            const testId = host.getAttribute("data-testid");
            const name = host.getAttribute("name");
            const selector = testId
              ? `[data-testid=${JSON.stringify(testId)}]`
              : host.id
                ? `[id=${JSON.stringify(host.id)}]`
                : name
                  ? `${host.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`
                  : undefined;
            if (!selector) break;
            hostSelectors.unshift(selector);
            currentRoot = host.getRootNode() as typeof currentRoot;
          }
          return {
            inShadowRoot: root.toString() === "[object ShadowRoot]",
            inWujie: Boolean(root.host?.matches("[data-wujie], wujie-app, [class*='wujie']")),
            hostSelectors
          };
        })
        .catch(() => ({ inShadowRoot: false, inWujie: false, hostSelectors: [] }));
      if (!surfaceState.inShadowRoot) return { ...candidate, surface: surfaceRef };
      const kind: InteractionSurfaceRef["kind"] = surfaceState.inWujie
        ? "wujie"
        : "shadow-root";
      return {
        ...candidate,
        surface: {
          ...surfaceRef,
          kind,
          ...(surfaceState.hostSelectors.length > 0
            ? { hostSelectors: surfaceState.hostSelectors }
            : {})
        }
      };
    })
  );
}

export function interactionLocator(
  page: import("@playwright/test").Page,
  candidate: SafeInteractionCandidate,
  allowedUrls?: string[]
) {
  if (candidate.surface?.kind === "popup") {
    const popupUrl = canonicalUrl(page.url());
    if (popupUrl !== candidate.surface.url) {
      throw new Error(
        `Popup surface is unavailable after page recovery: ${candidate.surface.url}`
      );
    }
    if (allowedUrls && !isAllowedExplorationUrl(popupUrl, allowedUrls)) {
      throw new Error(`Popup surface is outside the business system allowlist: ${popupUrl}`);
    }
    return page.locator(candidate.selector);
  }
  if (candidate.surface?.kind === "iframe") {
    if (
      allowedUrls &&
      !isAllowedExplorationUrl(candidate.surface.url, allowedUrls)
    ) {
      throw new Error(`Iframe surface is outside the business system allowlist: ${candidate.surface.url}`);
    }
    const childFrames = stableChildFrameEntries(page).map((item) => item.frame);
    const indexedFrame =
      candidate.surface.frameIndex === undefined
        ? undefined
        : childFrames[candidate.surface.frameIndex];
    const frame =
      indexedFrame &&
      canonicalUrl(indexedFrame.url()) === candidate.surface.url
        ? indexedFrame
        : childFrames.find((item) => canonicalUrl(item.url()) === candidate.surface?.url);
    if (!frame) {
      throw new Error(
        `Iframe surface is unavailable after page recovery: ${candidate.surface.url}`
      );
    }
    if (allowedUrls && !isAllowedExplorationUrl(frame.url(), allowedUrls)) {
      throw new Error(`Iframe surface is outside the business system allowlist: ${frame.url()}`);
    }
    return frame.locator(candidate.selector);
  }
  if (
    candidate.surface &&
    (candidate.surface.kind === "shadow-root" || candidate.surface.kind === "wujie")
  ) {
    const hosts = candidate.surface.hostSelectors ?? [];
    if (hosts.length === 0) {
      throw new Error(
        `Shadow surface is unavailable without a stable host selector: ${candidate.surface.url}`
      );
    }
    let scoped = page.locator(hosts[0]);
    for (const host of hosts.slice(1)) scoped = scoped.locator(host);
    return scoped.locator(candidate.selector);
  }
  return page.locator(candidate.selector);
}

async function probeSafePopupInteractions(input: {
  popups: Array<import("@playwright/test").Page>;
  allowedUrls: string[];
  artifactDir: string;
  pageIndex: number;
  limit: number;
  deadline: number;
  warnings: string[];
  blockers: string[];
  scenario?: ExplorationScenario;
}): Promise<SystemInteractionEvidence[]> {
  const transitions: SystemInteractionEvidence[] = [];
  let remaining = input.limit;
  for (const [popupIndex, popup] of input.popups.entries()) {
    if (remaining <= 0 || Date.now() >= input.deadline) break;
    if (popup.isClosed()) {
      input.warnings.push(`Popup closed before safe interaction; popup evidence was retained.`);
      continue;
    }
    const popupUrl = safeCanonicalUrl(popup.url());
    if (!popupUrl || !isAllowedExplorationUrl(popupUrl, input.allowedUrls)) {
      input.warnings.push(`Ignored popup interaction outside allowlist: ${popup.url() || "unknown"}`);
      continue;
    }
    const surface: InteractionSurfaceRef = {
      kind: "popup",
      url: popupUrl
    };
    const candidates = (await collectInteractionCandidatesFromSurface(popup, surface))
      .map((candidate) => ({
        candidate,
        decision: classifySafeInteractionCandidate(candidate, input.scenario)
      }))
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
      .slice(0, remaining);
    for (const [candidateIndex, { candidate, decision }] of candidates.entries()) {
      if (Date.now() >= input.deadline) break;
      remaining -= 1;
      let before: SystemInteractionState;
      try {
        before = await captureInteractionState(popup, input.allowedUrls);
      } catch (error) {
        const reason = `Popup surface recovery failed while reading interaction state at ${popupUrl}: ${error instanceof Error ? error.message : String(error)}`;
        input.warnings.push(reason);
        input.blockers.push(reason);
        break;
      }
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
        if (
          unsafeMethod ||
          (guardedRequest && !isReadOnlyNavigationUrl(requestUrl)) ||
          (guardedRequest && !isAllowedExplorationUrl(requestUrl, input.allowedUrls))
        ) {
          blockedRequests.push({ method, url: requestUrl });
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      };
      await popup.route("**/*", routeHandler);
      let after = before;
      let status: SystemInteractionEvidence["status"] = "failed";
      let screenshotPath: string | undefined;
      try {
        const target = interactionLocator(popup, candidate, input.allowedUrls).first();
        if (!(await target.isVisible())) throw new Error("Safe popup interaction target is not visible");
        if (decision.action === "select") {
          await target.selectOption(decision.inputValue, {
            timeout: interactionTimeout(input.deadline)
          });
        } else {
          await target.click({ timeout: interactionTimeout(input.deadline) });
        }
        const settleMs = Math.min(300, Math.max(0, input.deadline - Date.now()));
        if (settleMs > 0) await popup.waitForTimeout(settleMs);
        if (popup.isClosed()) throw new Error("Popup closed after safe interaction");
        after = await captureInteractionState(popup, input.allowedUrls);
        status =
          blockedRequests.length > 0
            ? "blocked"
            : statesDiffer(before, after)
              ? "observed"
              : "no-change";
        if (status === "observed") {
          screenshotPath = join(
            input.artifactDir,
            `popup-interaction-${String(input.pageIndex + 1).padStart(2, "0")}-${String(
              popupIndex + 1
            ).padStart(2, "0")}-${String(candidateIndex + 1).padStart(2, "0")}.png`
          );
          await popup.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
            screenshotPath = undefined;
          });
        }
      } catch (error) {
        status = blockedRequests.length > 0 ? "blocked" : "failed";
        const reason = `Popup surface interaction failed for ${candidate.surface?.url}: ${error instanceof Error ? error.message : String(error)}`;
        input.warnings.push(reason);
        input.blockers.push(reason);
      } finally {
        await popup.unroute("**/*", routeHandler).catch(() => undefined);
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
        changedControls: changedControls(before.controlValues, after.controlValues),
        urlChanged: before.url !== after.url,
        ...(status === "observed"
          ? { transitionKind: before.url !== after.url ? "navigation" as const : "state" as const }
          : {}),
        blockedRequests,
        status,
        surface: candidate.surface,
        screenshotPath,
        ...(input.scenario ? { scenarioId: input.scenario.id } : {})
      });
      if (status === "failed") break;
    }
  }
  return transitions;
}

async function captureInteractionState(
  page: import("@playwright/test").Page,
  allowedUrls: string[]
): Promise<SystemInteractionState> {
  const visibleElements = await page
    .locator(
      'button, input, select, textarea, a[href], span, [role="tab"], [role="dialog"], [aria-label]'
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
  const frameVisibleElements = await Promise.all(
    page.frames()
      .filter(
        (frame) =>
          frame !== page.mainFrame() && isAllowedExplorationUrl(frame.url(), allowedUrls)
      )
      .map((frame) =>
        frame.locator('button, input, select, textarea, a[href], span, [role="tab"], [role="dialog"], [aria-label]')
          .evaluateAll((elements) => elements.flatMap((element) => {
            const html = element as unknown as {
              textContent?: string | null;
              getAttribute(name: string): string | null;
              getBoundingClientRect(): { width: number; height: number };
            };
            const bounds = html.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return [];
            const name = html.getAttribute("aria-label") ||
              html.getAttribute("placeholder") ||
              html.getAttribute("name") ||
              (html.textContent ?? "").trim();
            return name ? [name] : [];
          }))
          .catch(() => [])
      )
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
  const frameDialogs = await Promise.all(
    page.frames()
      .filter(
        (frame) =>
          frame !== page.mainFrame() && isAllowedExplorationUrl(frame.url(), allowedUrls)
      )
      .map((frame) => frame.locator('[role="dialog"]').allTextContents().catch(() => []))
  );
  const surfaceUrls = stableChildFrameEntries(page).flatMap(({ frame, frameIndex }) =>
    isAllowedExplorationUrl(frame.url(), allowedUrls)
      ? [{ kind: "iframe" as const, url: canonicalUrl(frame.url()), frameIndex }]
      : []
  );
  const state = {
    url: canonicalUrl(page.url()),
    visibleElements: uniqueSorted([...visibleElements, ...frameVisibleElements.flat()]),
    dialogs: uniqueSorted([
      ...dialogs,
      ...frameDialogs.flat().map((value) => value.trim()).filter(Boolean)
    ]),
    surfaceUrls,
    controlValues: await captureControlValues(page, allowedUrls)
  };
  return {
    id: `state-${createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16)}`,
    ...state
  };
}

async function captureControlValues(
  page: import("@playwright/test").Page,
  allowedUrls: string[]
) {
  type Surface = import("@playwright/test").Page | import("@playwright/test").Frame;
  const collect = async (surface: Surface, prefix = "") =>
    surface
      .locator(
        'select, input[type="checkbox"], input[type="radio"], [aria-selected="true"], [aria-expanded]'
      )
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const html = element as unknown as {
            tagName: string;
            id: string;
            value?: string;
            checked?: boolean;
            labels?: ArrayLike<{ textContent?: string | null }>;
            textContent?: string | null;
            getAttribute(name: string): string | null;
          };
          const label = html.labels
            ? Array.from(html.labels)
                .map((item) =>
                  (item.textContent ?? "")
                    .replace(html.textContent ?? "", "")
                    .trim()
                )
                .filter(Boolean)
                .join(" ")
            : "";
          const name =
            html.getAttribute("aria-label") ||
            label ||
            html.getAttribute("name") ||
            html.id ||
            (html.textContent ?? "").trim();
          if (!name) return [];
          const type = html.getAttribute("type")?.toLowerCase();
          const value =
            type === "checkbox" || type === "radio"
              ? html.checked
                ? "checked"
                : "unchecked"
              : html.getAttribute("aria-selected") === "true"
                ? "selected"
                : html.getAttribute("aria-expanded") ?? html.value ?? "";
          return [{ name, value }];
        })
      )
      .then((values) =>
        values.map((item) => ({
          name: prefix ? `${item.name} @${prefix}` : item.name,
          value: item.value
        }))
      )
      .catch(() => [] as Array<{ name: string; value: string }>);
  const childFrames = page.frames().filter(
    (frame) => frame !== page.mainFrame() && Boolean(frame.url())
  );
  const frameValues = await Promise.all(
    childFrames.map((frame, index) =>
      isAllowedExplorationUrl(frame.url(), allowedUrls)
        ? collect(frame, `iframe:${canonicalUrl(frame.url())}#${index}`)
        : []
    )
  );
  return [...(await collect(page)), ...frameValues.flat()].sort((left, right) =>
    `${left.name}\u0000${left.value}`.localeCompare(`${right.name}\u0000${right.value}`)
  );
}

async function capturePage(
  page: import("@playwright/test").Page,
  finalUrl: string,
  index: number,
  artifactDir: string,
  allowedUrls: string[]
): Promise<PageCaptureEvidence> {
  const screenshotPath = join(artifactDir, `page-${String(index + 1).padStart(2, "0")}.png`);
  const issues: string[] = [];
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    issues.push(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const domText = await page.locator("body").innerText().catch(() => "");
  const interactiveElements: PageCaptureEvidence["interactiveElements"] = await page
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
  const interactiveElementsWithSurface = await Promise.all(
    interactiveElements.map(async (element) => {
      const inShadowRoot = await page
        .locator(element.selector)
        .first()
        .evaluate((item) => {
          const root = item.getRootNode() as {
            toString(): string;
            host?: {
              id: string;
              tagName: string;
              getAttribute(name: string): string | null;
              matches(selector: string): boolean;
              getRootNode(): unknown;
            };
          };
          const host = root.host;
          const hostSelectors: string[] = [];
          let currentRoot = root;
          while (currentRoot.host) {
            const currentHost = currentRoot.host;
            const testId = currentHost.getAttribute("data-testid");
            const name = currentHost.getAttribute("name");
            const selector = testId
              ? `[data-testid=${JSON.stringify(testId)}]`
              : currentHost.id
                ? `[id=${JSON.stringify(currentHost.id)}]`
                : name
                  ? `${currentHost.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`
                  : undefined;
            if (!selector) break;
            hostSelectors.unshift(selector);
            currentRoot = currentHost.getRootNode() as typeof currentRoot;
          }
          return {
            inShadowRoot: root.toString() === "[object ShadowRoot]",
            inWujie: Boolean(host?.matches("[data-wujie], wujie-app, [class*='wujie']")),
            hostSelectors
          };
        })
        .catch(() => ({ inShadowRoot: false, inWujie: false, hostSelectors: [] }));
      if (!inShadowRoot.inShadowRoot) return element;
      const kind: InteractionSurfaceRef["kind"] = inShadowRoot.inWujie
        ? "wujie"
        : "shadow-root";
      return {
        ...element,
        surface: {
          kind,
          url: finalUrl,
          parentUrl: finalUrl,
          ...(inShadowRoot.hostSelectors.length > 0
            ? { hostSelectors: inShadowRoot.hostSelectors }
            : {})
        }
      };
    })
  );
  const frameInteractiveElements = await Promise.all(
    stableChildFrameEntries(page).map(async ({ frame, frameIndex }) => {
      if (!isAllowedExplorationUrl(frame.url(), allowedUrls)) return [];
      const surface = {
        kind: "iframe" as const,
        url: canonicalUrl(frame.url()),
        parentUrl: finalUrl,
        frameIndex
      };
      const elements = await frame.locator(
          'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]'
        ).evaluateAll((items) => items.slice(0, 100).map((element, position) => {
          const html = element as unknown as {
            tagName: string;
            innerText?: string;
            textContent?: string | null;
            id: string;
            labels?: ArrayLike<{ textContent?: string | null }>;
            getAttribute(name: string): string | null;
          };
          const tag = html.tagName.toLowerCase();
          const text = (html.innerText || html.textContent || "").trim();
          const associatedLabel = html.labels
            ? Array.from(html.labels)
                .map((label) =>
                  (label.textContent ?? "")
                    .replace(html.textContent ?? "", "")
                    .trim()
                )
                .filter(Boolean)
                .join(" ")
            : "";
          const name = html.getAttribute("aria-label") ||
            html.getAttribute("placeholder") ||
            associatedLabel ||
            html.getAttribute("name") ||
            text || `${tag}-${position + 1}`;
          const testId = html.getAttribute("data-testid");
          const selector = testId
            ? `[data-testid=${JSON.stringify(testId)}]`
            : html.id
              ? `[id=${JSON.stringify(html.id)}]`
              : html.getAttribute("name")
                ? `${tag}[name=${JSON.stringify(html.getAttribute("name"))}]`
                : `${tag}:nth-of-type(${position + 1})`;
          const role = html.getAttribute("role") || (tag === "select" ? "combobox" : tag === "button" ? "button" : "textbox");
          return { name, role, text, selector };
        }));
        return elements.map((element) => ({ ...element, surface }));
      })
  );
  const allInteractiveElements = [
    ...interactiveElementsWithSurface,
    ...frameInteractiveElements.flat()
  ];
  if (allInteractiveElements.length === 0) {
    issues.push("No interactive elements found");
  }
  const surfaces = await collectBrowserSurfaceEvidence(page, allowedUrls);
  if (
    allInteractiveElements.some((element) => element.surface?.kind === "shadow-root") &&
    !surfaces.some((surface) => surface.kind === "shadow-root")
  ) {
    surfaces.push({
      kind: "shadow-root",
      url: finalUrl,
      parentUrl: finalUrl,
      accessible: true,
      interactiveCount: allInteractiveElements.filter(
        (element) => element.surface?.kind === "shadow-root"
      ).length,
      evidence: "Open shadow root interactive element detected"
    });
  }
  return {
    title: (await page.title()) || finalUrl,
    finalUrl,
    domText: domText.slice(0, 50_000),
    screenshotPath,
    interactiveElements: allInteractiveElements,
    consoleErrors: [],
    networkFailures: [],
    issues,
    surfaces
  };
}

async function reacquirePage(
  context: import("@playwright/test").BrowserContext,
  pageUrl: string,
  deadline: number
) {
  if (Date.now() >= deadline) return undefined;
  const page = await context.newPage();
  try {
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: interactionTimeout(deadline)
    });
    return page;
  } catch {
    await page.close().catch(() => undefined);
    return undefined;
  }
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

function normalizeExplorationScenario(
  input?: Omit<ExplorationScenario, "id"> & { id?: string }
): ExplorationScenario | undefined {
  if (!input) return undefined;
  const name = input.name.trim();
  if (!name) throw new Error("Exploration scenario name is required");
  const selectorValues = Object.fromEntries(
    Object.entries(input.selectorValues ?? {})
      .filter(([key, value]) => key.trim() && typeof value === "string" && value.trim())
      .map(([key, value]) => [key.trim(), value.trim()])
  );
  const sensitiveSelector = Object.keys(selectorValues).find((key) =>
    /password|passwd|token|cookie|secret|api[_-]?key/i.test(key)
  );
  if (sensitiveSelector) {
    throw new Error(
      `Exploration scenario cannot carry secret selector values: ${sensitiveSelector}`
    );
  }
  return {
    id: input.id?.trim() || id("explorationScenario"),
    name,
    ...(input.role?.trim() ? { role: input.role.trim() } : {}),
    ...(input.prerequisiteState?.trim()
      ? { prerequisiteState: input.prerequisiteState.trim() }
      : {}),
    dataRefs: [...new Set((input.dataRefs ?? []).map((value) => value.trim()).filter(Boolean))],
    testDataLeaseIds: [
      ...new Set((input.testDataLeaseIds ?? []).map((value) => value.trim()).filter(Boolean))
    ],
    selectorValues
  };
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
      const targetCaptured = page.evidence.interactiveElements.some(
        (element) =>
          element.selector === interaction.target.selector &&
          element.name === interaction.target.name &&
          (!interaction.surface ||
            (interaction.surface.kind === "document"
              ? !element.surface || element.surface.kind === "document"
              : element.surface?.kind === interaction.surface.kind &&
                element.surface.url === interaction.surface.url &&
                (interaction.surface.kind !== "iframe" ||
                  element.surface.frameIndex === interaction.surface.frameIndex)))
      );
      const popupSurfaceCaptured =
        interaction.surface?.kind === "popup" &&
        page.evidence.surfaces?.some(
          (surface) =>
            surface.kind === "popup" &&
            surface.url === interaction.surface?.url &&
            surface.accessible &&
            surface.interactiveCount > 0
        );
      if (!targetCaptured && !popupSurfaceCaptured) {
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

function mergeNavigationEdges(edges: SystemExplorationNavigationEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.fromUrl}\u0000${edge.toUrl}\u0000${edge.text}`;
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
    left.dialogs.join("\u0000") !== right.dialogs.join("\u0000") ||
    JSON.stringify(left.surfaceUrls ?? []) !== JSON.stringify(right.surfaceUrls ?? []) ||
    JSON.stringify(left.controlValues ?? []) !== JSON.stringify(right.controlValues ?? [])
  );
}

function changedControls(
  before: SystemInteractionState["controlValues"],
  after: SystemInteractionState["controlValues"]
) {
  const beforeByName = new Map((before ?? []).map((item) => [item.name, item.value]));
  const afterByName = new Map((after ?? []).map((item) => [item.name, item.value]));
  return [...new Set([...beforeByName.keys(), ...afterByName.keys()])]
    .filter((name) => beforeByName.get(name) !== afterByName.get(name))
    .map((name) => ({
      name,
      before: beforeByName.get(name) ?? "",
      after: afterByName.get(name) ?? ""
    }));
}

function difference(left: string[], right: string[]) {
  const excluded = new Set(right);
  return left.filter((item) => !excluded.has(item));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function stableChildFrameEntries(page: import("@playwright/test").Page) {
  return stableBrowserChildFrameEntries(page);
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
