# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 项目定位

**Brain Creator v2** — 面向 Claude Code / Codex 的智能体原生测试业务脑。它不是 Web UI，产品入口是智能体对话。提供 MCP 服务器（MCP Server），暴露 40+ 工具用于业务系统上下文、鉴权（Auth）、术语（Glossary）、业务规则（Rule）、测试计划（Plan）、Playwright 测试生成/修复（Generator/Healer）和缺口追踪（Gap）。

仓库：`brain-creator` npm 包（MIT license），版本 2.0.2。

### 入口设计（v2 最新）

用户通过两种入口使用 Brain Creator，Agent 自动路由：

```
用户消息到达
  ├─ 以 "/bc" 开头 → ⚡ 结构化命令路由（已有用例维护）
  ├─ 包含"接入/生成测试/帮我测"等 → 🗣 自然语言路由（新系统接入）
  └─ 意图模糊 → 主动展示两种入口让用户选择
```

入口路由逻辑定义在 Skill 文件的「入口路由」章节。详见 `.claude/skills/brain-creator/SKILL.md`。

## 构建、测试与运行

```bash
npm install                    # 安装依赖
npm test                       # 运行单元测试（vitest）
npx tsc --noEmit               # 类型检查（使用 tsconfig.json，非构建配置）
npm run build                  # 编译 src/ → dist/（tsconfig.build.json）
npm run mcp                    # 构建 + 启动 MCP 服务器（stdio 传输）
```

**运行单个测试：**
```bash
npx vitest run src/domain/service.test.ts         # 单个测试文件
npx vitest run -t "should create a system profile"  # 按测试名匹配
```

**TypeScript 配置：** ESM（`"type": "module"`），NodeNext 模块解析，strict 严格模式，`@/*` 路径别名映射到项目根目录。

## 架构

```
src/
├── cli/              # 4 个 CLI 入口（package.json 中的 bin 脚本）
│   ├── brainCreatorMcp.ts    → "brain-creator-mcp"      MCP 服务器启动
│   ├── doctor.ts             → "brain-creator-doctor"    环境诊断
│   ├── installAssets.ts      → "brain-creator-install-assets"  安装资源文件
│   └── writeMcpConfig.ts     → "brain-creator-write-mcp-config" 写入 MCP 配置
├── domain/           # 业务逻辑层 — 无 I/O，无 MCP 感知
│   ├── types.ts      # 全部领域类型（SystemProfile 系统配置、AuthProfile 鉴权、TestCase 用例等）
│   ├── service.ts    # BrainCreatorService — 全部业务操作
│   └── repository.ts # InMemoryBrainCreatorRepository + JsonFileBrainCreatorRepository
├── mcp/              # MCP 服务器层 — service 之上的薄胶水层
│   ├── server.ts     # McpServer 创建 + stdio 传输
│   ├── tools.ts      # 40 个工具定义，带 Zod schema
│   └── handlers.ts   # 工具处理器路由 → 调用 BrainCreatorService
├── agent/            # 智能体编排（Planner → Generator → Healer 链路）
│   ├── orchestrator.ts   # runAgent、generatePlanDraft、runChain — 核心流水线
│   ├── claudeBridge.ts   # Claude 子进程桥接（AgentBridge 实现）
│   ├── promptBuilder.ts  # 构建 Planner prompt，注入系统上下文
│   ├── seedGenerator.ts  # 生成 Playwright 鉴权种子（auth seed）文件
│   ├── caseFormatter.ts  # Spec Markdown ↔ 结构化场景 双向转换
│   ├── qualityGate.ts    # 确定性业务规则检查
│   ├── termExtractor.ts  # 从 Spec 中提取候选术语
│   └── liveSmokeOutput.ts # 解析实时 Agent 输出
└── shared/           # 加解密、ID 生成、响应信封、工作区路径解析
    ├── crypto.ts     # 密钥加密/解密/脱敏
    ├── id.ts         # 带前缀的类型化 ID 生成
    ├── envelope.ts   # 统一响应格式
    └── workspace.ts  # 工作区路径解析
```

**分层依赖流：** `CLI → MCP（tools + handlers）→ Domain（service + repository）`。`agent/` 模块被 MCP handler 消费，用于 `bc_generate_plan` 和 `bc_run_chain`。

**持久化（Persistence）：** 本地优先，JSON 文件存储在 `$BRAIN_CREATOR_WORKSPACE/.brain-creator/local-assets.json`。`InMemoryBrainCreatorRepository` 是基类；`JsonFileBrainCreatorRepository` 通过 `readFile`/`writeFile` 扩展它。测试使用内存变体。

