# Brain Creator

Brain Creator 是面向 **Claude Code / Codex** 的 Agent 原生测试业务脑：它不是 Web UI，而是一套本地业务逻辑库 + MCP 工具集，让智能体能接入业务系统、理解业务语言、生成可审核的测试计划、调用 Playwright 测试生成与修复链路，并沉淀可复用测试资产。

Brain Creator is an agent-native testing brain for **Claude Code / Codex**. It is not a Web UI; it is a local business-logic library plus MCP toolset that helps an agent connect business systems, understand business language, generate reviewed test plans, run Playwright test generation and healing, and track reusable testing assets.

## 中文版

### 核心定位

**无 Web UI：** Brain Creator v2 的产品入口是 Claude Code / Codex 里的智能体对话。用户直接用自然语言说“用 Brain Creator ...”即可；`Skill("brain-creator")` 只作为自动匹配失败时的显式 fallback。

### 你可以做什么

- 接入多个业务系统，并隔离每个系统的鉴权、术语、规则、用例、产物和 Gap。
- 配置 token、cookie、password 或 script 鉴权，并避免后续回复重复暴露密钥。
- 添加业务术语和业务规则，让生成的测试贴合系统语义。
- 先生成草稿测试计划，用自然语言审核后，再批准进入代码生成。
- 执行 planner -> generator -> healer 链路，并查看生成的 Markdown spec 与 Playwright 测试文件。
- 当证据缺失或生成链路无法安全修复时，查看并处理 Gap，而不是让智能体伪造成功。
- 引用或指定 `.xlsx` / `.md` 测试用例文档路径，先预览用例统计和风险，确认后按文档顺序执行套件，并沉淀 BugReport / Gap / 证据路径。

### 分层入口

Brain Creator v2 现在采用三层入口：

- **用户入口：** 自然语言，例如“用 Brain Creator 执行这个测试用例文档：`F:\ZT_HR\06-招聘管理\用例\招聘需求及offer流程适配_V2.0_测试用例.xlsx`”。
- **Agent Facade 入口：** Agent 默认使用 `bc_status`、`bc_configure`、`bc_run`、`bc_review`。
- **内部工具入口：** 现有细粒度 `bc_*` 工具继续保留，用于兼容、调试、审计和 Facade 内部编排。

当用户直接说“执行 HRMS 的这个 Excel”“只跑招聘需求模块/P0/TC-001”“查看 HRMS open bug”“回归 HRMS open bug”“继续 HRMS 未完成套件”这类自然语言时，Agent 可以先调用 `bc_intent_preview`。该工具只返回建议的 Facade 调用，不会执行；需要执行测试用例文档时仍必须先预览并等待用户确认。

新会话中已知 `systemId` 时，Agent 应先调用 `bc_status`。返回值包含完整系统快照，也包含面向用户展示的 `userSummary`、可直接转述的 `statusMarkdown`、可直接建议的 `quickCommands` 和机器可读的 `toolGuidance`。`toolGuidance` 会明确默认使用 Facade 工具，底层细粒度工具仅用于调试、审计或 Facade 无法覆盖的场景。

如果用户不知道 `systemId`，Facade 工具可接受 `systemName` / `environment`，快捷命令也可使用 `--system HRMS --env test`。当匹配到多个系统时，Brain Creator 会返回候选列表，要求补充环境或系统 ID，不会盲选。

如果用户明确输入 `/bc ...`，Agent 可以调用 `bc_command` 作为最小命令解析入口。当前支持：

- `/bc help`：查看 Brain Creator 快捷命令、筛选参数和推荐入口；不需要选择系统。
- `/bc status`：查看当前系统状态；未选择系统时返回紧凑的系统选择器或接入引导，不再输出冗长错误列表。
- `/bc status`：查看当前系统状态。
- `/bc status --system HRMS --env test`：按系统名和环境查看状态。
- `/bc run "<path>"`：预览测试用例文档套件，不会直接执行；可追加 `--case TC-001,TC-002`、`--module 招聘需求`、`--priority P1`。
- `/bc continue`：继续最近未完成的套件。
- `/bc regress bugs`：回归当前系统的 open bug；可追加 `--bug bug_xxx`、`--module Recruiting`、`--priority P0`。
- `/bc bugs` 或 `/bc review bugs`：查看 BugReport；可追加 `--failure-type assertion_failure`。
- `/bc gaps`：查看 Gap；可追加 `--failure-type locator_failure`。
- `/bc review suite`：复盘最近的 suite run；可追加 `--failure-type assertion_failure,network_failure`。

