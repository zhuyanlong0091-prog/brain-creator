import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActionStep,
  ApiFlow,
  AuthProfile,
  Gap,
  GeneratedCase,
  LocatorPoint,
  PageModel,
  ProbeResult,
  TrainingSession
} from "./types";

export class InMemoryBrainCreatorRepository {
  authProfiles: AuthProfile[] = [];
  pageModels: PageModel[] = [];
  locatorPoints: LocatorPoint[] = [];
  probeResults: ProbeResult[] = [];
  trainingSessions: TrainingSession[] = [];
  actionSteps: ActionStep[] = [];
  apiFlows: ApiFlow[] = [];
  generatedCases: GeneratedCase[] = [];
  gaps: Gap[] = [];

  persist() {
    return;
  }

  reset() {
    this.authProfiles = [];
    this.pageModels = [];
    this.locatorPoints = [];
    this.probeResults = [];
    this.trainingSessions = [];
    this.actionSteps = [];
    this.apiFlows = [];
    this.generatedCases = [];
    this.gaps = [];
    this.persist();
  }
}

type RepositorySnapshot = Pick<
  InMemoryBrainCreatorRepository,
  | "authProfiles"
  | "pageModels"
  | "locatorPoints"
  | "probeResults"
  | "trainingSessions"
  | "actionSteps"
  | "apiFlows"
  | "generatedCases"
  | "gaps"
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
    this.authProfiles = snapshot.authProfiles ?? [];
    this.pageModels = snapshot.pageModels ?? [];
    this.locatorPoints = snapshot.locatorPoints ?? [];
    this.probeResults = snapshot.probeResults ?? [];
    this.trainingSessions = snapshot.trainingSessions ?? [];
    this.actionSteps = snapshot.actionSteps ?? [];
    this.apiFlows = snapshot.apiFlows ?? [];
    this.generatedCases = snapshot.generatedCases ?? [];
    this.gaps = snapshot.gaps ?? [];
  }

  private snapshot(): RepositorySnapshot {
    return {
      authProfiles: this.authProfiles,
      pageModels: this.pageModels,
      locatorPoints: this.locatorPoints,
      probeResults: this.probeResults,
      trainingSessions: this.trainingSessions,
      actionSteps: this.actionSteps,
      apiFlows: this.apiFlows,
      generatedCases: this.generatedCases,
      gaps: this.gaps
    };
  }
}
