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

需求中的图片属于正文内容。Brain Creator 会先登记并下载 Markdown、DOCX、PDF、HTTP 或飞书附件，再把受控本地文件交给 Claude Code/Codex 的多模态能力；结构化结果需由用户确认后才能进入需求知识。只有下载或识别重试确实失败后才创建附件 Gap，不能因为“尚未识别”直接跳过流程图或状态机。

已确认的流程图和状态机不会只保留为图片摘要：Brain Creator 会生成可追踪的 `WorkflowModel`、`StateMachineModel` 和五维 `RequirementCoverageProfile`，并为每条状态转换生成正向与必要的负向 TestIntent。关键流程附件未确认、流程/状态覆盖缺失或字段用例挤占流程覆盖时，Requirement Eval 会阻止“需求覆盖完整”的结论。可通过 `bc_review target=coverage` 查看模型、来源边和缺失覆盖。

完整步骤见[快速开始](docs/getting-started.md)。安装失败时先看[故障排查](docs/troubleshooting.md)。

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

可信控制面不要求手工修改运行数据：鉴权可通过 Facade 创建、真实浏览器验证和归档；需求可按 RequirementSet、TestIntent 子集或模块一次批量编译；编译按需求路径、System Brain、测试数据、步骤来源和最终用例五阶段执行；页面或动作证据不足时先进入可恢复探索。需要真实写操作或跨角色流转时，Agent 先生成受 URL、角色、动作、写次数、时长和清理策略约束的 ExplorationPlan，用户一次批准整套方案后才执行，证据回传会刷新 System Brain 并自动续编。普通调用默认使用 `responseMode=summary`，详细结果通过可分页的 CompileRun 和 ExplorationPlan 复盘。参见 [可信控制面](docs/zh-CN/guides/trusted-control-plane.md)。

### 安装模式

- **业务项目安装（推荐）**：`npm install --save-dev brain-creator`，再运行 `brain-creator init`。
- **Codex 插件**：安装 npm 包后运行 `brain-creator plugin install`。
- **源码开发**：克隆本仓库，运行 `npm install`、`npm test` 和 `npm run build`。
- **全局 CLI**：可运行 `npm install -g brain-creator`，但项目本地安装更容易固定版本。

CLI 只保留少量主命令：`init`、`doctor`、`config`、`plugin`、`export`、`artifacts` 和 `mcp`。使用 `brain-creator config` 查看脱敏配置；旧版独立命令仍兼容，可用 `brain-creator help legacy` 查看。

默认运行数据使用 `.brain-creator/store/` 下的 schema 19 分片仓库。首次启动会检测旧的 `.brain-creator/local-assets.json`，创建时间戳备份后迁移；`BRAIN_CREATOR_STORE_DIR` 可指定分片仓库位置。

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

Images are requirement content. Brain Creator discovers and downloads Markdown, DOCX, PDF, HTTP, and Feishu attachments, then hands controlled local files to the Claude Code or Codex multimodal host. Structured output remains draft until the user confirms it. An attachment Gap is created only after download or recognition retries actually fail, never merely because an image has not been analyzed yet.

Confirmed flowcharts and state machines are not left as image summaries. Brain Creator materializes traceable `WorkflowModel`, `StateMachineModel`, and five-dimension `RequirementCoverageProfile` assets, then generates positive and required negative TestIntents for state transitions. Requirement Eval blocks any claim of complete coverage while critical process evidence is unconfirmed or workflow/state coverage is missing. Review the models, source edges, and missing coverage with `bc_review target=coverage`.

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

The trusted control plane removes manual runtime-store edits: auth can be created, browser-verified, and archived through the Facade; approved intents can be batch compiled by requirement, explicit IDs, or module; compilation records requirement-path, System Brain, test-data, provenance, and final-case stages. When evidence requires real writes or role transitions, the Agent creates an ExplorationPlan bounded by URL, role, action, write, time, and cleanup policies. One user approval authorizes only that plan; submitted evidence refreshes System Brain and resumes compilation. Normal calls use `responseMode=summary`, with paged CompileRun and ExplorationPlan review available. See [Trusted control plane](docs/guides/trusted-control-plane.md).

### Installation modes

- **Business project (recommended):** install `brain-creator` as a development dependency and run `brain-creator init`.
- **Codex plugin:** run `brain-creator plugin install` after installing the npm package.
- **Source checkout:** clone this repository, then run `npm install`, `npm test`, and `npm run build`.
- **Global CLI:** `npm install -g brain-creator` is supported, but a project-local install pins the version.

The consolidated CLI exposes `init`, `doctor`, `config`, `plugin`, `export`, `artifacts`, and `mcp`. Compatibility executables remain available under `brain-creator help legacy`.

Runtime state is stored by default in the schema 19 sharded repository under `.brain-creator/store/`. On first startup Brain Creator detects `.brain-creator/local-assets.json`, creates a timestamped backup, and migrates it. Set `BRAIN_CREATOR_STORE_DIR` to choose another shard directory.

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