`/bc` 是快捷入口，不是必需入口；自然语言仍然是推荐的用户入口。

执行测试用例文档时，Agent 应先调用 `bc_run mode=case-source-suite confirm=false` 返回预览；只有用户明确确认后，才调用 `confirm=true` 执行 suite run。默认是全量执行；如果用户说“只跑 TC-001/TC-002”“只跑招聘需求模块”或“只跑 P0”，Agent 应映射为 `caseNos`、`modules`、`priorities` 筛选条件。多个筛选条件同时出现时取交集。

当前文档来源支持：

- 本地 `.xlsx` 文件。
- 包含标准测试用例表头的 `.md` 文件。
- `obsidian:<path>`、`claudian:<path>` 和 `[[path]]` 引用形式；Brain Creator 会读取引用文件，但资产中保留原始 source 引用。

如果 suite run 中途失败，后续可直接说“继续上次未完成套件”。Agent 应先调用 `bc_status` 查看 `suites.unfinished`，再调用 `bc_run mode=case-source-suite resume=true confirm=true`；Brain Creator 会复用最近未完成 suite 的 source 和 `suiteId`，只重跑尚未通过的用例。Suite / Bug / Gap / Artifact 复盘请使用 `bc_review`，结果会包含统一的 `reviewSummary` 和可直接转述的 `reviewMarkdown`；`reviewSummary` 提供 `title`、`status`、`metrics`、`evidencePaths`、`nextAction` 和 `userMessage`，其中 Suite 复盘的 `metrics.failureClassification` 会区分 business bugs、evidence gaps、failed cases 和 blocked cases，并通过 `byType` 输出稳定枚举：`assertion_failure`、`auth_failure`、`locator_failure`、`network_failure`、`execution_failure`、`unknown_failure`。要只看某类失败，可在 `bc_review` 传入 `failureTypes`，例如 `["locator_failure"]`。`reviewMarkdown` 提供简短报告。需要详细报告时，Suite 和 Bug 复盘仍可使用 `reportMarkdown`；当用户说“回归所有 open bug”时，Agent 应调用 `bc_run mode=bug-regression`，默认回归 open / retest-failed bug，也可用 `bugIds`、`modules`、`priorities` 取交集筛选；结果会包含状态汇总和 `regressionMarkdown`。

### 用户入口到 Agent 工具映射

| 用户说法 | Agent 默认入口 | 确认边界 | 用户应该看到 |
|---|---|---|---|
| “当前 HRMS 状态怎么样？” | `bc_status` | 不需要确认 | 系统、鉴权、suite、Bug、Gap、产物摘要、下一步建议和 `statusMarkdown`。 |
| “我想接入一个新系统” | `bc_configure target=system` | 创建前确认系统名称、环境和 URL 范围 | 新系统 ID、环境、默认语言和后续鉴权/建模建议。 |
| “配置这个系统的 token/cookie/password” | `bc_configure target=auth` | 不在聊天中回显密钥；敏感值只进工具输入 | 脱敏后的鉴权配置和验证状态。 |
| “需要我手动登录/验证码/2FA” | `bc_configure target=checkpoint` | 等用户明确完成后再继续 | checkpoint 原因、恢复方式和等待状态。 |
| “帮我判断这句话该怎么执行” | `bc_intent_preview` | 只预览，不执行 | 建议使用的 Facade、参数和风险提示。 |
| “执行这个 Excel/Markdown 用例文档” | `bc_run mode=case-source-suite confirm=false` | 必须先预览，等待用户确认 | 用例总数、模块/优先级统计、样例用例、风险和 bridge 状态。 |
| “确认执行刚才的用例文档” | `bc_run mode=case-source-suite confirm=true` | 只能在预览后执行；写回 Excel 还需额外确认 | suite run 结果、BugReport、Gap 和证据路径。 |
| “继续上次未完成的套件” | `bc_status` 后接 `bc_run mode=case-source-suite confirm=true` | 确认使用最近未完成 suite | 只重跑未通过用例的结果和剩余阻塞项。 |
| “回归 open bug / 只回归 P0 招聘模块 bug” | `bc_run mode=bug-regression` | 不需要额外计划审批，但筛选条件要透明展示 | 回归候选、通过/失败/阻塞统计和 `regressionMarkdown`。 |
| “查看 Bug / Gap / 产物 / suite run” | `bc_review target="bug"`、`bc_review target="gap"` 或对应 target | 不需要确认 | 统一 `reviewSummary` 和可直接转述的 `reviewMarkdown`，必要时附 `reportMarkdown`。 |
| “这个问题无法判断，记录一个缺口” | `bc_report_gap` | 需要说明原因、严重级别和 owner | Gap 编号、状态和后续处理建议。 |

