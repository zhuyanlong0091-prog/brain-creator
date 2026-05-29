import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActionStep,
  ApiFlow,
  AuthProfile,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  LocatorPoint,
  PageModel,
  ProbeResult,
  SystemProfile,
  TrainingSession
} from "./types";

export class InMemoryBrainCreatorRepository {
  systemProfiles: SystemProfile[] = [];
  authProfiles: AuthProfile[] = [];
  pageModels: PageModel[] = [];
  locatorPoints: LocatorPoint[] = [];
  probeResults: ProbeResult[] = [];
  trainingSessions: TrainingSession[] = [];
  actionSteps: ActionStep[] = [];
  apiFlows: ApiFlow[] = [];
  generatedCases: GeneratedCase[] = [];
  gaps: Gap[] = [];
  glossaryTerms: GlossaryTerm[] = [];

  persist() {
    return;
  }

  reset() {
    this.systemProfiles = [];
    this.authProfiles = [];
    this.pageModels = [];
    this.locatorPoints = [];
    this.probeResults = [];
    this.trainingSessions = [];
    this.actionSteps = [];
    this.apiFlows = [];
    this.generatedCases = [];
    this.gaps = [];
    this.glossaryTerms = [];
    this.persist();
  }
}

type RepositorySnapshot = Pick<
  InMemoryBrainCreatorRepository,
  | "systemProfiles"
  | "authProfiles"
  | "pageModels"
  | "locatorPoints"
  | "probeResults"
  | "trainingSessions"
  | "actionSteps"
  | "apiFlows"
  | "generatedCases"
  | "gaps"
  | "glossaryTerms"
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
    this.pageModels = snapshot.pageModels ?? [];
    this.locatorPoints = snapshot.locatorPoints ?? [];
    this.probeResults = snapshot.probeResults ?? [];
    this.trainingSessions = snapshot.trainingSessions ?? [];
    this.actionSteps = snapshot.actionSteps ?? [];
    this.apiFlows = snapshot.apiFlows ?? [];
    this.generatedCases = snapshot.generatedCases ?? [];
    this.gaps = snapshot.gaps ?? [];
    this.glossaryTerms = snapshot.glossaryTerms ?? [];
  }

  private snapshot(): RepositorySnapshot {
    return {
      systemProfiles: this.systemProfiles,
      authProfiles: this.authProfiles,
      pageModels: this.pageModels,
      locatorPoints: this.locatorPoints,
      probeResults: this.probeResults,
      trainingSessions: this.trainingSessions,
      actionSteps: this.actionSteps,
      apiFlows: this.apiFlows,
      generatedCases: this.generatedCases,
      gaps: this.gaps,
      glossaryTerms: this.glossaryTerms
    };
  }
}
