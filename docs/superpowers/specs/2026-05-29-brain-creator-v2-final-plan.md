# Brain Creator v2 实施方案（定稿）

Date: 2026-05-29
Status: Final Design — Ready for Implementation

---

## 一、完整图景：Brain Creator 是什么

### 1.1 一句话定义

Brain Creator 是一套**测试领域的业务逻辑库 + MCP 工具集**，让 AI Agent（Claude Code / Codex）能理解业务语言、管理测试资产、调用 Playwright Test Agents 生成和维护可执行的端到端测试。

### 1.2 它解决什么问题

Playwright Test Agents（Planner / Generator / Healer）能探索页面、生成测试、修复失败。但它们：

- 不知道"提交订单"在你的业务里是什么意思
- 不知道你的登录凭据怎么管理
- 不知道"支付流程必须验证金额"这条业务规则
- 不记录每次生成了什么、通过了什么、失败了什么
- 不沉淀术语、不跟踪覆盖率、不管理 Gap

**Brain Creator 补的就是这些。**

### 1.3 它不是什么

- 不是测试框架（Playwright 是）
- 不是 AI 模型（Claude / GPT 是）
- 不是前端应用（v1 是，v2 不再是）
- 不是自动化录制工具（Playwright Codegen 是）

---

## 二、从 v1 到 v2：什么保留、什么替换、什么新增

### 2.1 保留的核心（来自 v1）

这些是 v1 中真正有价值的、v2 原样继承的部分：

| 模块 | 文件 | 为什么保留 |
|---|---|---|
| **领域类型** | `src/domain/types.ts` | AuthProfile、GlossaryTerm、Gap、SystemProfile、AssetSearchResult 等实体定义经过验证 |
| **Auth 加密** | `src/domain/service.ts` 中的 `encryptSecrets` / `decryptSecrets` | AES-256-GCM 加密 + 脱敏返回，安全可靠 |
| **Repository 接口** | `src/domain/repository.ts` | InMemory → JsonFile 的分层抽象，可替换为 PG |
| **Gap 状态机** | `src/domain/types.ts` + `service.ts` | open/resolved 的状态流转逻辑通用 |
| **资产搜索** | `src/domain/service.ts` 中的 `searchAssets` | 多类型统一搜索的模式值得保留 |
| **API 信封** | `src/api/response.ts` | `{success, data, errors, traceId}` 格式通用 |
| **Singleton 管理** | `src/api/singleton.ts` | VITEST 环境切换逻辑 |

### 2.2 删除的部分（v1 中不再需要的）