源文档写回默认关闭。只有用户明确要求“写回 Excel / 更新源文档”时，Agent 才能在 `bc_run mode=case-source-suite` 中同时传入 `writeBack: true` 和 `confirmWriteBack: true`。当前写回仅支持本地 `.xlsx`，会更新“实际结果 / 用例状态 / BugID”三列；写回前会在源文件同目录的 `.brain-creator/backups` 中创建备份，并在返回结果中提供 `backupPath`。Markdown、Obsidian、Claudian 引用只执行与记录结果，不修改源文档。

### 快速开始

安装依赖并验证本地基线：

```bash
npm install
npm test
npx tsc --noEmit
```

启动 Brain Creator MCP server：

```bash
npm run mcp
```

本地运行真实 Planner / Generator / Healer 时，Brain Creator 支持多 provider bridge。默认 MCP 配置使用 `BRAIN_CREATOR_AGENT_PROVIDER=auto`；Claude Code 可显式使用 `claude`，Codex 子进程可显式使用 `codex`，Codex 插件/当前 Agent 执行可使用 `host-agent`：

```bash
BRAIN_CREATOR_AGENT_PROVIDER=codex
BRAIN_CREATOR_CODEX_COMMAND=codex
BRAIN_CREATOR_CODEX_ARGS='["exec","--json","--ephemeral","--sandbox","workspace-write","--ask-for-approval","never","-C","{cwd}","-"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

`host-agent` 模式不会启动 Claude/Codex 子进程。Agent 可直接调用 `bc_prepare_agent_task`，读取返回的 `input.prompt.md` / `input.context.json`，完成输出文件后调用 `bc_submit_agent_output`。如果用户已经批准用例并调用 `bc_run_chain`，Brain Creator 会自动写出 spec/seed，并返回 `status: "needs_agent_execution"` 的 generator 任务包；此时不要等待子进程，当前 Agent 应完成任务包后再调用 `bc_submit_agent_output`。提交成功后，Brain Creator 会自动运行 Playwright；测试通过时记录 AgentRun、ChainRun 和测试产物归属，测试失败时返回 healer 任务包。healer 提交后会再次运行 Playwright，成功则完成链路；仍失败时会将链路标记为 failed。如果任务来自测试用例文档 suite，Brain Creator 会记录单用例 suite run，后续 resume 会跳过已通过用例；业务预期未满足会生成 BugReport，环境、鉴权、定位或执行阻塞会生成 Gap。

Windows PowerShell 中请使用 `$env:` 设置同样的环境变量后再启动 MCP 客户端。

### 业务项目安装步骤

推荐在每个业务项目里做本地安装，这样 Brain Creator 跟随项目版本走：

```bash
npm install --save-dev brain-creator
npx brain-creator-install-assets
npx brain-creator-write-mcp-config
npx brain-creator-doctor
```

这几步分别完成：

- `npm install --save-dev brain-creator`：把 Brain Creator 安装到当前业务项目。
- `npx brain-creator-install-assets`：把 Brain Creator Skill 和 Playwright Planner / Generator / Healer agent 定义安装到当前业务项目。
- `npx brain-creator-write-mcp-config`：创建或更新当前业务项目的 `.mcp.json`，默认写入 `npx brain-creator-mcp` 和 `BRAIN_CREATOR_AGENT_PROVIDER=auto`，因此适配本地安装。
- `npx brain-creator-doctor`：在真正使用前检查 workspace、agent bridge provider 和 agent 定义，并输出当前 provider 的推荐执行路径。

如果你已经知道运行环境，可以在写入 MCP 配置时显式选择 provider：

```bash
npx brain-creator-write-mcp-config --provider claude
npx brain-creator-write-mcp-config --provider codex
npx brain-creator-write-mcp-config --provider host-agent
```

`--provider` 仅接受 `auto`、`claude`、`codex`、`host-agent`、`disabled`。拼写错误会直接失败，避免静默写成错误配置。

如果你偏好全局安装，也可以执行：

```bash
npm install -g brain-creator
brain-creator-install-assets
brain-creator-write-mcp-config --global
brain-creator-doctor
```

之后重启或重载 Claude Code / Codex 的 MCP 连接，在业务项目中输入：

```text
用 Brain Creator 接入这个业务系统，生成测试计划，先等我审批，再执行链路。
```

本地包安装验证：

```bash
npm run verify:package-install
```

该检查会打包并安装 Brain Creator 到临时业务项目，通过 stdio 启动安装后的 MCP server，验证 `/bc help`，并完成一次 `host-agent` 任务准备、提交与 AgentRun 持久化。

### 发布前检查

正式发布 npm 包前，先确认包内容只包含运行所需文件，不包含本地资产、缓存、测试结果或源码工作目录：

```bash
npm run release:check
npm run verify:package-contents
npm run verify:package-install
```

当前 `brain-creator` 包名、MIT license、npm 登录账号和发布权限已进入发布前检查范围。真正发布前必须确认 `npm run release:check`、`npm run verify:package-contents` 和 `npm run verify:package-install` 全部通过。

如果 npm 账号开启了双因素认证，真实发布时还需要当前 OTP：

```bash
npm publish --access public --otp=<当前 2FA 验证码>
```

发布清单见 [docs/release-checklist.md](docs/release-checklist.md)。
2.0.2 发布说明见 [docs/release-notes-2.0.2.md](docs/release-notes-2.0.2.md)。

### Codex `/plugin` 本地发布

仓库已提供 repo-local Codex 插件：

- `plugins/brain-creator/.codex-plugin/plugin.json`：插件展示、starter prompt 和能力描述。
- `plugins/brain-creator/.mcp.json`：通过 `npx brain-creator-mcp` 注册 MCP server，并默认使用 `BRAIN_CREATOR_AGENT_PROVIDER=host-agent`，让当前 Codex Agent 执行任务包。
- `plugins/brain-creator/skills/`：随插件提供 Brain Creator skill。
- `.agents/plugins/marketplace.json`：将 `brain-creator` 作为本地 marketplace 插件暴露给 Codex。

Codex 最多接受 3 条 starter prompt。Brain Creator 保留“快捷帮助与状态”“接入系统”“预览测试文档”三个主入口；继续 suite、复盘 bug/gap 和 doctor 指引通过 `/bc help` 发现。

状态、资产与复盘类 MCP 工具带有标准 `readOnlyHint`，Codex 可在不申请写权限的情况下完成查询。创建、配置和执行仍保留 host 审批；如果调用被取消或拒绝，Agent 不会换用底层工具重复尝试。

如果要一次性验证 Codex 原生入口是否健康，运行：

```bash
npm run verify:codex-native-entry
```

该检查会覆盖 repo-local plugin starter prompt、host-agent doctor 指引、`/bc help` 只读快捷入口，以及 host-agent 任务包提交链路。

验证插件：

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
```

