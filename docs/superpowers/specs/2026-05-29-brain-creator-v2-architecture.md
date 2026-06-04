# Brain Creator v2 Architecture Design

Date: 2026-05-29
Status: Design Complete — Pending Implementation
Supersedes: v1 MVP (Tasks 1–9 complete)

---

## 1. Positioning

Brain Creator v2 is the **business orchestration layer** on top of Playwright Test Agents. It focuses on what Playwright cannot do:

- Business semantic injection (glossary, rules, auth context)
- Test asset lifecycle management (specs, tests, gaps, coverage)
- Quality gates (business constraint validation)
- Multi-system governance (project isolation, environment switching)

Playwright Test Agents handle the hard parts:

- **Planner** — explore the app, produce a structured Markdown test plan
- **Generator** — convert the plan into executable `.spec.ts` files with live selector verification
- **Healer** — replay failing tests, patch selectors/waits, loop until passing or skip

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Brain Creator v2                              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ 业务系统  │  │ 术语表    │  │ Auth管理  │  │  业务规则引擎 │    │
│  │ Profile   │  │ Glossary │  │ Vault    │  │  RuleEngine  │    │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └──────┬───────┘    │
│        │             │             │               │             │
│  ┌─────┴─────────────┴─────────────┴───────────────┴─────────┐  │
│  │              PromptBuilder（语义注入层）                    │  │
│  │  将术语表、Auth、业务规则 → 序列化为 Agent 可消费的 Prompt  │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                             │                                    │
│  ┌─────────────────────────┴─────────────────────────────────┐  │
│  │              AgentOrchestrator（Agent 编排层）              │  │
│  │                                                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                │  │
│  │  │ Planner  │→ │Generator │→ │ Healer   │                │  │
│  │  │ 探索+计划 │  │ 写spec.ts│  │ 修复失败  │                │  │
│  │  └──────────┘  └──────────┘  └──────────┘                │  │
│  │                                                            │  │
│  │  每个 Agent 可单独调用，也可串成完整链路                     │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                             │                                    │
│  ┌─────────────────────────┴─────────────────────────────────┐  │
│  │              AssetManager（资产管理层）                     │  │
│  │                                                            │  │
│  │  Spec 版本管理 │ Test 执行记录 │ Gap 跟踪 │ 覆盖率报表     │  │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              QualityGate（质量门禁层）                     │   │
│  │                                                            │   │
│  │  审核 Agent 产出 → 是否符合业务约束 → 通过/阻断/人工复核  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Playwright Test Agents（外部）                 │
│                                                                  │
│  Planner: 探索应用 → specs/*.md                                  │
│  Generator: 读取计划 → tests/*.spec.ts                           │
│  Healer: 重放失败 → 修复或跳过                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Modules

### 3.1 Retained from v1 (with enhancements)

| Module | v1 Implementation | v2 Role | Enhancement |
|---|---|---|---|
| **SystemProfile** | Business system CRUD | Unchanged — top-level multi-project container | None |
| **AuthProfile** | Encrypted storage + redaction | Inject into seed.spec.ts to provide login state for Agents | Add `toSeedFixture()` |
| **GlossaryTerm** | CN/EN term management | Inject into Planner prompt for business term understanding | Add `toPromptFragment()` |
| **Gap** | State machine (open/resolved) | Healer-skip → Gap; business rule violation → Gap | New source types |
| **AssetSearch** | Unified search | Expand scope to include specs/ and tests/ | New asset types |
| **Repository** | InMemory + JsonFile | Unchanged interface, replaceable with PG later | None |
| **API Envelope** | `{success, data, errors, traceId}` | Unchanged | None |
| **UI Workbench** | Single-page workbench | Refactored into Agent orchestration + asset management views | Major rewrite |

### 3.2 New Modules

#### A. AgentOrchestrator — Agent Orchestration Layer

Calls Playwright Test Agents via CLI or MCP. Manages execution lifecycle.

```typescript
type AgentType = "planner" | "generator" | "healer";

type AgentRunInput = {
  agent: AgentType;
  systemId: string;
  requirement?: string;      // Planner: test intent
  prdPath?: string;           // Planner: optional PRD
  seedTestPath?: string;      // Planner: seed.spec.ts path
  specPath?: string;          // Generator: specs/xxx.md path
  testPath?: string;          // Healer: failing tests/xxx.spec.ts path
};

type AgentRunResult = {
  runId: string;
  agent: AgentType;
  status: "succeeded" | "failed" | "skipped";
  outputPaths: string[];
  duration: number;
  logs: string[];
  error?: string;
};

type ChainRunInput = {
  systemId: string;
  requirement: string;
  prdPath?: string;
  autoHeal?: boolean;          // Default true
  maxHealAttempts?: number;    // Default 3
};

type ChainRunResult = {
  chainId: string;
  status: "succeeded" | "partial" | "failed";
  planResult: AgentRunResult;
  generateResult: AgentRunResult;
  healResult?: AgentRunResult;
  specPath: string;
  testPath: string;
  gaps: Gap[];
};
```

**Chain execution flow:**

```
1. PromptBuilder.buildPlannerPrompt(systemId, requirement)
   → Inject glossary + business rules + auth context
   → Output: enriched prompt

2. Orchestrator.spawn("planner", { prompt, seedTest })
   → Invoke: npx playwright agent planner
   → Output: specs/xxx.md

3. QualityGate.reviewSpec(specPath, businessRules)
   → Check scenario coverage + business constraints
   → Pass → continue / Block → return Gap

4. Orchestrator.spawn("generator", { specPath })
   → Output: tests/xxx.spec.ts

5. Orchestrator.spawn("healer", { testPath })
   → Loop until pass or guardrail
   → Healer-skip → create Gap

6. AssetManager.recordRun(chainId, allResults)
```

#### B. PromptBuilder — Semantic Injection Layer

Serializes Brain Creator's business knowledge into Agent-consumable prompt fragments.

```typescript
type PlannerContext = {
  systemProfile: SystemProfile;
  glossaryTerms: GlossaryTerm[];
  authMethod: string;
  businessRules: BusinessRule[];
  locale: string;
};

class PromptBuilder {
  buildPlannerPrompt(requirement: string, context: PlannerContext): string;
  buildSeedFixture(authProfile: AuthProfile): string;
  buildReviewPrompt(specContent: string, rules: BusinessRule[]): string;
}
```

#### C. QualityGate — Business Constraint Validation

Reviews Agent output against business rules before proceeding.

```typescript
type BusinessRule = {
  id: string;
  systemId: string;
  name: string;                // "Payment flow must include risk check"
  condition: string;           // Human-readable rule description
  severity: "block" | "warn";
  createdAt: string;
};

type ReviewResult = {
  passed: boolean;
  violations: Array<{
    ruleId: string;
    ruleName: string;
    severity: "block" | "warn";
    detail: string;
  }>;
  recommendations: string[];
};

class QualityGate {
  async reviewSpec(specPath: string, rules: BusinessRule[]): Promise<ReviewResult>;
  async reviewHeal(originalTest: string, healedTest: string, rules: BusinessRule[]): Promise<ReviewResult>;
  addRule(rule: Omit<BusinessRule, "id" | "createdAt">): BusinessRule;
  listRules(systemId: string): BusinessRule[];
  removeRule(ruleId: string): void;
}
```

#### D. AssetManager v2 — Extended Asset Types

New asset types added to the existing search:

| Type | Source | Description |
|---|---|---|
| `business-rule` | QualityGate | Business constraint definitions |
| `test-spec` | Planner output | Markdown test plans in specs/ |
| `test-file` | Generator output | Executable .spec.ts in tests/ |
| `agent-run` | Orchestrator | Individual agent execution records |
| `chain-run` | Orchestrator | Full chain execution records |

---

## 4. New Domain Entities

```typescript
// Agent execution
type AgentRun = {
  id: string;
  systemId: string;
  agent: "planner" | "generator" | "healer";
  status: TaskStatus;
  inputSummary: string;
  outputPaths: string[];
  duration: number;
  logs: string[];
  error?: string;
  createdAt: string;
};

type ChainRun = {
  id: string;
  systemId: string;
  requirement: string;
  status: "running" | "succeeded" | "partial" | "failed";
  planRunId?: string;
  generateRunId?: string;
  healRunId?: string;
  specPath?: string;
  testPath?: string;
  gaps: Gap[];
  createdAt: string;
  completedAt?: string;
};

// Test assets
type TestSpec = {
  id: string;
  systemId: string;
  chainRunId?: string;
  title: string;
  filePath: string;
  content: string;
  scenarioCount: number;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewResult?: ReviewResult;
  createdAt: string;
  updatedAt: string;
};

type TestFile = {
  id: string;
  systemId: string;
  specId?: string;
  chainRunId?: string;
  title: string;
  filePath: string;
  status: "generated" | "passing" | "failing" | "skipped";
  lastRunAt?: string;
  lastRunDuration?: number;
  healAttempts: number;
  createdAt: string;
  updatedAt: string;
};

// Business rules
type BusinessRule = {
  id: string;
  systemId: string;
  name: string;
  condition: string;
  severity: "block" | "warn";
  createdAt: string;
};
```

### Existing Entity Changes (backward-compatible, optional fields only)

```typescript
// GeneratedCase: add optional v2 linkage fields
type GeneratedCase = {
  // ... all v1 fields unchanged ...
  specId?: string;        // v2: linked TestSpec
  testFileId?: string;    // v2: linked TestFile
  chainRunId?: string;    // v2: linked ChainRun
  status: "draft" | "ready" | "blocked" | "healing";  // v2: add "healing"
};

// Gap: sourceType gains new values
// v1: "page-model" | "training-session" | "generated-case"
// v2 adds: "quality-gate" | "healer-skip" | "agent-failure"
```

---

## 5. API Routes

### New Routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/agent-runs` | Trigger single agent or chain execution |
| GET | `/api/agent-runs/[id]` | Query execution status and result |
| GET | `/api/agent-runs?systemId=xxx` | List execution history |
| GET | `/api/specs?systemId=xxx` | List spec files |
| GET | `/api/specs/[id]` | Read spec content |
| GET | `/api/test-files?systemId=xxx` | List test files |
| GET | `/api/test-files/[id]` | Read test content and run status |
| POST | `/api/business-rules` | Create business rule |
| GET | `/api/business-rules?systemId=xxx` | List business rules |
| DELETE | `/api/business-rules/[id]` | Delete business rule |

### Request Body: Agent Execution

```json
// Single agent
{
  "mode": "single",
  "systemId": "system_xxx",
  "agent": "planner",
  "requirement": "User can submit order and see order number",
  "prdPath": "docs/order-prd.md"
}

// Full chain
{
  "mode": "chain",
  "systemId": "system_xxx",
  "requirement": "User can submit order and see order number",
  "autoHeal": true,
  "maxHealAttempts": 3
}
```

### Retained v1 Routes (unchanged)

- `/api/system-profiles` — business system CRUD
- `/api/auth-profiles` — auth management
- `/api/page-models/discover` — retained as Planner supplement
- `/api/training-sessions` — retained as Generator supplement
- `/api/glossary-terms` — glossary management
- `/api/assets/search` — expanded search scope
- `/api/gaps/[id]/resolve` — gap resolution

---

## 6. UI Redesign

### View Changes

| v1 View | v2 View | Change |
|---|---|---|
| 工作台 | **工作台** | Manual buttons → one-click chain + Agent status panel |
| 业务系统 | 业务系统 | Unchanged |
| 页面建模 | **测试计划** | Spec list from Planner + review status |
| 训练室 | **测试生成** | Test list from Generator + execution status |
| 用例生成 | **Agent 编排** | Input requirement → trigger Chain → real-time Agent progress |
| 资产管理 | 资产管理 | Extended: spec, test, agent-run types |
| 鉴权管理 | 鉴权管理 | Unchanged |
| i18n 词根 | **业务规则** | Glossary + business rules merged management |

### Workbench Layout

```
┌─────────────────────────────────────────────────────────┐
│ Brain Creator 工作台                                      │
│                                                           │
│ 当前系统：Orders Console                    [切换系统]     │
│                                                           │
│ ┌─ 快速操作 ────────────────────────────────────────────┐ │
│ │ [一键生成测试]  [查看计划]  [查看测试]  [处理缺口]     │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                           │
│ ┌─ Agent 执行面板 ──────────────────────────────────────┐ │
│ │  ✅ Planner    specs/order-flow.md        12s          │ │
│ │  ✅ Generator  tests/order-flow.spec.ts   8s           │ │
│ │  🔄 Healer     tests/order-flow.spec.ts   运行中...    │ │
│ │                                                        │ │
│ │  覆盖场景：3  通过：2  修复中：1  Gap：0               │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                           │
│ ┌─ 最近执行 ────────────────────────────────────────────┐ │
│ │ chain_abc123  "订单提交流程"  succeeded  45s ago       │ │
│ │ chain_def456  "用户登录流程"  partial    2h ago        │ │
│ └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Directory Structure

```
brain-creator-v2/
├── src/
│   ├── domain/                        # v1 retained + v2 entities
│   │   ├── types.ts
│   │   ├── service.ts
│   │   └── repository.ts
│   │
│   ├── agent/                         # v2 new
│   │   ├── orchestrator.ts
│   │   ├── promptBuilder.ts
│   │   ├── qualityGate.ts
│   │   ├── seedGenerator.ts
│   │   └── types.ts
│   │
│   ├── api/
│   │   ├── response.ts               # unchanged
│   │   └── singleton.ts              # extended
│   │
│   ├── browser/                       # retained as optional
│   │   ├── pageCapture.ts
│   │   └── trainingRecorder.ts
│   │
│   └── ui/
│       ├── AgentPanel.tsx             # v2 new
│       ├── SpecViewer.tsx             # v2 new
│       ├── RuleManager.tsx            # v2 new
│       ├── BrainCreatorWorkbench.tsx  # refactored
│       └── apiClient.ts              # unchanged
│
├── app/api/
│   ├── agent-runs/                    # v2 new
│   ├── business-rules/                # v2 new
│   ├── specs/                         # v2 new
│   ├── test-files/                    # v2 new
│   └── ... (v1 routes retained)
│
├── specs/                             # Planner output
├── tests/generated/                   # Generator output
├── .github/playwright-agents/         # Agent definitions
└── .brain-creator/                    # Local persistence
```

---

## 8. Compatibility Strategy

v2 does not modify v1 code:

1. **types.ts** — new types only; GeneratedCase/Gap get optional fields
2. **service.ts** — new methods only; existing methods unchanged
3. **repository.ts** — new collections only; existing collections unchanged
4. **API routes** — new route files only; existing routes unchanged
5. **UI** — new view components; existing views replaceable

### Migration Path

```
Phase 1: Parallel
  v1 manual flow retained
  v2 Agent flow as new entry point
  Unified asset storage

Phase 2: v2 Primary
  Workbench defaults to Agent orchestration
  v1 manual steps become "Advanced Mode"

Phase 3: v1 Retired
  Remove manual page modeling, training recording
  Retain Auth, Glossary, Asset management
```

---

## 9. Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent invocation | Child process (CLI) | Simplest; upgradeable to MCP later |
| Prompt injection | File write + CLI args | Playwright Agents accept seed test + prompt files |
| Spec storage | Filesystem (specs/) | Follows Playwright convention; metadata in Repository |
| Test storage | Filesystem (tests/) | Same |
| Execution tracking | JSON file + memory | Consistent with v1 Repository pattern |
| Quality gate | Rule engine first | Deterministic; AI review as future enhancement |

---

## 10. Task Breakdown

### Phase A: Foundation (Agent Orchestration + Prompt Injection)

| Task | Files | Effort |
|---|---|---|
| A1: Agent type definitions | `src/agent/types.ts` | Small |
| A2: PromptBuilder | `src/agent/promptBuilder.ts` | Medium |
| A3: AgentOrchestrator (single) | `src/agent/orchestrator.ts` | Medium |
| A4: AgentOrchestrator (chain) | Same file | Medium |
| A5: Agent API routes | `app/api/agent-runs/route.ts` | Small |
| A6: Seed test generator | `src/agent/seedGenerator.ts` | Medium |

### Phase B: Quality Gate + Business Rules

| Task | Files | Effort |
|---|---|---|
| B1: BusinessRule type + repository | `src/domain/types.ts`, `repository.ts` | Small |
| B2: QualityGate | `src/agent/qualityGate.ts` | Medium |
| B3: Business rules API | `app/api/business-rules/route.ts` | Small |
| B4: Spec review integration | QualityGate + Orchestrator | Medium |

### Phase C: Asset Management Extension

| Task | Files | Effort |
|---|---|---|
| C1: TestSpec/TestFile/AgentRun types | `src/domain/types.ts` | Small |
| C2: AssetManager extension | `src/domain/service.ts` | Medium |
| C3: Spec/Test API routes | `app/api/specs/`, `app/api/test-files/` | Small |
| C4: AssetSearch extension | `src/domain/service.ts` | Small |

### Phase D: UI Refactor

| Task | Files | Effort |
|---|---|---|
| D1: Agent panel component | `src/ui/AgentPanel.tsx` | Medium |
| D2: Workbench refactor | `src/ui/BrainCreatorWorkbench.tsx` | Large |
| D3: Spec viewer | `src/ui/SpecViewer.tsx` | Medium |
| D4: Rule manager | `src/ui/RuleManager.tsx` | Medium |

### Phase E: Integration Verification

| Task | Files | Effort |
|---|---|---|
| E1: Agent unit tests | `src/agent/*.test.ts` | Medium |
| E2: Agent API tests | `src/api/agent-routes.test.ts` | Medium |
| E3: Chain E2E test | `tests/e2e/agent-chain.spec.ts` | Large |
| E4: Documentation | `docs/` | Small |

---

## 11. Verification

1. **Unit tests** — `npm test` covers orchestrator, promptBuilder, qualityGate deterministic logic
2. **API tests** — Agent run route request/response contracts
3. **E2E test** — Start local app → trigger chain → verify specs/ and tests/ generated → verify gaps created
4. **Manual** — Run Planner against a real target website, inspect spec quality
