# Brain Creator

Brain Creator 是面向 **Claude Code / Codex** 的 Agent 原生测试业务脑：它不是 Web UI，而是一套本地业务逻辑库 + MCP 工具集，让智能体能接入业务系统、理解业务语言、生成可审核的测试计划、调用 Playwright 测试生成与修复链路，并沉淀可复用测试资产。

Brain Creator is an agent-native testing brain for **Claude Code / Codex**. It is not a Web UI; it is a local business-logic library plus MCP toolset that helps an agent connect business systems, understand business language, generate reviewed test plans, run Playwright test generation and healing, and track reusable testing assets.

## 中文版

### 核心定位

**无 Web UI：** Brain Creator v2 的产品入口是 Claude Code / Codex 里的智能体对话。Claude Code 中请从 `Skill("brain-creator")` 开始；Codex 中请直接要求执行 Brain Creator 工作流，让智能体使用已配置的 MCP 工具。

### 你可以做什么

- 接入多个业务系统，并隔离每个系统的鉴权、术语、规则、用例、产物和 Gap。
- 配置 token、cookie、password 或 script 鉴权，并避免后续回复重复暴露密钥。
- 添加业务术语和业务规则，让生成的测试贴合系统语义。
- 先生成草稿测试计划，用自然语言审核后，再批准进入代码生成。
- 执行 planner -> generator -> healer 链路，并查看生成的 Markdown spec 与 Playwright 测试文件。
- 当证据缺失或生成链路无法安全修复时，查看并处理 Gap，而不是让智能体伪造成功。

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

本地运行真实 Planner / Generator / Healer 时，需要配置 Claude 子进程桥接：

```bash
BRAIN_CREATOR_AGENT_COMMAND=claude
BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

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
- `npx brain-creator-write-mcp-config`：创建或更新当前业务项目的 `.mcp.json`，默认写入 `npx brain-creator-mcp`，因此适配本地安装。
- `npx brain-creator-doctor`：在真正使用前检查 workspace、Claude bridge 和 agent 定义。

如果你偏好全局安装，也可以执行：

```bash
npm install -g brain-creator
brain-creator-install-assets
brain-creator-write-mcp-config --global
brain-creator-doctor
```

之后重启或重载 Claude Code / Codex 的 MCP 连接，在业务项目中输入：

```text
Use Skill("brain-creator"). 接入这个业务系统，生成测试计划，先等我审批，再执行链路。
```

本地包安装验证：

```bash
npm run verify:package-install
```

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

### Codex `/plugin` 本地发布

仓库已提供 repo-local Codex 插件：

- `plugins/brain-creator/.codex-plugin/plugin.json`：插件展示、starter prompt 和能力描述。
- `plugins/brain-creator/.mcp.json`：通过 `npx brain-creator-mcp` 注册 MCP server。
- `plugins/brain-creator/skills/`：随插件提供 Brain Creator skill。
- `.agents/plugins/marketplace.json`：将 `brain-creator` 作为本地 marketplace 插件暴露给 Codex。

验证插件：

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
```

插件安装后仍要求业务项目安装 npm 包。项目本地安装时使用 `npx brain-creator-*` 命令；全局安装时可以直接使用 `brain-creator-*` 命令。

### 智能体入口

在 Claude Code 或 Codex 中使用一句话请求：

```text
Use Skill("brain-creator"). Connect the local order system, add a rule that order total must be visible, generate a test plan, wait for my approval, then run the chain.
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

**No Web UI:** the Brain Creator v2 product entrypoint is the agent conversation in Claude Code / Codex. In Claude Code, start with `Skill("brain-creator")`; in Codex, ask for the Brain Creator workflow and let the agent use the configured MCP tools.

### What You Can Do

- Connect multiple business systems with isolated auth, glossary, rules, cases, artifacts, and gaps.
- Configure token, cookie, password, or script auth without echoing secrets back into later responses.
- Add business terms and rules so generated tests match the system's domain language.
- Generate a draft test plan first, review it in natural language, then approve it before code generation.
- Run the planner -> generator -> healer chain and inspect generated Markdown specs and Playwright tests.
- Review gaps when evidence is missing or a generated chain cannot be repaired safely.

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

### Codex `/plugin` Local Publish

The repository now includes a repo-local Codex plugin:

- `plugins/brain-creator/.codex-plugin/plugin.json`: plugin metadata, starter prompts, and capability text.
- `plugins/brain-creator/.mcp.json`: registers the MCP server through `npx brain-creator-mcp`.
- `plugins/brain-creator/skills/`: ships the Brain Creator skill with the plugin.
- `.agents/plugins/marketplace.json`: exposes `brain-creator` as a local marketplace plugin for Codex.

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
- `npx brain-creator-doctor`: checks workspace, Claude bridge, and agent definitions before the first workflow.

For a global install instead:

```bash
npm install -g brain-creator
brain-creator-install-assets
brain-creator-write-mcp-config --global
brain-creator-doctor
```

Then restart or reload the Claude Code / Codex MCP connection and say:

```text
Use Skill("brain-creator"). Connect this business system, generate a test plan, wait for my approval, then run the chain.
```

Start the Brain Creator MCP server:

```bash
npm run mcp
```

Configure the Claude subprocess bridge when running real Planner / Generator / Healer flows locally:

```bash
BRAIN_CREATOR_AGENT_COMMAND=claude
BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

On Windows PowerShell, set the same values with `$env:` before launching the MCP client.

### Agent Entry

Use a one-sentence request in Claude Code or Codex:

```text
Use Skill("brain-creator"). Connect the local order system, add a rule that order total must be visible, generate a test plan, wait for my approval, then run the chain.
```

The agent should load the Brain Creator skill, select the matching MCP tools, create or reuse a business system, configure auth if needed, generate a draft plan, ask for approval, run `bc_run_chain`, and summarize artifacts and gaps.

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

`npm run verify:live-claude-skill-workflow` verifies the real Claude Code session entrypoint: `Skill("brain-creator")` is loaded, Brain Creator MCP tools are selected, `bc_run_chain` succeeds, and artifacts are summarized.

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
- The Playwright CLI currently supplies Claude agent definitions; Brain Creator calls them through a Claude subprocess bridge.
- PostgreSQL, CI live-smoke execution, LLM quality review, and parallel agent execution are future enhancements.
