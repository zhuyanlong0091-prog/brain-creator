import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BrainCreatorService } from "../domain/service.js";
import type {
  AgentIntent,
  AgentLoopState,
  AgentSession,
  ContextReference,
  RunLedgerEntry
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { buildContextPack, type ContextPack } from "./context.js";
import { routeIntent, type RoutedIntent } from "./router.js";

export type BrainCreatorAgentBudget = {
  maxSteps: number;
  maxAgentCalls: number;
  maxHealAttempts: number;
  maxWallTimeMs: number;
  maxEstimatedContextChars: number;
};

export type RunBrainCreatorAgentInput = {
  request: string;
  repository: InMemoryBrainCreatorRepository;
  service: BrainCreatorService;
  workDir: string;
  sessionId?: string;
  budget?: Partial<BrainCreatorAgentBudget>;
};

export type BrainCreatorAgentResult = {
  intent: RoutedIntent;
  session: AgentSession;
  state: AgentLoopState;
  context?: ContextPack;
  ledger: RunLedgerEntry[];
  message: string;
  nextActions: string[];
};

const defaultBudget: BrainCreatorAgentBudget = {
  maxSteps: 12,
  maxAgentCalls: 5,
  maxHealAttempts: 2,
  maxWallTimeMs: 300000,
  maxEstimatedContextChars: 50000
};

export async function runBrainCreatorAgent(
  input: RunBrainCreatorAgentInput
): Promise<BrainCreatorAgentResult> {
  const startedAt = Date.now();
  const budget = { ...defaultBudget, ...input.budget };
  const intent = routeIntent(input.request);
  const session = resolveSession(input.repository, input.sessionId);
  const ledger: RunLedgerEntry[] = [];
  session.lastIntent = intent.intent;
  session.lastUserRequest = input.request;
  session.updatedAt = timestamp();

  if (Date.now() - startedAt > budget.maxWallTimeMs) {
    const entry = recordLedger(input.repository, {
      session,
      systemId: session.currentSystemId,
      intent: intent.intent,
      action: "budget_exhausted",
      fromState: session.state,
      toState: "blocked",
      inputSummary: input.request,
      contextReferences: [],
      outputSummary: "Agent loop wall-time budget exhausted",
      error: "maxWallTimeMs exceeded"
    });
    ledger.push(entry);
    session.state = "blocked";
    input.repository.persist();
    return result(intent, session, ledger, "Brain Creator stopped because the loop budget was exhausted.", [
      "Inspect ledger and retry with a narrower request"
    ]);
  }

  if (intent.intent === "connect_system") {
    const connectResult = connectSystem(input, session, intent);
    ledger.push(connectResult.ledger);
    input.repository.persist();
    return result(intent, session, ledger, connectResult.message, connectResult.nextActions);
  }

  if (intent.intent === "show_gaps" || intent.intent === "show_assets") {
    const context = session.currentSystemId
      ? buildContextPack({
          repository: input.repository,
          systemId: session.currentSystemId,
          intent: intent.intent,
          query: input.request,
          maxEstimatedChars: budget.maxEstimatedContextChars
        })
      : undefined;
    const references = context?.warm ?? [];
    const entry = recordLedger(input.repository, {
      session,
      systemId: session.currentSystemId,
      intent: intent.intent,
      action: intent.intent,
      fromState: session.state,
      toState: session.currentSystemId ? "completed" : "blocked",
      inputSummary: input.request,
      contextReferences: references,
      outputSummary: session.currentSystemId
        ? `Retrieved ${references.length} context reference(s)`
        : "No current system is selected"
    });
    session.state = entry.toState;
    ledger.push(entry);
    input.repository.persist();
    return {
      ...result(
        intent,
        session,
        ledger,
        entry.toState === "completed"
          ? `Found ${references.length} relevant Brain Creator asset reference(s).`
          : "No current system is selected.",
        entry.toState === "completed"
          ? ["Review returned context references"]
          : ["Use Brain Creator to connect a business system first"]
      ),
      context
    };
  }

  const blocked = recordLedger(input.repository, {
    session,
    systemId: session.currentSystemId,
    intent: intent.intent,
    action: "policy_gate",
    fromState: session.state,
    toState: "blocked",
    inputSummary: input.request,
    contextReferences: [],
    outputSummary: `Intent ${intent.intent} requires follow-up implementation or missing context`,
    error: intent.intent === "unknown" ? "Unknown Brain Creator intent" : undefined
  });
  session.state = "blocked";
  ledger.push(blocked);
  input.repository.persist();
  return result(intent, session, ledger, blocked.outputSummary, [
    "Connect or select a business system",
    "Use the existing bc_* tools for detailed plan/run operations until full loop execution is enabled"
  ]);
}

export function getAgentStatus(repository: InMemoryBrainCreatorRepository, sessionId?: string) {
  const session = resolveSession(repository, sessionId, false);
  if (!session) {
    return {
      session: undefined,
      openBlockers: []
    };
  }
  const openBlockers = session.currentSystemId
    ? repository.gaps.filter(
        (gap) => gap.projectId === session.currentSystemId && gap.status === "open"
      )
    : [];
  return { session, openBlockers };
}

export function listLedger(input: {
  repository: InMemoryBrainCreatorRepository;
  sessionId?: string;
  systemId?: string;
}) {
  return input.repository.runLedgerEntries.filter(
    (entry) =>
      (!input.sessionId || entry.sessionId === input.sessionId) &&
      (!input.systemId || entry.systemId === input.systemId)
  );
}

function connectSystem(
  input: RunBrainCreatorAgentInput,
  session: AgentSession,
  intent: RoutedIntent
) {
  if (!intent.targetUrl) {
    const ledger = recordLedger(input.repository, {
      session,
      intent: intent.intent,
      action: "connect_system",
      fromState: session.state,
      toState: "blocked",
      inputSummary: input.request,
      contextReferences: [],
      outputSummary: "No target URL found in the request",
      error: "targetUrl missing"
    });
    session.state = "blocked";
    return {
      ledger,
      message: "I need an http or https URL to connect a business system.",
      nextActions: ["Retry with a target URL"]
    };
  }
  const target = assertHttpUrl(intent.targetUrl);
  const existing = input.repository.systemProfiles.find(
    (system) => normalizeUrl(system.baseUrl) === normalizeUrl(target.href)
  );
  const system =
    existing ??
    input.service.createSystemProfile({
      name: systemNameFromUrl(target),
      environment: "agent",
      baseUrl: target.href,
      defaultLocale: "zh-CN",
      urlAllowlist: [target.origin, target.href]
    });
  const fromState = session.state;
  session.currentSystemId = system.id;
  session.state = "completed";
  session.updatedAt = timestamp();
  const ledger = recordLedger(input.repository, {
    session,
    systemId: system.id,
    intent: intent.intent,
    action: "connect_system",
    fromState,
    toState: "completed",
    inputSummary: input.request,
    contextReferences: [
      {
        assetType: "system",
        assetId: system.id,
        title: system.name,
        summary: system.baseUrl,
        relevance: 1,
        reason: existing ? "reused existing system with same base URL" : "created from request URL"
      }
    ],
    outputSummary: existing
      ? `Reused business system ${system.id}`
      : `Created business system ${system.id}`
  });
  return {
    ledger,
    message: `${existing ? "Reused" : "Created"} Brain Creator system ${system.name} (${system.id}).`,
    nextActions: [
      "Configure or verify auth if this system requires login",
      "Add business rules or glossary terms",
      "Ask Brain Creator to generate a reviewed test plan"
    ]
  };
}

function resolveSession(
  repository: InMemoryBrainCreatorRepository,
  sessionId?: string,
  create?: true
): AgentSession;
function resolveSession(
  repository: InMemoryBrainCreatorRepository,
  sessionId: string | undefined,
  create: false
): AgentSession | undefined;
function resolveSession(
  repository: InMemoryBrainCreatorRepository,
  sessionId?: string,
  create = true
): AgentSession | undefined {
  const existing = sessionId
    ? repository.agentSessions.find((session) => session.id === sessionId)
    : repository.agentSessions.at(-1);
  if (existing || !create) {
    return existing;
  }
  const now = timestamp();
  const session: AgentSession = {
    id: id("session"),
    state: "idle",
    createdAt: now,
    updatedAt: now
  };
  repository.agentSessions.push(session);
  return session;
}

function recordLedger(
  repository: InMemoryBrainCreatorRepository,
  input: {
    session: AgentSession;
    systemId?: string;
    intent: AgentIntent;
    action: string;
    fromState: AgentLoopState;
    toState: AgentLoopState;
    inputSummary: string;
    contextReferences: ContextReference[];
    outputSummary: string;
    error?: string;
  }
) {
  const entry: RunLedgerEntry = {
    id: id("ledger"),
    sessionId: input.session.id,
    systemId: input.systemId,
    intent: input.intent,
    action: input.action,
    fromState: input.fromState,
    toState: input.toState,
    inputSummary: input.inputSummary,
    contextReferences: input.contextReferences,
    outputSummary: input.outputSummary,
    error: input.error,
    createdAt: timestamp()
  };
  repository.runLedgerEntries.push(entry);
  input.session.updatedAt = entry.createdAt;
  return entry;
}

function result(
  intent: RoutedIntent,
  session: AgentSession,
  ledger: RunLedgerEntry[],
  message: string,
  nextActions: string[]
): BrainCreatorAgentResult {
  return {
    intent,
    session,
    state: session.state,
    ledger,
    message,
    nextActions
  };
}

function assertHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Brain Creator agent only accepts http or https URLs");
  }
  return url;
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  return url.href.replace(/\/$/, "");
}

function systemNameFromUrl(url: URL) {
  return `Brain Creator ${url.hostname}`;
}

function timestamp() {
  return new Date().toISOString();
}