插件安装后仍要求业务项目安装 npm 包。项目本地安装时使用 `npx brain-creator-*` 命令；全局安装时可以直接使用 `brain-creator-*` 命令。

### 智能体入口

在 Claude Code 或 Codex 中使用一句话请求：

```text
Use Brain Creator to connect the local order system, add a rule that order total must be visible, generate a test plan, wait for my approval, then run the chain.
```

预期行为：智能体先加载 Brain Creator skill，选择匹配的 MCP 工具，创建或复用业务系统，按需配置鉴权，生成草稿计划，等待你批准，然后执行 `bc_run_chain`，最后总结产物和 Gap。

完整用户手册见 [docs/agent-usage.md](docs/agent-usage.md)。

### 验证命令

基础验证：

```bash
npm test
npx tsc --noEmit
```

真实 Agent 验证：

```bash
npm run verify:live-claude-chain
npm run verify:live-agent-artifacts
npm run verify:live-mcp-workflow
npm run verify:live-claude-skill-workflow
```

其中 `npm run verify:live-claude-skill-workflow` 是最接近真实用户体验的验收：它会验证真实 Claude Code 会话加载 `Skill("brain-creator")`、选择 Brain Creator MCP 工具、跑到 `bc_run_chain` 成功，并汇总生成产物。

### 关键路径

- `.claude/skills/brain-creator/SKILL.md` - Claude Code 项目级 skill 入口。
- `skills/brain-creator/SKILL.md` - 可复用的 Brain Creator skill 定义。
- `src/mcp/` - MCP server、工具 schema 和 handlers。
- `src/agent/` - prompt 构建、seed 生成、用例格式化、编排、质量检查和 live smoke 解析。
- `src/domain/` - 业务系统、鉴权、术语、规则、用例、运行记录、Gap 和仓库存储。
- `docs/v2-quickstart.md` - 工具级设置与 API 风格流程。
- `docs/agent-usage.md` - 面向最终用户的智能体使用流程。

### 当前限制