| 模块 | 文件 | 为什么删除 |
|---|---|---|
| **Next.js UI** | `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | 对话界面由 Claude Code 提供，不需要自建 UI |
| **React 组件** | `src/ui/BrainCreatorWorkbench.tsx`, `src/ui/apiClient.ts` | 同上 |
| **Next.js API 路由** | `app/api/*/route.ts`（14 个文件） | 工具接口由 MCP Server 替代 |
| **定位器提取** | `service.ts` 中的 `extractLocatorPoints` | 硬编码关键词匹配，由 Playwright Planner 替代 |
| **训练录制** | `src/browser/trainingRecorder.ts` | 单步 click，由 Playwright Generator 替代 |
| **页面采集** | `src/browser/pageCapture.ts` | 由 Playwright Planner 的浏览器探索替代 |
| **React 测试** | `src/ui/*.test.tsx` | UI 删除后不再需要 |
| **API 路由测试** | `src/api/routes.test.ts` | 路由删除后不再需要 |
| **E2E 测试** | `tests/e2e/brain-creator.spec.ts` | 需要重写为 Skill 流程测试 |
| **Next.js 依赖** | `package.json` 中的 next, react, react-dom, @testing-library/* | 不再需要 |

### 2.3 新增的模块

| 模块 | 职责 | 对应讨论 |
|---|---|---|
| **MCP Server** | 暴露 Brain Creator 全部能力为标准化工具 | "方案 B：Skill + MCP" 讨论 |
| **PromptBuilder** | 术语表 + 业务规则 + Auth → Agent prompt | "术语表怎么序列化给 Agent" 讨论 |
| **SeedGenerator** | Auth 凭据 → Playwright seed fixture | "Auth 管理如何与 Agent 对接" 讨论 |
| **AgentOrchestrator** | 调用 Planner / Generator / Healer，支持单 Agent 和链路 | "Agent 编排 vs Playwright 原生" 讨论 |
| **QualityGate** | 用业务规则审核 Agent 产出 | "Agent 产出质量如何管理风控" 讨论 |
| **TermExtractor** | 从 Planner 产出中提取术语候选 | "术语表维护时机" 讨论 |
| **CaseFormatter** | spec → 结构化用例（中间格式） | "先出用例核对再生成代码" 讨论 |

---

## 三、核心设计决策（确保逻辑自洽）

### 决策 1：Brain Creator 是工具，不是应用

```
v1: 用户 → 浏览器 → Next.js UI → API → Service → 内存
v2: 用户 → Claude Code → MCP Tools → Service → Playwright Agent
```

**理由**：v1 的 UI 层（1300+ 行 React）本质上是在重新实现 Claude Code 已有的对话、状态管理、意图理解能力。删掉 UI，让 Claude Code 做对话层，Brain Creator 专注业务逻辑。

**影响**：删除所有 Next.js / React 代码和依赖。package.json 从 Next.js 应用变为 Node.js 工具库。

### 决策 2：两步式工作流（先用例后代码）

```
Step 1: 用户说需求 → Planner 探索 → 结构化用例 → 用户确认
Step 2: 用户确认 → Generator 生成 .spec.ts → Healer 修复 → 运行结果
```

**理由**：一步到位的风险是"测的不是用户想要的"。用例确认环节让非技术人员也能审核测试意图，且修改用例比修改代码成本低得多。

**影响**：MCP 工具分为"计划类"和"执行类"。`bc_generate_plan` 不生成代码，只返回结构化用例。`bc_run_chain` 在用户确认后才执行。

### 决策 3：术语表是活的，不是一次性配置

```
冷启动: 用户录入 2-3 个核心术语
第 1 次执行: Planner 发现 10 个新术语 → 用户确认 8 个
第 2 次执行: Planner 发现 3 个新术语 → 用户确认 3 个
第 N 次执行: 术语表趋于稳定
```

**理由**：要求用户提前录完所有术语不现实。让 Planner 的探索产出反哺术语表，维护成本随使用递减。

**影响**：`bc_generate_plan` 的返回值包含"新发现的术语候选"。MCP 工具需要 `bc_add_term` 和 `bc_batch_confirm_terms`。

### 决策 4：Auth 凭据不进对话历史

```
用户在 Claude Code 中说: "token 是 Bearer eyJhbG..."
  → Claude Code 调用 bc_create_auth → 凭据加密存储
  → 返回: "已配置 Token 鉴权（密钥已加密存储）"
  → 凭据原文不出现在后续对话中
```

**理由**：对话历史可能被记录、分享、泄露。凭据只在加密存储和 seed.spec.ts（本地文件）中出现。

**影响**：`bc_create_auth` 接收明文后立即加密，返回值只有 `[REDACTED]`。`bc_generate_seed` 从加密存储解密后写入本地 seed 文件，不通过 MCP 返回。

### 决策 5：元素重名由 Playwright 原生能力 + 术语表 pageScope 联合解决

```
不同页面的同名元素 → page.goto() 自动消歧
同页面的同名元素 → Planner 探索时识别 DOM 上下文 → Generator 用作用域选择器
术语表 pageScope → 告诉 Planner 哪个术语对应哪个页面区域
兜底 → Healer 修复 + Gap 提示
```

**理由**：不需要 Brain Creator 自己做元素消歧。Planner 在浏览器里能看到完整 DOM，它天然具备上下文感知能力。

**影响**：术语表的 pageScope 字段有实际用途（不只是元数据）。PromptBuilder 在序列化术语时必须包含 scope。

### 决策 6：质量风控分三层

```
第 1 层（输入约束）: 术语表减少 Agent 猜测 + Auth 准备登录态 + URL 白名单限制范围
第 2 层（输出审核）: QualityGate 检查 spec 是否覆盖业务规则
第 3 层（运行验证）: Playwright 实际执行 + Healer 修复 + 超限则 Gap
```

**理由**：没有任何单层能保证 100% 正确。三层叠加把风险降到可接受范围。

**影响**：QualityGate 先做关键词匹配（确定性、零成本），后续可升级为 LLM 审核。

---

## 四、模块设计（自洽的接口定义）

### 4.1 领域类型（保留 + 扩展）

```typescript
// ===== 保留的 v1 类型（不修改） =====

type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
type GapStatus = "open" | "resolved";

type SystemProfile = {
  id: string;
  name: string;
  environment: string;
  baseUrl: string;
  defaultLocale: string;
  urlAllowlist: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

type AuthProfile = {
  id: string;
  projectId: string;           // 关联 SystemProfile.id
  env: string;
  role: string;
  loginMethod: "password" | "cookie" | "token" | "script";
  encryptedSecrets: Record<string, string>;
  status: TaskStatus;
  lastVerifiedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

type GlossaryTerm = {
  id: string;
  projectId: string;           // 关联 SystemProfile.id
  key: string;                 // "order.submit"
  zhCN: string;                // "提交订单"
  enUS: string;                // "Submit order"
  aliases: string[];           // ["Create Order", "下单"]
  pageScope: string;           // "/orders" —— 元素消歧用
  createdAt: string;
  updatedAt: string;
};

type Gap = {
  id: string;
  projectId: string;
  sourceType: string;          // v1: "page-model" | "training-session" | "generated-case"
                               // v2 新增: "quality-gate" | "healer-skip" | "agent-failure"
  sourceId: string;
  reason: string;
  severity: "low" | "medium" | "high";
  owner: string;
  status: GapStatus;
  createdAt: string;
  updatedAt: string;
};

type AssetSearchResult = {
  id: string;
  type: AssetType;
  label: string;
  projectId: string;
  status?: string;
};

// ===== v2 新增类型 =====

type AssetType =
  | "system-profile"           // v1 保留
  | "auth-profile"             // v1 保留
  | "glossary-term"            // v1 保留
  | "gap"                      // v1 保留
  | "business-rule"            // v2 新增
  | "test-case"                // v2 新增：结构化用例
  | "test-spec"                // v2 新增：Planner 输出的 Markdown
  | "test-file"                // v2 新增：Generator 输出的 .spec.ts
  | "agent-run"                // v2 新增：Agent 执行记录
  | "chain-run";               // v2 新增：链路执行记录

type BusinessRule = {
  id: string;
  systemId: string;            // 关联 SystemProfile.id
  name: string;                // "支付流程必须有风控校验"
  condition: string;           // "支付页面必须验证订单金额"
  severity: "block" | "warn";  // block = 阻断, warn = 警告
  createdAt: string;
};

type TestCase = {
  id: string;
  systemId: string;
  requirement: string;         // 原始自然语言需求
  status: "draft" | "approved" | "generating" | "passed" | "failed";
  scenarios: TestCaseScenario[];
  newTerms: GlossaryTerm[];    // Planner 发现的新术语候选
  ruleCheckResult: RuleCheckResult;
  specId?: string;             // 确认后关联的 spec
  testFileId?: string;         // 生成后关联的 test
  chainRunId?: string;         // 执行后关联的 chain
  createdAt: string;
  updatedAt: string;
};

type TestCaseScenario = {
  id: string;
  title: string;               // "搜索机器人"
  priority: "critical" | "high" | "medium" | "low";
  steps: TestCaseStep[];
  businessRuleRef?: string;    // 关联的业务规则 ID
};

type TestCaseStep = {
  action: "navigate" | "fill" | "click" | "assert" | "wait" | "select";
  target: string;              // "搜索框" —— 自然语言描述
  value?: string;              // "机器人" —— fill 的值
  expected?: string;           // "包含至少一个商品" —— assert 的预期
};

type RuleCheckResult = {
  passed: boolean;
  checks: Array<{
    ruleId: string;
    ruleName: string;
    covered: boolean;
    detail: string;
  }>;
};

type AgentRun = {
  id: string;
  systemId: string;
  agent: "planner" | "generator" | "healer";
  status: TaskStatus;
  inputSummary: string;        // 输入摘要（不含敏感信息）
  outputPaths: string[];       // 产出文件路径
  duration: number;            // 毫秒
  logs: string[];
  error?: string;
  createdAt: string;
};

type ChainRun = {
  id: string;
  systemId: string;
  testCaseId: string;          // 关联的 TestCase
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
```

### 4.2 Repository 扩展

```typescript
// 在 v1 的 InMemoryBrainCreatorRepository 基础上新增集合
// 不修改已有集合

class InMemoryBrainCreatorRepository {
  // v1 保留（不动）
  systemProfiles: SystemProfile[] = [];
  authProfiles: AuthProfile[] = [];
  pageModels: PageModel[] = [];          // v2 降级为可选保留
  locatorPoints: LocatorPoint[] = [];    // v2 降级为可选保留
  probeResults: ProbeResult[] = [];      // v2 降级为可选保留
  trainingSessions: TrainingSession[] = []; // v2 降级为可选保留
  actionSteps: ActionStep[] = [];
  apiFlows: ApiFlow[] = [];
  generatedCases: GeneratedCase[] = [];
  gaps: Gap[] = [];
  glossaryTerms: GlossaryTerm[] = [];

  // v2 新增
  businessRules: BusinessRule[] = [];
  testCases: TestCase[] = [];
  agentRuns: AgentRun[] = [];
  chainRuns: ChainRun[] = [];
}
```

### 4.3 Service 层（保留 + 新增方法）

```typescript
class BrainCreatorService {
  // ===== v1 保留的方法（不修改） =====
  createSystemProfile(input): SystemProfile;
  listSystemProfiles(): SystemProfile[];
  getSystemOverview(systemId): object;
  createAuthProfile(input): AuthProfile;
  verifyAuthProfile(id): AuthProfile;
  getCaptureAuth(id?): PageCaptureAuth | undefined;
  createGlossaryTerm(input): GlossaryTerm;
  listGlossaryTerms(input): GlossaryTerm[];
  searchAssets(input): AssetSearchResult[];
  getAssetDetail(input): object;
  resolveGap(gapId): Gap;

  // ===== v2 新增方法 =====
  
  // 业务规则
  createBusinessRule(input: {
    systemId: string;
    name: string;
    condition: string;
    severity: "block" | "warn";
  }): BusinessRule;
  listBusinessRules(systemId: string): BusinessRule[];
  deleteBusinessRule(ruleId: string): void;
  
  // 测试用例（结构化中间产物）
  createTestCase(input: {
    systemId: string;
    requirement: string;
    scenarios: TestCaseScenario[];
    newTerms: GlossaryTerm[];
    ruleCheckResult: RuleCheckResult;
  }): TestCase;
  getTestCase(caseId: string): TestCase;
  listTestCases(systemId: string): TestCase[];
  approveTestCase(caseId: string): TestCase;  // draft → approved
  updateTestCaseScenarios(caseId: string, scenarios: TestCaseScenario[]): TestCase;
  
  // Agent 执行记录
  recordAgentRun(run: AgentRun): void;
  getAgentRun(runId: string): AgentRun;
  listAgentRuns(systemId: string): AgentRun[];
  
  // Chain 执行记录
  recordChainRun(run: ChainRun): void;
  getChainRun(chainId: string): ChainRun;
  listChainRuns(systemId: string): ChainRun[];
}
```

---

## 五、MCP 工具定义

### 5.1 工具清单

```
bc_create_system      创建业务系统
bc_list_systems       列出业务系统
bc_switch_system      切换当前系统
bc_system_overview    系统概览（资产统计 + 完成度）

bc_create_auth        创建鉴权配置（加密存储）
bc_verify_auth        验证鉴权
bc_list_auth          列出鉴权
bc_generate_seed      生成 seed.spec.ts

bc_add_term           添加术语
bc_list_terms         列出术语
bc_update_term        修改术语
bc_delete_term        删除术语
bc_batch_confirm_terms 批量确认 Planner 发现的新术语

bc_add_rule           添加业务规则
bc_list_rules         列出业务规则
bc_delete_rule        删除业务规则

bc_generate_plan      生成测试计划（Planner + 用例格式化 + 规则审核 + 术语提取）
bc_update_plan        修改用例中的场景
bc_approve_plan       确认用例 → 触发代码生成
bc_run_chain          执行已确认的用例（Generator + Healer）

bc_run_agent          单独调用某个 Agent（Planner / Generator / Healer）

bc_list_cases         列出测试用例
bc_list_specs         列出 spec 文件
bc_list_tests         列出 test 文件
bc_list_gaps          列出 Gap
bc_resolve_gap        解决 Gap
bc_search_assets      统一搜索
```

### 5.2 工具分组与调用场景

```
用户: "接入订单系统 https://order.test.com"
  Claude Code 调用: bc_create_system

用户: "配置 Token 登录，token 是 Bearer xxx"
  Claude Code 调用: bc_create_auth → bc_generate_seed

用户: "添加术语：机器人 = Robot，作用域 /products"
  Claude Code 调用: bc_add_term

用户: "添加规则：支付必须验证金额"
  Claude Code 调用: bc_add_rule

用户: "测试购买机器人的完整流程"
  Claude Code 调用: bc_generate_plan
  → 返回: 结构化用例 + 新术语候选 + 规则校验
  → Claude 用自然语言展示给用户

用户: "确认，生成代码"
  Claude Code 调用: bc_approve_plan → bc_run_chain
  → 返回: 运行结果 + Gap
  → Claude 用自然语言展示给用户

用户: "查看测试历史"
  Claude Code 调用: bc_list_cases / bc_list_chain_runs
```

---

## 六、核心流程：完整数据流

### 6.1 用例生成流程（bc_generate_plan）

```
输入: { systemId, requirement: "我要测试购买机器人" }

Step 1: 从 Repository 获取上下文
  → glossaryTerms = repository.glossaryTerms.filter(t => t.projectId === systemId)
  → authProfile = repository.authProfiles.find(a => a.projectId === systemId && a.status === "succeeded")
  → businessRules = repository.businessRules.filter(r => r.systemId === systemId)

Step 2: PromptBuilder 构建 prompt 文件
  → 写入 specs/_context/{systemId}-prompt.md
  → 内容: 需求 + 术语表 + Auth说明 + 业务规则 + 系统URL

Step 3: SeedGenerator 生成 seed 文件
  → 写入 tests/seed-{systemId}.spec.ts
  → 内容: Playwright fixture，注入 token/cookie

Step 4: 调用 Playwright Planner Agent
  → spawn('npx', ['playwright', 'agent', 'planner', '--prompt', promptPath, '--seed', seedPath])
  → 输出: specs/{slug}.md

Step 5: 解析 spec 为结构化用例
  → CaseFormatter.parse(specContent) → TestCaseScenario[]

Step 6: QualityGate 审核
  → 检查每个 businessRule 的关键词是否出现在 spec 中
  → 输出: RuleCheckResult

Step 7: TermExtractor 提取新术语
  → 从 spec 中提取中文文本 → 过滤已有的 → 输出候选

Step 8: 创建 TestCase（status: "draft"）
  → 记录到 repository
  → 记录 AgentRun

输出: TestCase（含 scenarios、newTerms、ruleCheckResult）
```

### 6.2 用例执行流程（bc_run_chain）

```
输入: { caseId }（必须是 approved 状态）

Step 1: 读取已确认的 TestCase
  → 获取 scenarios、systemId

Step 2: CaseFormatter 序列化为 Markdown spec
  → 从 TestCaseScenario[] → specs/{slug}.md（覆盖之前的 spec）

Step 3: PromptBuilder + SeedGenerator（同上）

Step 4: 调用 Playwright Generator Agent
  → spawn('npx', ['playwright', 'agent', 'generator', '--spec', specPath, '--seed', seedPath])
  → 输出: tests/generated/{slug}.spec.ts
  → 记录 AgentRun

Step 5: 调用 Playwright Healer Agent
  → spawn('npx', ['playwright', 'test', testPath])
  → 如果失败: 调用 Healer 修复 → 循环 max 3 次
  → 仍然失败: 创建 Gap（sourceType: "healer-skip"）
  → 记录 AgentRun

Step 6: 记录 ChainRun + 更新 TestCase 状态

输出: ChainRun（含 specPath、testPath、gaps、各阶段 AgentRun）
```

### 6.3 术语沉淀流程（bc_batch_confirm_terms）

```
输入: { termIds: ["term_001", "term_003"], ignoreIds: ["term_002"] }

Step 1: 从 TestCase.newTerms 中取出对应的候选术语
Step 2: 确认的术语写入 repository.glossaryTerms
Step 3: 忽略的术语从 TestCase.newTerms 中移除

输出: 更新后的术语表
```

---

## 七、技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js（去掉 Next.js 框架） | MCP Server 是 Node.js 进程 |
| MCP 实现 | `@modelcontextprotocol/sdk` | 官方 SDK |
| Playwright Agent 调用 | 子进程 `spawn` | 最简单，不引入额外依赖 |
| 测试框架 | Vitest（保留 v1） | 已配置，domain 逻辑测试用 |
| 数据持久化 | JSON 文件（保留 v1 模式） | 本地开发阶段，后续可换 PG |
| Agent 定义 | `npx playwright init-agents --loop=claude` | Playwright 官方命令 |
| 包管理 | npm（保留 v1） | 已有 package-lock.json |

### 7.1 package.json 变化

```json
{
  "name": "brain-creator",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "mcp": "node --loader ts-node/esm src/mcp/server.ts",
    "test": "vitest run",
    "init-agents": "npx playwright init-agents --loop=claude"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@playwright/test": "^1.57.0",
    "@types/node": "^24.10.1",
    "ts-node": "^10.9.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.13"
  }
}
```

删除: next, react, react-dom, @testing-library/*, @vitejs/plugin-react, jsdom, @next/env

---

## 八、目录结构

```
brain-creator/
├── src/
│   ├── domain/                        # 保留 v1 核心
│   │   ├── types.ts                   # 保留 + 新增 BusinessRule, TestCase, AgentRun, ChainRun
│   │   ├── service.ts                 # 保留 + 新增方法
│   │   ├── repository.ts              # 保留 + 新增集合
│   │   └── __tests__/
│   │       ├── service.test.ts        # 保留 + 扩展
│   │       └── repository.test.ts     # 保留 + 扩展
│   │
│   ├── agent/                         # v2 新增
│   │   ├── orchestrator.ts            # Playwright Agent 调用 + 链路编排
│   │   ├── promptBuilder.ts           # 术语表 + 规则 + Auth → prompt 文件
│   │   ├── seedGenerator.ts           # Auth → seed.spec.ts
│   │   ├── qualityGate.ts             # 业务规则审核 spec
│   │   ├── caseFormatter.ts           # spec ↔ TestCase 双向转换
│   │   ├── termExtractor.ts           # 从 spec 提取术语候选
│   │   └── __tests__/
│   │       ├── orchestrator.test.ts
│   │       ├── promptBuilder.test.ts
│   │       ├── seedGenerator.test.ts
│   │       ├── qualityGate.test.ts
│   │       ├── caseFormatter.test.ts
│   │       └── termExtractor.test.ts
│   │
│   ├── mcp/                           # v2 新增
│   │   ├── server.ts                  # MCP Server 入口
│   │   ├── tools.ts                   # 工具定义（JSON Schema）
│   │   └── handlers.ts                # 工具处理函数
│   │
│   └── shared/                        # 从 v1 提取
│       ├── crypto.ts                  # 加密/解密/脱敏（从 service.ts 提取）
│       ├── id.ts                      # ID 生成（从 service.ts 提取）
│       └── envelope.ts                # API 信封（从 response.ts 提取）
│
├── skills/                            # Skill 定义文件
│   ├── bc-system/SKILL.md
│   ├── bc-auth/SKILL.md
│   ├── bc-glossary/SKILL.md
│   ├── bc-rules/SKILL.md
│   ├── bc-plan/SKILL.md
│   ├── bc-run/SKILL.md
│   └── bc-assets/SKILL.md
│
├── specs/                             # Planner 输出（gitignore）
│   └── _context/                      # PromptBuilder 写入的上下文文件
│
├── tests/                             # Generator 输出
│   ├── seed-*.spec.ts                 # SeedGenerator 生成的 fixture
│   └── generated/                     # Generator 生成的测试
│
├── .claude/
│   └── settings.json                  # MCP Server 配置
│
├── .brain-creator/                    # 本地持久化（gitignore）
│   ├── local-assets.json
│   └── screenshots/
│
├── .github/
│   └── playwright-agents/             # Playwright Agent 定义（init-agents 生成）
│
├── docs/
│   └── superpowers/
│       └── specs/
│           ├── 2026-05-27-brain-creator-mvp-design.md  # v1 保留
│           └── 2026-05-29-brain-creator-v2-architecture.md  # v2 架构
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts               # 保留（Agent 运行需要）
└── .gitignore
```

---

## 九、实施任务拆分

### Phase 0：基础清理（Day 1）

| 任务 | 操作 | 文件 |
|---|---|---|
| 0.1 | 创建 v2 分支 | git |
| 0.2 | 从 service.ts 提取 crypto.ts、id.ts | `src/shared/` |
| 0.3 | 从 response.ts 提取 envelope.ts | `src/shared/` |
| 0.4 | 更新 package.json（删除 Next.js 依赖，添加 MCP SDK） | `package.json` |
| 0.5 | 删除 Next.js 相关文件 | `app/`, `src/ui/`, `src/browser/` |
| 0.6 | 更新 tsconfig.json（移除 Next.js 路径别名） | `tsconfig.json` |
| 0.7 | 确认 `npm test` 通过（仅 domain 测试） | 验证 |

**产出**：干净的 Node.js 项目，domain 层测试通过。

### Phase 1：领域扩展（Day 1–2）

| 任务 | 操作 | 文件 |
|---|---|---|
| 1.1 | 新增 v2 类型：BusinessRule, TestCase, TestCaseScenario, TestCaseStep, RuleCheckResult, AgentRun, ChainRun, AssetType | `src/domain/types.ts` |
| 1.2 | Repository 新增集合：businessRules, testCases, agentRuns, chainRuns | `src/domain/repository.ts` |
| 1.3 | Service 新增方法：业务规则 CRUD, TestCase CRUD, AgentRun/ChainRun 记录 | `src/domain/service.ts` |
| 1.4 | 写测试 | `src/domain/__tests__/` |
| 1.5 | 确认全部 domain 测试通过 | 验证 |

**产出**：领域层支持所有 v2 实体和操作。

### Phase 2：Agent 工具层（Day 2–4）— 核心

| 任务 | 操作 | 文件 | 依赖 |
|---|---|---|---|
| 2.1 | PromptBuilder：术语表 + 规则 + Auth → prompt 文件 | `src/agent/promptBuilder.ts` | 1.1, 1.3 |
| 2.2 | PromptBuilder 测试 | `src/agent/__tests__/promptBuilder.test.ts` | 2.1 |
| 2.3 | SeedGenerator：Auth → seed.spec.ts | `src/agent/seedGenerator.ts` | 1.1 |
| 2.4 | SeedGenerator 测试 | `src/agent/__tests__/seedGenerator.test.ts` | 2.3 |
| 2.5 | CaseFormatter：spec Markdown ↔ TestCase 双向转换 | `src/agent/caseFormatter.ts` | 1.1 |
| 2.6 | CaseFormatter 测试 | `src/agent/__tests__/caseFormatter.test.ts` | 2.5 |
| 2.7 | TermExtractor：从 spec 内容提取中文术语候选 | `src/agent/termExtractor.ts` | 1.1 |
| 2.8 | TermExtractor 测试 | `src/agent/__tests__/termExtractor.test.ts` | 2.7 |
| 2.9 | QualityGate：用规则关键词检查 spec 内容 | `src/agent/qualityGate.ts` | 1.1 |
| 2.10 | QualityGate 测试 | `src/agent/__tests__/qualityGate.test.ts` | 2.9 |
| 2.11 | 确认全部 agent 测试通过 | 验证 | |

**产出**：6 个 agent 工具模块，全部有测试覆盖。**这一层是 Brain Creator 的核心价值所在，与 Playwright 完全无关，可以独立测试。**

### Phase 3：Agent 编排层（Day 4–6）

| 任务 | 操作 | 文件 | 依赖 |
|---|---|---|---|
| 3.1 | Orchestrator：spawn Playwright Agent 子进程 | `src/agent/orchestrator.ts` | 2.1–2.10 |
| 3.2 | Orchestrator：单 Agent 调用（planner / generator / healer） | 同上 | 3.1 |
| 3.3 | Orchestrator：链路调用（plan → generate → heal） | 同上 | 3.2 |
| 3.4 | Orchestrator 测试（mock spawn） | `src/agent/__tests__/orchestrator.test.ts` | 3.1–3.3 |
| 3.5 | 初始化 Playwright Agent 定义 | `npx playwright init-agents --loop=claude` | |
| 3.6 | 确认本地能调通 Planner（手动验证） | 手动 | 3.5 |

**产出**：能通过代码调用 Playwright Test Agents，支持单 Agent 和链路。

### Phase 4：MCP Server（Day 6–8）

| 任务 | 操作 | 文件 | 依赖 |
|---|---|---|---|
| 4.1 | MCP Server 框架 + 工具注册 | `src/mcp/server.ts` | Phase 2, 3 |
| 4.2 | 工具定义（JSON Schema） | `src/mcp/tools.ts` | 4.1 |
| 4.3 | 处理函数（连接 MCP 工具到 Service + Agent） | `src/mcp/handlers.ts` | 4.1, 4.2 |
| 4.4 | Claude Code 配置 | `.claude/settings.json` | 4.1 |
| 4.5 | 手动验证：在 Claude Code 中调用 bc_create_system | 手动 | 4.4 |

**产出**：MCP Server 可运行，Claude Code 能调用 Brain Creator 工具。

### Phase 5：Skill 定义（Day 8–9）

| 任务 | 操作 | 文件 | 依赖 |
|---|---|---|---|
| 5.1 | bc-system Skill 定义 | `skills/bc-system/SKILL.md` | 4.1 |
| 5.2 | bc-auth Skill 定义 | `skills/bc-auth/SKILL.md` | 4.1 |
| 5.3 | bc-glossary Skill 定义 | `skills/bc-glossary/SKILL.md` | 4.1 |
| 5.4 | bc-rules Skill 定义 | `skills/bc-rules/SKILL.md` | 4.1 |
| 5.5 | bc-plan Skill 定义 | `skills/bc-plan/SKILL.md` | 4.1 |
| 5.6 | bc-run Skill 定义 | `skills/bc-run/SKILL.md` | 4.1 |
| 5.7 | bc-assets Skill 定义 | `skills/bc-assets/SKILL.md` | 4.1 |

**产出**：7 个 Skill 定义，Claude Code 可按 slash command 触发。

### Phase 6：端到端验证（Day 9–10）

| 任务 | 操作 | 依赖 |
|---|---|---|
| 6.1 | 在 Claude Code 中完成完整流程：创建系统 → 配置鉴权 → 添加术语 → 添加规则 → 生成计划 → 确认用例 → 生成代码 → 查看结果 | Phase 4, 5 |
| 6.2 | 用真实目标网站验证（或用 v1 的 fixture 页面） | 6.1 |
| 6.3 | 验证术语沉淀流程（Planner 产出 → 新术语确认） | 6.1 |
| 6.4 | 验证 Gap 创建流程（Healer 失败 → Gap → resolve） | 6.1 |
| 6.5 | 编写 docs/v2-quickstart.md | 6.1–6.4 |

**产出**：端到端流程跑通，有快速入门文档。

---

## 十、不在本次范围内

| 内容 | 理由 |
|---|---|
| Web UI | Phase 1 用 Claude Code 做对话层，Web UI 视后续需求决定 |
| PostgreSQL 适配 | JSON 文件够用，PG 替换是独立任务 |
| LLM 审核（QualityGate 升级） | 先做关键词匹配，LLM 审核是后续增强 |
| 多 Agent 并行执行 | 当前串行够用，并行是性能优化 |
| CI/CD 集成 | 先验证本地流程，CI 是部署阶段的事 |
| Playwright MCP 协议 | 先用子进程调用 CLI，MCP 协议是后续升级 |

---

## 十一、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Playwright Agent CLI 接口不稳定 | 编排层需要适配 | Orchestrator 层封装，变化只影响一个文件 |
| Planner 对复杂 SPA 探索不完整 | 用例质量低 | 用户在确认环节补充场景 |
| 术语表冷启动质量差 | Planner 理解偏差 | prompt 中明确告知"术语表不完整，用原文" |
| spawn 子进程超时 | 链路卡住 | Orchestrator 设 timeout，超时创建 Gap |
| MCP SDK 版本变化 | 工具接口不兼容 | 工具定义与 SDK 解耦，handlers 独立 |

---

## 十二、成功标准

Phase 6 完成时，以下流程在 Claude Code 中端到端跑通：

```
用户: "接入商城系统 https://shop.example.com"
  → ✅ 系统创建成功

用户: "Token 登录，Bearer xxx"
  → ✅ 鉴权加密存储 + seed.spec.ts 生成

用户: "机器人 = Robot"
  → ✅ 术语保存

用户: "支付必须验证金额，阻断级别"
  → ✅ 规则保存

用户: "测试购买机器人的完整流程"
  → ✅ 返回 5 个结构化场景 + 2 个新术语候选 + 规则校验通过

用户: "确认"
  → ✅ .spec.ts 生成 + 运行通过 + ChainRun 记录

用户: "查看术语表"
  → ✅ 显示 3 个术语（含 Planner 沉淀的）

用户: "查看测试历史"
  → ✅ 显示 1 条 ChainRun，状态 succeeded
```
