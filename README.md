# Brain Creator

Brain Creator is a requirement-driven, agent-native testing brain for Claude Code and Codex. Give it a requirement document or link; it turns the source into traceable knowledge, reviewable test intent, test data, executable Playwright cases, evidence, BugReports, and Gaps.

Brain Creator has **No Web UI**. The conversation in Claude Code or Codex is the user interface; a Skill and MCP server provide the testing workflow behind it.

[中文](#中文) | [English](#english) | [Documentation](docs/README.md) | [npm](https://www.npmjs.com/package/brain-creator)

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
- 缺少页面、流程或数据证据时创建 Gap，不猜测业务动作。
- 需求预期、系统观察和执行结果分层保存，当前系统行为不能覆盖需求定义。
- 知识按 `knowledgeProjectId` 隔离，运行资产按 `systemId` 隔离。
- 产品不符合预期才是 Bug；自动化、鉴权、环境、网络和测试数据问题归入对应 Gap。

### 常用任务

| 你要完成的事 | 对 Agent 说 |
|---|---|
| 从需求开始 | `用 Brain Creator 分析这个需求文档，等我确认。` |
| 接入真实系统 | `用 Brain Creator 绑定这个系统并检查鉴权和 System Brain 状态。` |
| 执行人工用例文档 | `用 Brain Creator 预览并执行这个 Excel 测试用例文档，先等我确认。` |
| 继续上次任务 | `用 Brain Creator 恢复上次会话，告诉我当前状态和下一步。` |
| 查看失败 | `用 Brain Creator 复盘最近执行，区分 Bug 和 Gap 并列出证据。` |

Agent 默认使用高阶 Facade 工具。只有调试、审计或兼容旧流程时才需要底层 `bc_*` 工具。完整映射见 [Agent 使用指南](docs/agent-usage.md)。

### 安装模式

- **业务项目安装（推荐）**：`npm install --save-dev brain-creator`，再运行 `brain-creator init`。
- **Codex 插件**：安装 npm 包后运行 `brain-creator plugin install`。
- **源码开发**：克隆本仓库，运行 `npm install`、`npm test` 和 `npm run build`。
- **全局 CLI**：可运行 `npm install -g brain-creator`，但项目本地安装更容易固定版本。

CLI 只保留少量主命令：`init`、`doctor`、`config`、`plugin` 和 `mcp`。使用 `brain-creator config` 查看脱敏配置；旧版独立命令仍兼容，可用 `brain-creator help legacy` 查看。

### 文档

- [文档首页](docs/README.md)：按目标选择下一篇文档。
- [快速开始](docs/getting-started.md)：安装、诊断并完成第一次需求分析。
- [核心概念](docs/core-concepts.md)：Requirement Brain、System Brain、Case Compiler、Gap 与 Bridge。
- [从需求到测试](docs/guides/requirement-to-test.md)：完整审批与执行工作流。
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
- Missing page, workflow, or data evidence creates a Gap instead of a guessed action.
- Requirement expectations, system observations, and execution results remain separate.
- Knowledge is isolated by `knowledgeProjectId`; runtime assets are isolated by `systemId`.
- Only a verified product mismatch becomes a Bug. Automation, auth, environment, network, and test-data failures become typed Gaps.

### Common tasks

| Goal | Ask the Agent |
|---|---|
| Start from a requirement | `Use Brain Creator to analyze this requirement and wait for my approval.` |
| Connect a real system | `Use Brain Creator to bind this system and check auth and System Brain readiness.` |
| Run an existing case document | `Use Brain Creator to preview this Excel test document and wait for confirmation before running it.` |
| Resume previous work | `Use Brain Creator to resume the previous session and show the next action.` |
| Review a failure | `Use Brain Creator to review the latest run, classify Bugs and Gaps, and show evidence.` |

The Agent uses high-level Facade tools by default. Low-level `bc_*` tools are for compatibility, audit, and debugging. See the [Agent usage guide](docs/agent-usage.md) for the mapping.

### Installation modes

- **Business project (recommended):** install `brain-creator` as a development dependency and run `brain-creator init`.
- **Codex plugin:** run `brain-creator plugin install` after installing the npm package.
- **Source checkout:** clone this repository, then run `npm install`, `npm test`, and `npm run build`.
- **Global CLI:** `npm install -g brain-creator` is supported, but a project-local install pins the version.

The consolidated CLI exposes `init`, `doctor`, `config`, `plugin`, and `mcp`. Compatibility executables remain available under `brain-creator help legacy`.

### Documentation

- [Documentation home](docs/README.md)
- [Quickstart](docs/getting-started.md)
- [Core concepts](docs/core-concepts.md)
- [Requirement-to-test guide](docs/guides/requirement-to-test.md)
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