- Brain Creator v2 当前是 local-first，使用 JSON 持久化。
- 常规界面是 Claude Code / Codex，不是浏览器页面。
- 当前 Playwright CLI 提供 Claude agent 定义；Brain Creator 通过 Claude 子进程桥接调用这些 agent。
- PostgreSQL、CI 中执行 live smoke、LLM QualityGate 和并行 Agent 是后续增强。

## English Version

### Positioning

**No Web UI:** the Brain Creator v2 product entrypoint is the agent conversation in Claude Code / Codex. Users should ask naturally, such as `Use Brain Creator to connect this system`; `Skill("brain-creator")` is only an explicit troubleshooting fallback when automatic skill matching fails.

### What You Can Do

- Connect multiple business systems with isolated auth, glossary, rules, cases, artifacts, and gaps.
- Configure token, cookie, password, or script auth without echoing secrets back into later responses.
- Add business terms and rules so generated tests match the system's domain language.
- Generate a draft test plan first, review it in natural language, then approve it before code generation.
- Run the planner -> generator -> healer chain and inspect generated Markdown specs and Playwright tests.
- Review gaps when evidence is missing or a generated chain cannot be repaired safely.
- Reference or specify `.xlsx` / `.md` test case documents, preview case statistics and risks, then run the confirmed suite in document order while recording BugReport, Gap, and evidence paths.

### Layered Entrypoints

Brain Creator v2 uses three layers:

- **User entry:** natural language, for example: `Use Brain Creator to execute this test case document: F:\ZT_HR\06-招聘管理\用例\招聘需求及offer流程适配_V2.0_测试用例.xlsx`.
- **Agent facade entry:** agents should default to `bc_status`, `bc_configure`, `bc_run`, and `bc_review`.
- **Internal tool entry:** existing fine-grained `bc_*` tools remain available for compatibility, debugging, audit, and facade orchestration.

When the user says things like "execute this Excel for HRMS", "only run the recruiting module / P0 / TC-001", "show HRMS open bugs", "regress HRMS open bugs", or "continue the unfinished HRMS suite", the agent can call `bc_intent_preview` first. It only returns the suggested facade call and does not execute it; document-suite execution still requires preview and explicit user confirmation.

When a new session already knows `systemId`, the agent should call `bc_status` first. The response includes the full system snapshot plus user-facing `userSummary`, directly reusable `statusMarkdown`, suggested `quickCommands`, and machine-readable `toolGuidance`. `toolGuidance` tells the agent to default to facade tools and reserve fine-grained tools for debugging, audit, or unsupported facade details.

If the user does not know `systemId`, facade tools accept `systemName` / `environment`, and slash commands can use `--system HRMS --env test`. When multiple systems match, Brain Creator returns candidates and asks for environment or system ID instead of guessing.

When the user explicitly types `/bc ...`, the agent can call `bc_command` as the minimal command parser. Supported commands:

- `/bc help`: show Brain Creator shortcuts, filters, and recommended entrypoints without requiring a selected system.
- `/bc status`: show current system readiness; without a selected system it returns a compact system picker or connection guidance instead of a long error list.
- `/bc status`: inspect the current system status.
- `/bc status --system HRMS --env test`: inspect status by system name and environment.
- `/bc run "<path>"`: preview a test case document suite without executing it; optional filters include `--case TC-001,TC-002`, `--module Recruiting`, and `--priority P1`.
- `/bc continue`: resume the latest unfinished suite.
- `/bc regress bugs`: regress open bugs for the current system; optional filters include `--bug bug_xxx`, `--module Recruiting`, and `--priority P0`.
- `/bc bugs` or `/bc review bugs`: review BugReports; optional filter: `--failure-type assertion_failure`.
- `/bc gaps`: review Gaps; optional filter: `--failure-type locator_failure`.
- `/bc review suite`: review the latest suite run; optional filter: `--failure-type assertion_failure,network_failure`.

`/bc` is a convenience entrypoint, not a required one. Natural language remains the recommended user entrypoint.

For a test case document, the agent should call `bc_run mode=case-source-suite confirm=false` first. Only after explicit user confirmation should it call the same mode with `confirm=true` to execute the suite run. The default is the full document; if the user says "only run TC-001/TC-002", "only run the recruiting module", or "only run P0", map that request to `caseNos`, `modules`, and `priorities`. Multiple filters are intersected.

Supported document sources:

- Local `.xlsx` files.
- `.md` files that contain the standard executable test case table headers.
- `obsidian:<path>`, `claudian:<path>`, and `[[path]]` references. Brain Creator reads the referenced file while keeping the original source reference in its assets.

