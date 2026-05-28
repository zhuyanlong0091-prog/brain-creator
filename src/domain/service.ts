import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { InMemoryBrainCreatorRepository } from "./repository";
import type { PageCaptureAuth, PageCaptureResult } from "@/src/browser/pageCapture";
import type {
  ActionStep,
  ApiFlow,
  ApiRequest,
  AssetSearchResult,
  AuthProfile,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  LocatorPoint,
  PageModel,
  ProbeResult,
  TrainingSession
} from "./types";

type CreateAuthProfileInput = {
  projectId: string;
  env: string;
  role: string;
  loginMethod: AuthProfile["loginMethod"];
  secrets: Record<string, string>;
};

type DiscoverPageInput = {
  projectId: string;
  route: string;
  name: string;
  authProfileId: string;
  domText: string;
  captureMode?: "manual" | "browser";
  targetUrl?: string;
  browserCapture?: PageCaptureResult;
};

type CompleteTrainingInput = {
  sessionId: string;
  actions: Array<Omit<ActionStep, "id" | "sessionId" | "order">>;
  apiRequests: ApiRequest[];
  artifacts?: {
    traceUrl: string;
    harUrl: string;
    screenshotUrl: string;
  };
};

type GenerateCaseInput = {
  projectId: string;
  sourceRequirement: string;
  pageModelId: string;
};

type SearchInput = {
  projectId: string;
  query: string;
};

type CreateGlossaryTermInput = {
  projectId: string;
  key: string;
  zhCN: string;
  enUS: string;
  aliases: string[];
  pageScope: string;
};

const actionTerms = ["Create Order", "Submit", "Search", "Create", "Save", "Delete"];

export class BrainCreatorService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  createAuthProfile(input: CreateAuthProfileInput): AuthProfile {
    const now = timestamp();
    const profile: AuthProfile = {
      id: id("auth"),
      projectId: input.projectId,
      env: input.env,
      role: input.role,
      loginMethod: input.loginMethod,
      encryptedSecrets: encryptSecrets(input.secrets),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };

    this.repository.authProfiles.push(profile);
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  verifyAuthProfile(idValue: string): AuthProfile {
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }

    profile.status = "succeeded";
    profile.lastVerifiedAt = timestamp();
    profile.updatedAt = profile.lastVerifiedAt;
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  getCaptureAuth(idValue?: string): PageCaptureAuth | undefined {
    if (!idValue) {
      return undefined;
    }
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }
    return {
      loginMethod: profile.loginMethod,
      secrets: decryptSecrets(profile.encryptedSecrets)
    };
  }

  discoverPageModel(input: DiscoverPageInput): {
    pageModel: PageModel;
    locatorPoints: LocatorPoint[];
    probeResult: ProbeResult;
  } {
    const now = timestamp();
    const capture = input.captureMode === "browser" ? input.browserCapture : undefined;
    const pageModel: PageModel = {
      id: id("page"),
      projectId: input.projectId,
      route: capture?.finalUrl ?? input.targetUrl ?? input.route,
      name: capture?.title || input.name,
      version: 1,
      domSnapshotId: id("dom"),
      screenshotId: capture?.screenshotPath ?? id("shot"),
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    };

    const locatorPoints = capture
      ? locatorPointsFromCapture(pageModel.id, capture)
      : extractLocatorPoints(pageModel.id, input.domText);
    const issues = capture
      ? [
          ...capture.issues,
          ...capture.consoleErrors.map((error) => `Console error: ${error}`),
          ...capture.networkFailures.map((failure) => `Network failure: ${failure}`)
        ]
      : locatorPoints.length > 0
        ? []
        : ["No stable locator candidates found"];
    const probeResult: ProbeResult = {
      id: id("probe"),
      pageModelId: pageModel.id,
      type: capture ? "browser-capture" : "dom-scan",
      result: `${locatorPoints.length} locator points found`,
      issues,
      createdAt: now
    };

    this.repository.pageModels.push(pageModel);
    this.repository.locatorPoints.push(...locatorPoints);
    this.repository.probeResults.push(probeResult);

    if (locatorPoints.length === 0) {
      this.repository.gaps.push(
        this.createGap(input.projectId, "page-model", pageModel.id, "No locator evidence found")
      );
    }

    this.repository.persist();
    return { pageModel, locatorPoints, probeResult };
  }

  getPageModel(pageModelId: string) {
    const pageModel = this.repository.pageModels.find((item) => item.id === pageModelId);
    if (!pageModel) {
      throw new Error("Page model not found");
    }
    return {
      pageModel,
      locatorPoints: this.repository.locatorPoints.filter(
        (point) => point.pageModelId === pageModelId
      ),
      probeResults: this.repository.probeResults.filter(
        (probe) => probe.pageModelId === pageModelId
      )
    };
  }

  createTrainingSession(input: {
    projectId: string;
    pageModelId: string;
  }): TrainingSession {
    const now = timestamp();
    const session: TrainingSession = {
      id: id("session"),
      projectId: input.projectId,
      pageModelId: input.pageModelId,
      videoUrl: `/artifacts/${input.projectId}/video-placeholder.webm`,
      traceUrl: `/artifacts/${input.projectId}/trace-placeholder.zip`,
      status: "running",
      createdAt: now,
      updatedAt: now
    };
    this.repository.trainingSessions.push(session);
    this.repository.persist();
    return session;
  }

  completeTrainingSession(input: CompleteTrainingInput): {
    session: TrainingSession;
    actionSteps: ActionStep[];
    apiFlow: ApiFlow;
  } {
    const session = this.repository.trainingSessions.find(
      (item) => item.id === input.sessionId
    );
    if (!session) {
      throw new Error("Training session not found");
    }

    const actionSteps = input.actions.map<ActionStep>((action, index) => ({
      ...action,
      id: id("step"),
      sessionId: session.id,
      order: index + 1
    }));
    const apiFlow: ApiFlow = {
      id: id("flow"),
      sessionId: session.id,
      name: `API Flow for ${session.pageModelId}`,
      requests: input.apiRequests,
      dependencies: [],
      assertions: input.apiRequests.map((request) => `${request.method} ${request.url} ${request.status}`)
    };

    session.status = "succeeded";
    session.updatedAt = timestamp();
    if (input.artifacts) {
      session.traceUrl = input.artifacts.traceUrl;
      session.harUrl = input.artifacts.harUrl;
      session.screenshotUrl = input.artifacts.screenshotUrl;
    }
    this.repository.actionSteps.push(...actionSteps);
    this.repository.apiFlows.push(apiFlow);
    this.repository.persist();
    return { session, actionSteps, apiFlow };
  }

  generateCase(input: GenerateCaseInput): GeneratedCase {
    const locators = this.repository.locatorPoints.filter(
      (point) => point.pageModelId === input.pageModelId
    );
    const matched = locators.filter((point) =>
      input.sourceRequirement.toLowerCase().includes(point.text.toLowerCase())
    );

    if (locators.length === 0 || matched.length === 0) {
      const gap = this.createGap(
        input.projectId,
        "generated-case",
        input.pageModelId,
        `No locator evidence can satisfy requirement: ${input.sourceRequirement}`
      );
      this.repository.gaps.push(gap);
      const blocked: GeneratedCase = {
        id: id("case"),
        projectId: input.projectId,
        sourceRequirement: input.sourceRequirement,
        pageModelId: input.pageModelId,
        steps: [],
        status: "blocked",
        gaps: [gap],
        createdAt: timestamp()
      };
      this.repository.generatedCases.push(blocked);
      this.repository.persist();
      return blocked;
    }

    const ready: GeneratedCase = {
      id: id("case"),
      projectId: input.projectId,
      sourceRequirement: input.sourceRequirement,
      pageModelId: input.pageModelId,
      steps: matched.map((point, index) => ({
        order: index + 1,
        instruction: `Use ${point.name}`,
        locatorPointId: point.id
      })),
      status: "ready",
      gaps: [],
      createdAt: timestamp()
    };
    this.repository.generatedCases.push(ready);
    this.repository.persist();
    return ready;
  }

  createGlossaryTerm(input: CreateGlossaryTermInput): GlossaryTerm {
    const now = timestamp();
    const term: GlossaryTerm = {
      id: id("term"),
      projectId: input.projectId,
      key: input.key.trim(),
      zhCN: input.zhCN.trim(),
      enUS: input.enUS.trim(),
      aliases: input.aliases.map((alias) => alias.trim()).filter(Boolean),
      pageScope: input.pageScope.trim(),
      createdAt: now,
      updatedAt: now
    };

    this.repository.glossaryTerms.push(term);
    this.repository.persist();
    return term;
  }

  listGlossaryTerms(input: SearchInput): GlossaryTerm[] {
    const query = input.query.toLowerCase();
    const includes = (value: string) => value.toLowerCase().includes(query);
    return this.repository.glossaryTerms.filter(
      (item) =>
        item.projectId === input.projectId &&
        includes(`${item.key} ${item.zhCN} ${item.enUS} ${item.aliases.join(" ")} ${item.pageScope}`)
    );
  }

  searchAssets(input: SearchInput): AssetSearchResult[] {
    const query = input.query.toLowerCase();
    const includes = (value: string) => value.toLowerCase().includes(query);
    const inProject = (projectId: string) => projectId === input.projectId;

    const pageModels = this.repository.pageModels
      .filter((item) => inProject(item.projectId) && includes(`${item.name} ${item.route}`))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "page-model",
        label: item.name,
        projectId: item.projectId,
        status: item.status
      }));

    const locators = this.repository.locatorPoints
      .filter((item) => {
        const page = this.repository.pageModels.find((model) => model.id === item.pageModelId);
        return page ? inProject(page.projectId) && includes(`${item.name} ${item.text}`) : false;
      })
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "locator-point",
        label: item.name,
        projectId: input.projectId
      }));

    const sessions = this.repository.trainingSessions
      .filter((item) => inProject(item.projectId))
      .filter((item) => {
        const page = this.repository.pageModels.find((model) => model.id === item.pageModelId);
        return page ? includes(page.name) || includes(page.route) : true;
      })
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "training-session",
        label: `Training ${item.id}`,
        projectId: item.projectId,
        status: item.status
      }));

    const apiFlows = this.repository.apiFlows
      .filter((item) => includes(`${item.name} ${item.requests.map((request) => request.url).join(" ")}`))
      .map<AssetSearchResult>((item) => {
        const session = this.repository.trainingSessions.find(
          (training) => training.id === item.sessionId
        );
        return {
          id: item.id,
          type: "api-flow",
          label: item.name,
          projectId: session?.projectId ?? input.projectId
        };
      })
      .filter((item) => inProject(item.projectId));

    const cases = this.repository.generatedCases
      .filter((item) => inProject(item.projectId) && includes(item.sourceRequirement))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "generated-case",
        label: item.sourceRequirement,
        projectId: item.projectId,
        status: item.status
      }));

    const gaps = this.repository.gaps
      .filter((item) => inProject(item.projectId) && includes(item.reason))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "gap",
        label: item.reason,
        projectId: item.projectId,
        status: item.status
      }));

    const glossaryTerms = this.repository.glossaryTerms
      .filter(
        (item) =>
          inProject(item.projectId) &&
          includes(`${item.key} ${item.zhCN} ${item.enUS} ${item.aliases.join(" ")} ${item.pageScope}`)
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "glossary-term",
        label: item.key,
        projectId: item.projectId
      }));

    return [
      ...pageModels,
      ...locators,
      ...sessions,
      ...apiFlows,
      ...cases,
      ...gaps,
      ...glossaryTerms
    ];
  }

  resolveGap(gapId: string): Gap {
    const gap = this.repository.gaps.find((item) => item.id === gapId);
    if (!gap) {
      throw new Error("Gap not found");
    }

    gap.status = "resolved";
    gap.updatedAt = timestamp();
    this.repository.persist();
    return gap;
  }

  private createGap(projectId: string, sourceType: string, sourceId: string, reason: string): Gap {
    const now = timestamp();
    return {
      id: id("gap"),
      projectId,
      sourceType,
      sourceId,
      reason,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
  }
}

