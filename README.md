# Brain Creator

Brain Creator is a requirement-driven, agent-native testing brain for Claude Code and Codex. Give it a requirement document or link; it turns the source into traceable knowledge, reviewable test intent, test data, executable Playwright cases, evidence, BugReports, and Gaps.

Brain Creator has **No Web UI**. The conversation in Claude Code or Codex is the user interface; a Skill and MCP server provide the testing workflow behind it.

[中文](#中文) | [English](#english) | [Documentation](https://zhuyanlong0091-prog.github.io/brain-creator/) | [中文文档](https://zhuyanlong0091-prog.github.io/brain-creator/zh-CN/) | [npm](https://www.npmjs.com/package/brain-creator)

## 中文

Brain Creator 无 Web UI；Claude Code 或 Codex 中的对话就是用户入口。

### 五分钟开始

**前置条件**

- Node.js 20 或更高版本
- Claude Code 或 Codex
- 一个可写的业务项目目录

在业务项目中安装并初始化：

```bash
npm install --save-dev brain-creator
npx brain-creator init --provider host-agent
npx brain-creator doctor
# Export a completed Suite as a portable evidence archive
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip
```

`doctor` 应显示 MCP 资产、Agent provider、浏览器和知识目录的检查结果。Codex 用户还可以安装项目级插件入口：

```bash
npx brain-creator plugin install
```

重启 Claude Code 或 Codex 后，直接描述目标，不需要记忆 `bc_*` 工具名：

```text
用 Brain Creator 分析这个需求文档，生成可追踪的测试设计和测试数据，等我确认后再执行：<文件路径或链接>
```

Brain Creator 首次应返回需求摘要、来源引用、待澄清项、覆盖情况和下一步，而不是直接运行测试。

需求中的图片属于正文内容。Brain Creator 会先登记并下载 Markdown、DOCX、PDF、HTTP 或飞书附件，再把受控本地文件交给 Claude Code/Codex 的多模态能力；结构化结果需由用户确认后才能进入需求知识。只有下载或识别重试确实失败后才创建附件 Gap，不能因为“尚未识别”直接跳过流程图或状态机。来源保真在分析前完成：Markdown/HTML/DOCX 会保留有序文档块、标题层级、表格行、图片引用和稳定来源锚点，不再只依赖纯文本。未指定 provider 时需求分析默认交给 host-agent Harness；对结构化或包含图片的来源显式选择 builtin 只返回预览，不能批准或执行需求。

已确认的流程图和状态机不会只保留为图片摘要：Brain Creator 会生成可追踪的 `WorkflowModel`、`StateMachineModel` 和五维 `RequirementCoverageProfile`，并为每条状态转换生成正向与必要的负向 TestIntent。关键流程附件未确认、流程/状态覆盖缺失或字段用例挤占流程覆盖时，Requirement Eval 会阻止“需求覆盖完整”的结论。可通过 `bc_review target=coverage` 查看模型、来源边和缺失覆盖。
需求分析现在通过四个隔离的 Requirement Host Harness 阶段完成：文档地图、原子条款、业务对象/流程/状态/决策表建模、独立覆盖 Critic。每个阶段都是可恢复的 `BrainTask`，并记录 Producer、Schema Validator、隔离 Critic 和 Adjudicator Eval；输入变化会让旧记录 stale。Host 基线审批还需要绑定当前指纹的 approval receipt，普通 Agent 备注不能代替人工批准。`RequirementAnalysis.skill` 可以增强前两阶段，但不能跳过业务建模、Critic、来源校验和审批。
业务场景现在会生成系统范围的数据计划：计划明确实体依赖、`lookup/create/transition/verify/cleanup` 生命周期、数据就绪状态和来源；已创建或宿主提供的实体会回写到 Testdata Brain，并在后续步骤中通过语义实体引用复用。可通过 `bc_review target=testdata` 查看各场景的数据计划和生命周期证据。完整步骤见[快速开始](docs/getting-started.md)。安装失败时先看[故障排查](docs/troubleshooting.md)。

### 工作方式

```text
需求文件 / 飞书文档 / 网页 / 人工用例
  -> 需求分析与来源追踪
  -> 可审核的知识、TestIntent 和 TestDataProfile
  -> 用户批准需求基线
  -> 绑定并探索真实系统
  -> 证据化 ExecutableCase 与 ExecutionPlan
  -> Generator + Playwright + Healer
  -> Evidence + BugReport 或 Gap
```

核心边界：

- 未批准的需求基线不执行。
- 缺少页面或流程证据时先创建可恢复的 ExplorationTask；探索失败后才创建 Gap。缺少测试数据时进入 `needs-data`，不猜测业务动作或数据。
- 需求预期、系统观察和执行结果分层保存，当前系统行为不能覆盖需求定义。
- 知识按 `knowledgeProjectId` 隔离，运行资产按 `systemId` 隔离。
- 产品不符合预期才是 Bug；自动化、鉴权、环境、网络和测试数据问题归入对应 Gap。

执行过程不再是黑盒。支持 MCP Progress Notification 的宿主会收到阶段/步骤进度；无论宿主是否支持通知，Brain Creator 都会把带序号的事件写入 Run Ledger。`bc_status` 可恢复当前用例、步骤、页面、耗时、等待原因和 `possiblyStalled` 告警。每条用例结束后都会增量更新离线 `suite-report.html`，其中保留验证强度、步骤证据、截图、trace、Bug 和 Gap。Planner、Generator 和 Healer 统一经过 Harness Runtime：任务会记录上下文引用、Provider 等待、执行、结构化 Eval 和最终产物引用；超预算、越权、缺证据或删除断言会在下游写入前阻断。

需要现场旁观时，可以要求 Agent “用 Brain Creator 以可见浏览器执行”，对应 `bc_run browserMode=observe`。Brain Creator 会使用 Playwright headed 模式并保持单 Worker；`bc_status` 和离线报告会记录该模式。CI、Windows 服务会话或没有 `DISPLAY/WAYLAND_DISPLAY` 的 Linux 环境会明确阻止观察模式，不会静默改成无头。默认 `browserMode=headless` 仍适合 CI 和无人值守运行。浏览器窗口仅用于观察，最终可信结论仍来自结构化 Reporter、AssertionContract、截图和 trace。

### 常用任务

| 你要完成的事 | 对 Agent 说 |
|---|---|
| 从需求开始 | `用 Brain Creator 分析这个需求文档，等我确认。` |
| 接入真实系统 | `用 Brain Creator 绑定这个系统并检查鉴权和 System Brain 状态。` |
| 执行人工用例文档 | `用 Brain Creator 预览并执行这个 Excel 测试用例文档，先等我确认。` |
| 继续上次任务 | `用 Brain Creator 恢复上次会话，告诉我当前状态和下一步。` |
| 查看失败 | `用 Brain Creator 复盘最近执行，区分 Bug 和 Gap 并列出证据。` |

Agent 默认使用高阶 Facade 工具。只有调试、审计或兼容旧流程时才需要底层 `bc_*` 工具。完整映射见 [Agent 使用指南](docs/agent-usage.md)。
可信控制面不要求手工修改运行数据：鉴权可通过 Facade 创建、真实浏览器验证和归档；首次系统接入由 OnboardingPlan 将需求基线和受限探索合并为一次审批；同一需求版本和目标系统始终复用同一个 OnboardingPlan，重复请求不会因为预算或历史状态变化而复制计划；需求可按 RequirementSet、TestIntent 子集或模块一次批量编译；编译按需求路径、System Brain、测试数据、步骤来源和最终用例五阶段执行。刷新 System Brain 后可通过 `bc_prepare action=reconcile-system-brain` 查看需求预期与系统观察的语义绑定，行为变化再用 `bc_prepare action=recompile-stale-cases` 增量重编译受影响意图。需要真实写操作或跨角色流转时，底层 ExplorationPlan 继续约束 URL、角色、动作、写次数、时长和清理策略，证据回传会刷新 System Brain 并自动续编。普通调用默认使用 `responseMode=summary`，详细结果通过可分页的 OnboardingPlan、CompileRun 和 ExplorationPlan 复盘。参见 [可信控制面](docs/zh-CN/guides/trusted-control-plane.md)。PR E 增加了业务场景组合与可信门禁：`bc_review target=business-scenario` 查看主流程、分支、状态转换和跨角色场景；绑定系统后用 `bc_prepare action=assess-scenarios` 检查系统绑定、测试数据和预期结果来源。首次强证据观察通过后才可记录 `verified`，连续三次未发生关键变化的强证据通过后才可进入 `trusted`；场景生成成功或单次 Playwright 通过都不会自动晋级。`bc_prepare action=evaluate-mutations` 可评估已记录的 caught/survived/blocked 结果，真实变异生成和历史 Bug 回放仍属于后续能力。
PR G 增加了基于证据的场景可信晋升。完成运行必须具备结构化 Reporter、带来源的断言和步骤、完整的必需覆盖，并且诊断结果为通过。首次强证据运行使用可见浏览器观察；首次无头通过仍停留在 `bound`。需求、System Brain 或测试数据发生变化会重置可信计数。离线报告现在会说明理解了什么、观察到什么、使用了什么数据，并区分“运行成功”和“需求符合性结论”。
L3 评估必须在 `EvaluationTrial` 中进行。通过 `bc_prepare action=start-evaluation-trial` 冻结需求来源版本、内容 hash、代码 revision、运行时版本和独立 Store 路径；受控 Facade 写入后使用 checkpoint 更新 `ProjectionManifest`。需求、代码或仓库投影发生未登记变化时，Trial 会失效而不是继续产出看似可比的数据。`bc_status` 展示活动/失效 Trial 数量，`bc_review target=evaluation-trial` 展示来源快照、投影链和人工干预。这样可避免把不同输入、不同代码或手工改 Store 的结果当成同一组 A/B Eval。
PR N 增加脱敏 L3 黄金评估：覆盖 HR、订单审批、图片状态机、跨角色、多需求和 20 轮 Runner 样本。运行 `npm run verify:l3-eval` 可查看已测量维度，`npm run verify:l3-eval:strict` 才是发布门禁；报告会明确把真实系统回归、历史 Bug 回放和生产级长周期证据标为“尚未测量”，合成样本通过不等于 L3 已完成。
### 安装模式

- **业务项目安装（推荐）**：`npm install --save-dev brain-creator`，再运行 `brain-creator init`。
- **Codex 插件**：安装 npm 包后运行 `brain-creator plugin install`。
- **源码开发**：克隆本仓库，运行 `npm install`、`npm test` 和 `npm run build`。
- **全局 CLI**：可运行 `npm install -g brain-creator`，但项目本地安装更容易固定版本。

CLI 只保留少量主命令：`init`、`doctor`、`config`、`plugin`、`export`、`artifacts`、`runner` 和 `mcp`。使用 `brain-creator config` 查看脱敏配置；使用 `brain-creator runner run --owner ci --json` 执行已批准且到期的稳定性套件；旧版独立命令仍兼容，可用 `brain-creator help legacy` 查看。

默认运行数据使用 `.brain-creator/store/` 下的 schema 21 分片仓库。schema 20、schema 19 和旧的 `.brain-creator/local-assets.json` 会先备份再迁移；迁移不会把历史用例自动标记为 `verified` 或 `trusted`。schema 21 新增隔离评估 Trial、来源快照、投影清单和干预记录。`BRAIN_CREATOR_STORE_DIR` 可指定分片仓库位置。

新生成的 source、analysis、cases、specs、tests、evidence 和 report 统一归档到 `.brain-creator/artifacts/<system>/<requirement>-v<revision>/<suite-run>/`。历史根目录产物先 dry-run，再显式确认迁移；迁移会生成旧路径索引并支持回滚。清理同样默认只预览，活动运行和 `latest.json` 指向的运行不会被删除：

```bash
npx brain-creator artifacts migrate
npx brain-creator artifacts migrate --confirm
npx brain-creator artifacts rollback --migration <migration-id> --confirm
npx brain-creator artifacts retention --older-than-days 90
npx brain-creator artifacts retention --older-than-days 90 --confirm
```
### 文档

- [文档站](https://zhuyanlong0091-prog.github.io/brain-creator/zh-CN/)：可搜索的完整中文文档。
- [仓库文档首页](docs/README.md)：按目标选择下一篇文档。
- [快速开始](docs/getting-started.md)：安装、诊断并完成第一次需求分析。
- [核心概念](docs/core-concepts.md)：Requirement Brain、System Brain、Case Compiler、Gap 与 Bridge。
- [从需求到测试](docs/guides/requirement-to-test.md)：完整审批与执行工作流。
- [测试用例脑与测试数据脑](docs/guides/testcase-testdata-brain.md)：跨用例实体依赖、数据生命周期和断言契约。
- [可信控制面](docs/zh-CN/guides/trusted-control-plane.md)：鉴权验证、批量编译、页面绑定、Gap 生命周期与摘要响应。
- [CLI 参考](docs/cli-reference.md)：命令、参数和示例。
- [MCP 安装](docs/mcp-installation.md)：Claude、Codex、host-agent 和连接配置。
- [故障排查](docs/troubleshooting.md)：按症状定位 provider、浏览器、鉴权和连接器问题。

## English

### Get started in five minutes

**Prerequisites**

- Node.js 20 or later
- Claude Code or Codex
- A writable business project directory

Install and initialize Brain Creator in the project you want to test:

```bash
npm install --save-dev brain-creator
npx brain-creator init --provider host-agent
npx brain-creator doctor
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip
```

`doctor` should report the installed MCP assets, Agent provider, browser, and knowledge directory. Codex users can also install the project plugin entrypoint:

```bash
npx brain-creator plugin install
```

Restart Claude Code or Codex, then describe the goal. You do not need to remember any `bc_*` tool names:

```text
Use Brain Creator to analyze this requirement document, generate traceable test design and data, and wait for my approval: <path or URL>
```

The first response should contain a requirement summary, source references, open questions, coverage, and a recommended next step. It should not execute tests before approval.

Images are requirement content. Brain Creator discovers and downloads Markdown, DOCX, PDF, HTTP, and Feishu attachments, then hands controlled local files to the Claude Code or Codex multimodal host. Structured output remains draft until the user confirms it. An attachment Gap is created only after download or recognition retries actually fail, never merely because an image has not been analyzed yet. Source fidelity is preserved before analysis: Markdown, HTML, and DOCX sources expose ordered document blocks with heading levels, table rows, image references, and stable source anchors. When no provider is specified, requirement analysis uses the host-agent Harness; explicitly selecting the builtin parser for a structured or visual source returns a preview-only result and cannot approve or execute the requirement.

Confirmed flowcharts and state machines are not left as image summaries. Brain Creator materializes traceable `WorkflowModel`, `StateMachineModel`, and five-dimension `RequirementCoverageProfile` assets, then generates positive and required negative TestIntents for state transitions. Requirement Eval blocks any claim of complete coverage while critical process evidence is unconfirmed or workflow/state coverage is missing. Review the models, source edges, and missing coverage with `bc_review target=coverage`.
Requirement analysis now runs through four isolated Requirement Host Harness stages: document mapping, atomic clause analysis, business object/workflow/state/decision modeling, and an independent coverage Critic. Every stage is a resumable `BrainTask` with Producer, Schema Validator, isolated Critic, and Adjudicator records; changed inputs stale old records. Host baselines require an approval receipt bound to the current fingerprint, so an Agent-written note cannot impersonate human approval. `RequirementAnalysis.skill` may enhance the first stages, but it cannot bypass modeling, Critic review, source validation, or approval.
Continue with the [Quickstart](docs/getting-started.md), or go directly to [Troubleshooting](docs/troubleshooting.md) if setup fails.

### How it works

```text
Requirement / Feishu / Web page / Existing test cases
  -> source-traceable requirement analysis
  -> reviewable knowledge, TestIntent, and TestDataProfile
  -> approved requirement baseline
  -> bound and explored real system
  -> evidence-backed ExecutableCase and ExecutionPlan
  -> Generator + Playwright + Healer
  -> Evidence + BugReport or Gap
```

Brain Creator enforces these boundaries:

- An unapproved requirement baseline cannot run.
- Missing page or workflow evidence creates a resumable ExplorationTask before any Gap. Missing test data enters `needs-data`; Brain Creator does not guess actions or values.
- Requirement expectations, system observations, and execution results remain separate.
- Knowledge is isolated by `knowledgeProjectId`; runtime assets are isolated by `systemId`.
- Only a verified product mismatch becomes a Bug. Automation, auth, environment, network, and test-data failures become typed Gaps.

Execution is observable rather than opaque. Hosts that support MCP Progress Notification receive stage or step updates. The ordered Run Ledger remains the durable source of truth for every host, and `bc_status` restores the current case, step, page, elapsed time, wait reason, and `possiblyStalled` warning. Brain Creator rewrites the offline `suite-report.html` after each completed case with assurance, step evidence, screenshots, traces, Bugs, and Gaps.

When an operator wants to watch the live interaction, ask the Agent to run Brain Creator with a visible browser, which maps to `bc_run browserMode=observe`. Brain Creator uses Playwright headed mode with one worker and records the mode in `bc_status` and the offline report. CI, Windows service sessions, and Linux sessions without `DISPLAY/WAYLAND_DISPLAY` are rejected explicitly instead of silently falling back to headless. `browserMode=headless` remains the default for CI and unattended runs. The visible window is an observation aid; structured Reporter output, AssertionContracts, screenshots, and traces remain the execution evidence.

### Common tasks

| Goal | Ask the Agent |
|---|---|
| Start from a requirement | `Use Brain Creator to analyze this requirement and wait for my approval.` |
| Connect a real system | `Use Brain Creator to bind this system and check auth and System Brain readiness.` |
| Run an existing case document | `Use Brain Creator to preview this Excel test document and wait for confirmation before running it.` |
| Resume previous work | `Use Brain Creator to resume the previous session and show the next action.` |
| Review a failure | `Use Brain Creator to review the latest run, classify Bugs and Gaps, and show evidence.` |

The Agent uses high-level Facade tools by default. Low-level `bc_*` tools are for compatibility, audit, and debugging. See the [Agent usage guide](docs/agent-usage.md) for the mapping.
The trusted control plane removes manual runtime-store edits: auth can be created, browser-verified, and archived through the Facade; first-system onboarding combines Requirement baseline approval and bounded exploration in one OnboardingPlan approval. A given requirement version and target system always reuse one OnboardingPlan, so changing a budget or retrying a terminal plan does not create a duplicate; approved intents can be batch compiled by requirement, explicit IDs, or module. After a System Brain refresh, `bc_prepare action=reconcile-system-brain` exposes the auditable mapping between expected semantics and observed behavior, while `bc_prepare action=recompile-stale-cases` incrementally rebuilds only affected intents after a reviewed behavioral change. Real writes and role transitions remain constrained by the linked ExplorationPlan's URL, role, action, write, time, data, and cleanup policies. Submitted evidence refreshes System Brain and resumes compilation. Normal calls use `responseMode=summary`, with paged OnboardingPlan, CompileRun, and ExplorationPlan review available. See [Trusted control plane](docs/guides/trusted-control-plane.md). PR E adds a domain-neutral BusinessScenario portfolio and assurance gate: review scenario families with `bc_review target=business-scenario`, then run `bc_prepare action=assess-scenarios` after binding a system to check unique system evidence, test-data readiness, and requirement-backed oracles. Only one unchanged strong observed run can promote a scenario to `verified`; three unchanged strong runs are required for `trusted`. Scenario generation and a single green Playwright run never promote trust automatically. `bc_prepare action=evaluate-mutations` evaluates recorded caught/survived/blocked outcomes; mutation generation and historical Bug replay remain follow-up work.
PR G adds evidence-driven scenario trust. A completed run must be backed by a structured Reporter, source-backed assertions and steps, complete required coverage, and a passing diagnosis. The first strong run is observed in a visible browser; a first headless pass remains bound. Requirement, System Brain, or data changes reset the trust counter. Offline reports now explain what was understood, observed, and used, and distinguish execution success from a requirement conformance claim.
L3 evaluations run inside an `EvaluationTrial`. Start one with `bc_prepare action=start-evaluation-trial` to freeze the requirement revision and hash, code revision, runtime versions, and an isolated Store path. Controlled Facade writes advance a `ProjectionManifest` checkpoint. Unregistered source, code, or repository-projection drift invalidates the Trial instead of producing falsely comparable metrics. `bc_status` summarizes active and invalidated Trials; `bc_review target=evaluation-trial` exposes the frozen source, projection chain, and interventions. Business scenarios now carry a system-scoped data plan. It records entity dependencies, the `lookup/create/transition/verify/cleanup` lifecycle, readiness, and source references; created or host-provided entities are written back to Testdata Brain and reused through semantic entity references. Use `bc_review target=testdata` to inspect scenario plans and lifecycle evidence.
PR N adds a sanitized L3 golden evaluation covering HR, order approval, image state machines, cross-role journeys, multi-requirement reconciliation, and a 20-iteration Runner sample. Run `npm run verify:l3-eval` to inspect measured dimensions; `npm run verify:l3-eval:strict` is the release gate. The report explicitly marks real-system regression, historical Bug replay, and production long-run evidence as not measured; passing synthetic samples is not a claim that L3 is complete.
### Installation modes
- **Business project (recommended):** install `brain-creator` as a development dependency and run `brain-creator init`.
- **Codex plugin:** run `brain-creator plugin install` after installing the npm package.
- **Source checkout:** clone this repository, then run `npm install`, `npm test`, and `npm run build`.
- **Global CLI:** `npm install -g brain-creator` is supported, but a project-local install pins the version.
The consolidated CLI exposes `init`, `doctor`, `config`, `plugin`, `export`, `artifacts`, `runner`, and `mcp`. Use `brain-creator runner run --owner ci --json` to claim and continue due, approved stability suites. Compatibility executables remain available under `brain-creator help legacy`.

Runtime state is stored by default in the schema 21 sharded repository under `.brain-creator/store/`. Schema 20, schema 19, and legacy `.brain-creator/local-assets.json` stores are backed up before migration; legacy cases are not automatically marked `verified` or `trusted`. Schema 21 adds isolated evaluation Trials, source snapshots, projection manifests, and intervention records. Set `BRAIN_CREATOR_STORE_DIR` to choose another shard directory.

New source, analysis, case, spec, test, evidence, and report files are owned by `.brain-creator/artifacts/<system>/<requirement>-v<revision>/<suite-run>/`. Historical root artifacts are dry-run before explicit migration, receive a legacy path index, and can be rolled back. Retention is also preview-only by default and never selects active or latest runs:

```bash
npx brain-creator artifacts migrate
npx brain-creator artifacts migrate --confirm
npx brain-creator artifacts rollback --migration <migration-id> --confirm
npx brain-creator artifacts retention --older-than-days 90
npx brain-creator artifacts retention --older-than-days 90 --confirm
```

Runtime Bridge, connector, and built-in OAuth/CAS/SAML Provider Registry settings can be reloaded without restarting MCP via `bc_configure target=runtime operation=update|reload-config`. `.brain-creator/config/runtime.json` stores only commands, timeouts, and `env:`/`file:` references; environment variables have priority, active runs block reload, and failed preflight preserves the previous configuration. `bc_status` shows Bridge and connector readiness.

### Documentation

- [Searchable documentation site](https://zhuyanlong0091-prog.github.io/brain-creator/)
- [Repository documentation home](docs/README.md)
- [Testcase and Testdata Brain](docs/guides/testcase-testdata-brain.md)
- [Quickstart](docs/getting-started.md)
- [Core concepts](docs/core-concepts.md)
- [Requirement-to-test guide](docs/guides/requirement-to-test.md)
- [Trusted control plane](docs/guides/trusted-control-plane.md)
- [CLI reference](docs/cli-reference.md)
- [MCP installation](docs/mcp-installation.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing and release checks

```bash
npm test
npm run build
npm run verify:requirement-eval
npm run verify:package-contents
npm run verify:package-install
npm run release:check
```

See the [release checklist](docs/release-checklist.md) for publish gates. Brain Creator is released under the [MIT license](LICENSE).
