import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActionStep,
  AgentRun,
  ApiFlow,
  AuthCheckpoint,
  AuthProfile,
  BusinessRule,
  ChainRun,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  LocatorPoint,
  PageModel,
  ProbeResult,
  SystemProfile,
  TestCase,
  TrainingSession
} from "./types.js";

export class InMemoryBrainCreatorRepository {
  systemProfiles: SystemProfile[] = [];
  authProfiles: AuthProfile[] = [];
  authCheckpoints: AuthCheckpoint[] = [];
  pageModels: PageModel[] = [];
  locatorPoints: LocatorPoint[] = [];
  probeResults: ProbeResult[] = [];
  trainingSessions: TrainingSession[] = [];
  actionSteps: ActionStep[] = [];
  apiFlows: ApiFlow[] = [];
  generatedCases: GeneratedCase[] = [];
  gaps: Gap[] = [];
  glossaryTerms: GlossaryTerm[] = [];
  businessRules: BusinessRule[] = [];
  testCases: TestCase[] = [];
  agentRuns: AgentRun[] = [];
  chainRuns: ChainRun[] = [];

  persist() {
    return;
  }

  reset() {
    this.systemProfiles = [];
    this.authProfiles = [];
    this.authCheckpoints = [];
    this.pageModels = [];
    this.locatorPoints = [];
    this.probeResults = [];
    this.trainingSessions = [];
    this.actionSteps = [];
    this.apiFlows = [];
    this.generatedCases = [];
    this.gaps = [];
    this.glossaryTerms = [];
    this.businessRules = [];
    this.testCases = [];
    this.agentRuns = [];
    this.chainRuns = [];
    this.persist();
  }
}

type RepositorySnapshot = Pick<
  InMemoryBrainCreatorRepository,
  | "systemProfiles"
  | "authProfiles"
  | "authCheckpoints"
  | "pageModels"
  | "locatorPoints"
  | "probeResults"
  | "trainingSessions"
  | "actionSteps"
  | "apiFlows"
  | "generatedCases"
  | "gaps"
  | "glossaryTerms"
  | "businessRules"
  | "testCases"
  | "agentRuns"
  | "chainRuns"
>;

export class JsonFileBrainCreatorRepository extends InMemoryBrainCreatorRepository {
  constructor(private readonly filePath: string) {
    super();
    this.restore();
  }

  override persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.snapshot(), null, 2), "utf8");
  }

  private restore() {
    if (!existsSync(this.filePath)) {
      return;
    }
    const snapshot = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RepositorySnapshot>;
    this.systemProfiles = snapshot.systemProfiles ?? [];
    this.authProfiles = snapshot.authProfiles ?? [];
    this.authCheckpoints = snapshot.authCheckpoints ?? [];
    this.pageModels = snapshot.pageModels ?? [];
    this.locatorPoints = snapshot.locatorPoints ?? [];
    this.probeResults = snapshot.probeResults ?? [];
    this.trainingSessions = snapshot.trainingSessions ?? [];
    this.actionSteps = snapshot.actionSteps ?? [];
    this.apiFlows = snapshot.apiFlows ?? [];
    this.generatedCases = snapshot.generatedCases ?? [];
    this.gaps = snapshot.gaps ?? [];
    this.glossaryTerms = snapshot.glossaryTerms ?? [];
    this.businessRules = snapshot.businessRules ?? [];
    this.testCases = snapshot.testCases ?? [];
    this.agentRuns = snapshot.agentRuns ?? [];
    this.chainRuns = snapshot.chainRuns ?? [];
  }

  private snapshot(): RepositorySnapshot {
    return {
      systemProfiles: this.systemProfiles,
      authProfiles: this.authProfiles,
      authCheckpoints: this.authCheckpoints,
      pageModels: this.pageModels,
      locatorPoints: this.locatorPoints,
      probeResults: this.probeResults,
      trainingSessions: this.trainingSessions,
      actionSteps: this.actionSteps,
      apiFlows: this.apiFlows,
      generatedCases: this.generatedCases,
      gaps: this.gaps,
      glossaryTerms: this.glossaryTerms,
      businessRules: this.businessRules,
      testCases: this.testCases,
      agentRuns: this.agentRuns,
      chainRuns: this.chainRuns
    };
  }
}