If a suite run fails midway, the user can simply say "continue the unfinished suite." The agent should call `bc_status` to inspect `suites.unfinished`, then call `bc_run mode=case-source-suite resume=true confirm=true`; Brain Creator reuses the latest unfinished suite source and `suiteId` and reruns only cases that have not passed in that suite. Use `bc_review` for Suite, Bug, Gap, and Artifact reviews. The response includes a unified `reviewSummary` and directly reusable `reviewMarkdown`; `reviewSummary` exposes `title`, `status`, `metrics`, `evidencePaths`, `nextAction`, and `userMessage`, while Suite review `metrics.failureClassification` separates business bugs, evidence gaps, failed cases, and blocked cases. Its `byType` field uses stable enums: `assertion_failure`, `auth_failure`, `locator_failure`, `network_failure`, `execution_failure`, and `unknown_failure`. Pass `failureTypes`, such as `["locator_failure"]`, to `bc_review` when the user wants only one failure class. `reviewMarkdown` provides a short report. Use `reportMarkdown` for detailed Suite/Bug handoffs. When the user says "regress all open bugs", call `bc_run mode=bug-regression`; it defaults to open / retest-failed bugs and can narrow candidates by intersecting `bugIds`, `modules`, and `priorities`. The result includes a status summary and `regressionMarkdown`.

### User Entrypoint To Agent Tool Map

| User wording | Agent default entry | Confirmation boundary | User-visible result |
|---|---|---|---|
| "What is the current HRMS status?" | `bc_status` | No confirmation required | System, auth, suite, bug, gap, artifact summary, next action, and `statusMarkdown`. |
| "Connect a new business system" | `bc_configure target=system` | Confirm system name, environment, and URL scope before creation | New system id, environment, default locale, and setup suggestions. |
| "Configure token/cookie/password auth" | `bc_configure target=auth` | Do not echo secrets in chat; sensitive values only enter tool input | Redacted auth profile and verification state. |
| "I need to complete login/CAPTCHA/2FA manually" | `bc_configure target=checkpoint` | Wait for explicit user completion before continuing | Checkpoint reason, resume instructions, and waiting state. |
| "Help me decide how to run this request" | `bc_intent_preview` | Preview only; no execution | Suggested facade, parameters, and risks. |
| "Execute this Excel/Markdown test case document" | `bc_run mode=case-source-suite confirm=false` | Must preview and wait for user confirmation | Case count, module/priority stats, sample cases, risks, and bridge status. |
| "Confirm and run that document" | `bc_run mode=case-source-suite confirm=true` | Only after preview; Excel write-back requires a separate explicit confirmation | Suite run result, BugReports, Gaps, and evidence paths. |
| "Continue the unfinished suite" | `bc_status` then `bc_run mode=case-source-suite confirm=true` | Confirm the latest unfinished suite is the intended target | Results for rerun unfinished cases and remaining blockers. |
| "Regress open bugs / only P0 recruiting bugs" | `bc_run mode=bug-regression` | No plan approval required, but filters must be visible | Regression candidates, pass/fail/blocked summary, and `regressionMarkdown`. |
| "Review Bugs / Gaps / artifacts / suite runs" | `bc_review target="bug"`, `bc_review target="gap"`, or the matching target | No confirmation required | Unified `reviewSummary` and directly reusable `reviewMarkdown`, with `reportMarkdown` when useful. |
| "Record this as a gap" | `bc_report_gap` | Require reason, severity, and owner context | Gap id, status, and next handling suggestion. |

Source document write-back is off by default. Only when the user explicitly asks to write results back to Excel or update the source document should the agent pass both `writeBack: true` and `confirmWriteBack: true` to `bc_run mode=case-source-suite`. Current write-back supports local `.xlsx` only and updates the actual result, case status, and BugID columns. Before writing, Brain Creator creates a backup under `.brain-creator/backups` beside the source file and returns `backupPath`. Markdown, Obsidian, and Claudian references are executed and recorded but not modified.

### Fast Start

Install dependencies and verify the local baseline:

```bash
npm install
npm test
npx tsc --noEmit
```

### Installation Modes

Brain Creator supports three installation paths:

- source checkout mode: use this repository directly when developing Brain Creator.
- MCP CLI connection mode: install `brain-creator` in a business project and connect MCP through `npx brain-creator-mcp`.
- repo-local plugin installation mode: use `plugins/brain-creator` plus `.agents/plugins/marketplace.json` to expose Brain Creator through Codex `/plugin`.

Before a real agent workflow, run:

```bash
npm install --save-dev brain-creator
npx brain-creator-install-assets
npx brain-creator-write-mcp-config
npx brain-creator-doctor
```

See [docs/mcp-installation.md](docs/mcp-installation.md) for the copyable Claude Code / Codex MCP configuration.

Package installation smoke:

```bash
npm run verify:package-install
```

This check packs and installs Brain Creator into a temporary business project, starts the installed MCP server over stdio, verifies `/bc help`, and completes one `host-agent` task prepare/submit cycle with a persisted AgentRun.

### Release Readiness

Before publishing an npm package, verify that the package contains only runtime files and excludes local assets, caches, test results, and source workspace data:

```bash
npm run release:check
npm run verify:package-contents
npm run verify:package-install
```

The `brain-creator` package name, MIT license, npm account, and publish permissions are covered by the release readiness gates. Before a real publish, confirm `npm run release:check`, `npm run verify:package-contents`, and `npm run verify:package-install` all pass.

If the npm account has two-factor authentication enabled, the real publish command also needs the current OTP:

```bash
npm publish --access public --otp=<current-2fa-code>
```

See [docs/release-checklist.md](docs/release-checklist.md).
See [docs/release-notes-2.0.2.md](docs/release-notes-2.0.2.md) for the 2.0.2 patch notes.

### Codex `/plugin` Local Publish

The repository now includes a repo-local Codex plugin:

- `plugins/brain-creator/.codex-plugin/plugin.json`: plugin metadata, starter prompts, and capability text.
- `plugins/brain-creator/.mcp.json`: registers the MCP server through `npx brain-creator-mcp` and defaults to `BRAIN_CREATOR_AGENT_PROVIDER=host-agent`, so the current Codex agent executes task packages.
- `plugins/brain-creator/skills/`: ships the Brain Creator skill with the plugin.
- `.agents/plugins/marketplace.json`: exposes `brain-creator` as a local marketplace plugin for Codex.

Codex accepts at most three starter prompts. Brain Creator keeps the three primary journeys: shortcut help plus status, system connection, and test-document preview. Suite continuation, bug/gap review, and doctor guidance remain discoverable through `/bc help`.

Status, asset, and review MCP tools carry standard `readOnlyHint` annotations so Codex can inspect them without requesting write access. Creation, configuration, and execution retain host approval; when a call is cancelled or denied, the Agent does not retry through a lower-level tool.

Install the repo-local plugin from the repository root. Pass the repository root to `marketplace add`; Codex reads `.agents/plugins/marketplace.json` from there:

```bash
cd /path/to/brain-creator-mvp
codex plugin marketplace add .
codex plugin add brain-creator@personal
```

After installing Brain Creator from npm inside a business project, use the installed package root as the marketplace source:

```bash
cd /path/to/business-project
npm install --save-dev brain-creator
codex plugin marketplace add node_modules/brain-creator
codex plugin add brain-creator@personal
```

Do not pass `plugins/`, `plugins/brain-creator`, or `.agents/plugins/marketplace.json` directly. Those paths are not marketplace roots for the Codex CLI.

To verify the Codex-native entrypoint in one command:

```bash
npm run verify:codex-native-entry
```

This check covers the repo-local plugin starter prompt, host-agent doctor guidance, read-only `/bc help`, the host-agent task handoff chain, and Codex plugin installation from both the source checkout and a packed npm install. To verify only the Codex plugin marketplace installation path, run:

```bash
npm run verify:codex-plugin-install
```