**Agent 桥接（Agent Bridge）：** 真实的 Planner/Generator/Healer 以 Claude 子进程方式运行（`BRAIN_CREATOR_AGENT_COMMAND=claude`）。桥接器通过 stdin 发送非交互式 prompt。未设置环境变量时返回"bridge required（桥接未配置）"错误。Agent 定义文件位于 `.claude/agents/playwright-test-{planner,generator,healer}.md`。

**链路工作流（Chain Workflow）：** `bc_generate_plan` → 用户审核 → `bc_approve_plan` → `bc_run_chain`（Generator → Playwright 测试执行 → Healer 重试循环，最多 3 次）。链路无法修复时自动创建 Gap。

## Skill 文件

Brain Creator Skill 有三份副本（必须保持同步）：

| 位置 | 用途 |
|---|---|
| `.claude/skills/brain-creator/SKILL.md` | 本仓库的项目级 Skill（Claude Code 使用） |
| `skills/brain-creator/SKILL.md` | 可移植 Skill，随 npm 包分发 |
| `plugins/brain-creator/skills/brain-creator/SKILL.md` | Codex 插件附带的 Skill |

SKILL.md 定义了：入口路由规则（两种入口）、Natural Language 工作流、Semi-structured Command 命令清单、各领域模块的 Agent 内部执行参考，以及红线规则。

## 关键约定

- **系统隔离（System Isolation）：** 每个操作都限定在 `systemId`/`projectId`（二者等价）范围内。绝不跨系统混合资产。
- **密钥脱敏（Secret Redaction）：** 鉴权密钥落盘加密。所有 Auth 列表/读取操作在返回前调用 `redactSecrets()` 脱敏。绝不在响应中回显密钥原文。
- **Gap 优先的失败处理（Gap-first Failure Handling）：** 当证据缺失或链路失败时，创建 Gap 而不是伪造成功。Gap 有严重度 `low|medium|high` 和状态 `open|resolved`。
- **计划审批门禁（Plan Approval Gate）：** `bc_run_chain` 要求用例 `status: "approved"`。草稿计划必须经过审核和批准才能进入代码生成。
- **ID 前缀（ID Prefixes）：** 所有 ID 按类型加前缀：`system_`、`auth_`、`case_`、`agent_`、`chain_`、`gap_`、`term_`、`rule_`、`checkpoint_` 等。由 `src/shared/id.ts` 生成。
- **测试排除（Test Exclusions）：** Vitest 排除 `tests/e2e/**`、`tests/generated/**`、`tests/seed-*.spec.ts`、`.brain-creator-test/**`。Playwright 从 `./tests/generated` 运行。

## npm 包

发布文件由 `package.json` 的 `"files"` 字段控制（dist/、skills/、.claude/agents/、plugin/、docs/mcp-installation.md、README.md），外加 `.npmignore` 排除项。发布前运行：

```bash
npm run release:check            # 验证包名、license、npm 认证状态
npm run verify:package-contents   # 验证发布文件列表
npm run verify:package-install    # 对已安装包做冒烟测试
```

## 环境变量

| 变量 | 用途 |
|---|---|
| `BRAIN_CREATOR_WORKSPACE` | 数据目录（默认值：当前工作目录） |
| `BRAIN_CREATOR_DATA_FILE` | 覆盖 JSON 存储路径 |
| `BRAIN_CREATOR_AGENT_COMMAND` | Agent 子进程可执行文件（默认：`claude`） |
| `BRAIN_CREATOR_AGENT_ARGS` | 基础参数的 JSON 数组（例：`["--print","--permission-mode","acceptEdits"]`） |
| `BRAIN_CREATOR_AGENT_TIMEOUT_MS` | Agent 超时时间（毫秒） |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | 自定义 Chromium 可执行文件路径 |

## 实时验证脚本

以下脚本针对真实 Claude 运行并产出真实产物——不属于 `npm test` 范围：

```bash
npm run verify:live-claude-chain            # Planner → Generator → Healer 全链路
npm run verify:live-agent-artifacts         # 检查生成的 spec + test 产物
npm run verify:live-mcp-workflow            # 完整 MCP 工具工作流
npm run verify:live-claude-skill-workflow   # 端到端：Skill → MCP → 链路 → 产物
```

## 当前路线

**聚焦 v2：打磨 Skill + MCP 到极限。** v3 Agent 架构方向待具体信号触发后再启动（详见 memory）。