function publicAuthProfile(profile: AuthProfile): AuthProfile {
  return {
    ...profile,
    encryptedSecrets: redactSecrets(profile.encryptedSecrets)
  };
}

function redactSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(Object.keys(secrets).map((key) => [key, "[REDACTED]"]));
}

function encryptSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, encryptSecretValue(value)])
  );
}

function decryptSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(secrets)
      .filter(([, value]) => value.startsWith("enc:"))
      .map(([key, value]) => [key, decryptSecretValue(value)])
  );
}

function encryptSecretValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", localSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecretValue(value: string) {
  const [, version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1") {
    return Buffer.from(value.slice("enc:".length), "base64").toString("utf8");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    localSecretKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function localSecretKey() {
  return createHash("sha256")
    .update(process.env.BRAIN_CREATOR_SECRET_KEY ?? process.cwd())
    .digest();
}

function extractLocatorPoints(pageModelId: string, domText: string): LocatorPoint[] {
  return actionTerms
    .sort((left, right) => right.length - left.length)
    .filter((term) => domText.toLowerCase().includes(term.toLowerCase()))
    .filter((term, index, terms) => {
      const lower = term.toLowerCase();
      return !terms.slice(0, index).some((previous) => previous.toLowerCase().includes(lower));
    })
    .map((term) => ({
      id: id("locator"),
      pageModelId,
      name: term,
      selector: `[data-brain-label="${slug(term)}"]`,
      role: term === "Search" ? "searchbox" : "button",
      text: term,
      fallbackSelectors: [`text=${term}`, `role=${term === "Search" ? "searchbox" : "button"}`],
      confidence: 0.92
    }));
}

function locatorPointsFromCapture(
  pageModelId: string,
  capture: PageCaptureResult
): LocatorPoint[] {
  return capture.interactiveElements.map((element) => ({
    id: id("locator"),
    pageModelId,
    name: element.name,
    selector: element.selector,
    role: element.role,
    text: element.text || element.name,
    fallbackSelectors: [element.selector, `text=${element.text || element.name}`],
    confidence: 0.96
  }));
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function timestamp() {
  return new Date().toISOString();
}