Validate the plugin:

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
```

After plugin installation, the business project still needs the npm package installed. Use `npx brain-creator-*` commands for project-local installs, or direct `brain-creator-*` commands for global installs.

### Business Project Setup

After Brain Creator is available from npm, go to the business project directory and run the local-install flow:

```bash
npm install --save-dev brain-creator
npx brain-creator-install-assets
npx brain-creator-write-mcp-config
npx brain-creator-doctor
```

These commands:

- `npm install --save-dev brain-creator`: installs Brain Creator into the current business project.
- `npx brain-creator-install-assets`: installs the Brain Creator Skill and Playwright Planner / Generator / Healer agent definitions into the current business project.
- `npx brain-creator-write-mcp-config`: creates or updates the business project's `.mcp.json`, preserving existing MCP servers and using `npx brain-creator-mcp` for local installs.
- `npx brain-creator-doctor`: checks workspace, agent bridge provider, and agent definitions before the first workflow, then prints the recommended execution path for the active provider.

If you already know the runtime environment, choose the provider while writing MCP config:

```bash
npx brain-creator-write-mcp-config --provider claude
npx brain-creator-write-mcp-config --provider codex
npx brain-creator-write-mcp-config --provider host-agent
```

`--provider` only accepts `auto`, `claude`, `codex`, `host-agent`, and `disabled`. Typos fail instead of silently writing the wrong config.

For a global install instead:

```bash
npm install -g brain-creator
brain-creator-install-assets
brain-creator-write-mcp-config --global
brain-creator-doctor
```

Then restart or reload the Claude Code / Codex MCP connection and say:

```text
Use Brain Creator to connect this business system, generate a test plan, wait for my approval, then run the chain.
```

Start the Brain Creator MCP server:

```bash
npm run mcp
```

Configure the agent bridge when running real Planner / Generator / Healer flows locally. The default MCP config uses `BRAIN_CREATOR_AGENT_PROVIDER=auto`; use `claude` for Claude Code, `codex` for Codex subprocess execution, or `host-agent` when the current agent should execute task packages:

```bash
BRAIN_CREATOR_AGENT_PROVIDER=codex
BRAIN_CREATOR_CODEX_COMMAND=codex
BRAIN_CREATOR_CODEX_ARGS='["exec","--json","--ephemeral","--sandbox","workspace-write","--ask-for-approval","never","-C","{cwd}","-"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

Host-agent mode does not start a Claude or Codex subprocess. The agent may call `bc_prepare_agent_task`, read the returned `input.prompt.md` and `input.context.json`, create the requested outputs, then call `bc_submit_agent_output`. When an approved case is run through `bc_run_chain`, Brain Creator writes the spec/seed files and returns a generator task package with `status: "needs_agent_execution"`; the current agent should execute that package instead of waiting for a subprocess. After a successful generator submission, Brain Creator runs Playwright automatically. Passing tests record the linked AgentRun, ChainRun, and generated test artifact ownership; failing tests return a healer task package. A successful healer submission reruns Playwright and completes the chain; a still-failing healer submission marks the chain failed. If the task came from a document suite, Brain Creator also records a single-case suite run so later resume skips passed cases; unmet business expectations create BugReports, while environment, auth, locator, or execution blockers create Gaps.

On Windows PowerShell, set the same values with `$env:` before launching the MCP client.

### Agent Entry

Use a one-sentence request in Claude Code or Codex:

```text
Use Brain Creator to connect the local order system, add a rule that order total must be visible, generate a test plan, wait for my approval, then run the chain.
```

The agent should load the Brain Creator skill, prefer the facade MCP tools, create or reuse a business system, configure auth if needed, generate or preview the requested work, ask for approval when required, run through `bc_run`, and summarize artifacts, bugs, and gaps.

For test case documents, use a natural request such as:

```text
Use Brain Creator to execute this test case document: F:\ZT_HR\06-招聘管理\用例\招聘需求及offer流程适配_V2.0_测试用例.xlsx
```

The agent should preview the source first, show case count, module/priority stats, sample cases, bridge status, and risks, then wait for confirmation before running the full suite.

For a full user-facing guide, see [docs/agent-usage.md](docs/agent-usage.md).

### Verification

Core checks:

```bash
npm test
npx tsc --noEmit
```

Live agent checks:

```bash
npm run verify:live-claude-chain
npm run verify:live-agent-artifacts
npm run verify:live-mcp-workflow
npm run verify:live-claude-skill-workflow
```

`npm run verify:live-claude-skill-workflow` verifies the real Claude Code session entrypoint: a natural Brain Creator request is handled, Brain Creator MCP tools are selected, `bc_run_chain` succeeds, and artifacts are summarized.

### Important Paths

- `.claude/skills/brain-creator/SKILL.md` - Claude Code project skill entrypoint.
- `skills/brain-creator/SKILL.md` - portable Brain Creator skill definition.
- `src/mcp/` - MCP server, tool schemas, and handlers.
- `src/agent/` - prompt building, seed generation, case formatting, orchestration, quality checks, live smoke parsing.
- `src/domain/` - business systems, auth, glossary, rules, cases, runs, gaps, and repository persistence.
- `docs/v2-quickstart.md` - tool-level setup and API-style workflow.
- `docs/agent-usage.md` - end-user agent workflow.

### Current Limits

- Brain Creator v2 is local-first and uses JSON persistence.
- The normal interface is Claude Code / Codex, not a browser UI.
- Brain Creator can call Planner / Generator / Healer through a Claude subprocess bridge, a Codex subprocess bridge, host-agent task handoff, or preview-only disabled mode.
- PostgreSQL, CI live-smoke execution, LLM quality review, and parallel agent execution are future enhancements.
