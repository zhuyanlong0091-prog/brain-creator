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
  }
}
