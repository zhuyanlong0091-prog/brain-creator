# Brain Creator

Brain Creator is a requirement-driven, agent-native testing business brain for Claude Code and Codex. It turns requirement documents into traceable knowledge, reviewable test intent, test data, executable cases, Playwright evidence, BugReports, and Gaps.

Brain Creator is released under the MIT license. It has **No Web UI**: the user interface is the conversation with Claude Code or Codex, backed by the Brain Creator Skill and MCP server.

## 中文版

### 产品定位

Brain Creator 是一个“需求驱动的 Agent 原生测试业务脑”。推荐入口不再是先配置系统或直接执行人工用例，而是：

```text
本地需求文档 / 飞书文档 / 网页
  -> 需求分析与来源追踪
  -> 自生长业务知识
  -> TestIntent + TestDataProfile
  -> 用户审核
  -> ExecutableCase
  -> 绑定真实系统
  -> Generator + Playwright + Healer
  -> Evidence + BugReport + Gap
```

核心原则：

- 无 Web UI，Claude Code / Codex 就是用户入口。
- 新业务不需要预定义 HR、CRM、订单等固定业务域。
- 需求预期、系统观察、执行结果分层保存，真实系统当前行为不能覆盖需求定义。
- 未审批不执行；缺证据不猜测；多条可能路径创建 Gap。
- 所有知识按 `knowledgeProjectId` 隔离，运行资产按 `systemId` 隔离。
- Excel/Markdown 人工测试用例仍可执行，但作为兼容入口，不再主导内部模型。

### 已实现能力

- 需求来源：Markdown、TXT、DOCX、PDF、HTTP(S)、Obsidian 引用、飞书 Wiki/Doc。
- 飞书双通道：OpenAPI 直连，或宿主 Agent/lark 读取后提交标准内容包。
- 内置 `RequirementAnalysisPolicy` 与 `TestDesignPolicy`，无需额外安装 Skill。
- 可选复用宿主的 `RequirementAnalysis.skill`、`TestCaseDesign.skill`，但输出仍须经过 schema、Eval、来源追踪和审批。
- 动态知识节点：模块、角色、对象、字段、规则、流程、状态、权限、集成、数据约束、术语和需求。
- 需求 hash 幂等、版本修订、影响节点、受影响回归范围和旧版本追溯。
- TestIntent、TestDataProfile、ExecutableCase、隐含唯一动作补全与歧义 Gap。
- 多系统绑定、鉴权、AuthCheckpoint、Claude/Codex/host-agent Bridge。
- Generator、真实 Playwright、有限 Healer、Suite、BugReport、Gap 和证据复盘。
- 旧版 `.xlsx` / `.md` 测试用例文档的预览、确认、执行、续跑、回归和可选 Excel 回写。

### 业务项目安装步骤

#### MCP CLI connection mode（推荐）

在需要测试的业务项目中安装：

```bash
npm install --save-dev brain-creator
npx brain-creator-install-assets
npx brain-creator-write-mcp-config --provider host-agent
npx brain-creator-doctor
```

Codex 用户还可以安装插件入口：

```bash
npx brain-creator-install-codex-plugin
```

新生成的 `.mcp.json` 默认包含：

```json
{
  "mcpServers": {
    "brain-creator": {
      "command": "npx",
      "args": ["brain-creator-mcp"],
      "env": {
        "BRAIN_CREATOR_WORKSPACE": ".",
        "BRAIN_CREATOR_TOOL_PROFILE": "facade",
        "BRAIN_CREATOR_AGENT_PROVIDER": "host-agent",
        "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

`facade` 只向 Agent 暴露高阶入口，降低工具选择负担。调试或兼容旧流程时可改为：

```text
BRAIN_CREATOR_TOOL_PROFILE=full
```

#### source checkout mode

用于开发 Brain Creator 本身：

```bash
git clone https://github.com/zhuyanlong0091-prog/brain-creator-mvp.git
cd brain-creator-mvp
npm install
npm test
npm run build
npm run dev:mcp
```

#### repo-local plugin installation mode

在源码仓库中安装 Codex 插件：

```bash
codex plugin marketplace add .
codex plugin add brain-creator@personal
codex plugin list
```

### 智能体入口

用户直接用自然语言，不需要记忆 `bc_*`：

```text
用 Brain Creator 分析这个需求文档，生成需求分析、覆盖矩阵、测试数据和测试意图，等我确认。
```

```text
用 Brain Creator 分析这个飞书需求链接，并告诉我有哪些待澄清项。
```

```text
Use Brain Creator to connect this system and bind the approved requirement baseline.
```

```text
用 Brain Creator 执行这个测试用例文档：<path-to-cases.xlsx>
```

`Skill("brain-creator")` 仅作为自动匹配失败时的 fallback，不是正常使用前提。

### 用户入口到 Agent 工具映射

| 用户意图 | Agent 默认入口 |
|---|---|
| 预览模糊操作意图 | `bc_intent_preview` |
| 创建需求知识项目 | `bc_configure target=knowledge-project` |
| 导入/刷新需求 | `bc_prepare action=ingest-requirement` / `refresh-requirement` |
| 生成分析与测试设计 | `bc_prepare action=generate-test-design` |
| 审批与编译 | `bc_prepare action=approve-baseline` / `compile-cases` |
| 创建/绑定系统 | `bc_configure target=system` / `bc_configure target=system-binding` |
| 配置鉴权 | `bc_configure target=auth` |
| 等待人工登录 | `bc_configure target=checkpoint` |
| 查看知识或系统状态 | `bc_status`，优先展示 `statusMarkdown` |
| 预览/执行需求套件 | `bc_run mode=requirement-suite` |
| 兼容执行测试文档 | `bc_run mode=case-source-suite confirm=false`，确认后 `bc_run mode=case-source-suite confirm=true` |
| 回归 Bug | `bc_run mode=bug-regression` |
| 查看 Bug/Gap/证据 | `bc_review target="bug"`、`bc_review target="gap"`，优先展示 `reviewMarkdown` |
| 记录外部阻塞 | `bc_report_gap` |
| 快捷帮助 | `/bc help`（可选） |

Facade 工具被拒绝或取消后，Agent 不得改用底层同义工具绕过授权。

`bc_status` 的 `readiness` 分为 `ready`、`action-required` 和 `blocked`。存在未完成 Suite、待执行 AgentTask、开放 Bug 或 Gap 时返回 `action-required`；Bridge 或人工鉴权检查点不可用时返回 `blocked`。Suite 状态会分别展示已通过、已失败、已阻塞、等待 Agent 和未开始的用例，并让 `nextCaseNo` 优先指向真实等待执行的任务。

执行失败只有在证据支持“系统行为不符合预期”时才创建 BugReport。生成脚本语法、解析、索引、定位器或缺少元素证据等自动化实现问题会创建 Gap，并可在复盘时按 `automation_failure` 或 `locator_failure` 过滤。

### 需求准备与审批

1. 创建 `KnowledgeProject`。
2. 用 `bc_prepare` 导入需求来源。
3. 生成需求分析、知识节点、TestIntent 和 TestDataProfile。
4. 展示风险、待澄清 Gap、覆盖和测试数据。
5. 用户明确确认后审批 baseline。
6. 编译 ExecutableCase；只补全知识中唯一可推导的隐含动作。
7. 创建并绑定 SystemProfile，配置鉴权。
8. `bc_run mode=requirement-suite confirm=false` 预览，用户确认后执行。
9. 用 `bc_review` 查看证据、Bug、Gap 和需求/观察冲突。

### 飞书需求接入

直连模式只通过环境变量引用凭据，Brain Creator 不保存令牌：

```text
BRAIN_CREATOR_FEISHU_APP_ID=<app-id>
BRAIN_CREATOR_FEISHU_APP_SECRET=<app-secret>
```

若未配置直连，宿主 Agent 可使用 lark/飞书能力读取文档，再提交 `RequirementContentPackage`。表格、画板、嵌套表格、无法读取的附件等会创建 Gap，不会静默丢失。

### 知识存储

默认目录：

```text
.brain-creator/knowledge/<project-key>/
  MOC.md
  requirements/<requirement-set-id>/{source.md,analysis.md}
  modules/<dynamic-module>/{analysis.md,rules.md,flows.md,data.md,cases.md}
  systems/<system-id>/{expected.md,observed.md,conflicts.md}
```

可指向外部 Obsidian 目录：

```text
BRAIN_CREATOR_KNOWLEDGE_DIR=F:\YourVault\BrainCreator
```

本地 JSON repository 带 `schemaVersion`，兼容恢复旧资产。`.brain-creator/` 是运行数据，不应提交到 Git 或发布到 npm。

### Bridge 模式

- `host-agent`：当前 Claude Code/Codex Agent 执行 `needs_agent_execution` 任务，再调用 `bc_submit_agent_output`。
- `claude`：通过 Claude subprocess 执行 Planner/Generator/Healer。
- `codex`：通过 Codex subprocess 执行。
- `auto`：检测可用 provider。
- `disabled`：只允许预览与状态查询。

`waiting-for-agent` 是可执行任务，不是“AgentBridge 缺失”。执行前运行 `npx brain-creator-doctor`，可以提前检查 provider、浏览器、知识目录、工具 Profile 和飞书连接器。

### 验证

```bash
npm test
npm run build
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run verify:codex-plugin-install
npm run verify:host-agent-chain
npm run verify:host-agent-document-suite
npm run verify:live-claude-skill-workflow
npm run release:check
```

### 发布前检查

发布前必须确认：测试与 build 通过、npm 包不含 `.brain-creator/`、Skill 三份副本一致、doctor 和安装 smoke 通过。完整清单见 [docs/release-checklist.md](docs/release-checklist.md)。

更多使用说明见 [docs/agent-usage.md](docs/agent-usage.md) 和 [docs/mcp-installation.md](docs/mcp-installation.md)。

## English Version

### Product Direction

Brain Creator starts from requirements. It grows project-specific knowledge, designs tests and data, waits for approval, compiles Agent-executable cases, binds those cases to a real system, and runs an evidence-producing Playwright chain.

It is agent-native and has No Web UI. Claude Code / Codex is the interface.

### Business Project Setup

Recommended MCP CLI connection mode:

```bash
npm install --save-dev brain-creator
npx brain-creator-install-assets
npx brain-creator-write-mcp-config --provider host-agent
npx brain-creator-install-codex-plugin
npx brain-creator-doctor
```

Use `BRAIN_CREATOR_TOOL_PROFILE=facade` for normal Agent use. Set `full` only for compatibility, audit, or debugging.

The source checkout mode is for contributors. The repo-local plugin installation mode registers this repository through `codex plugin marketplace add .` and installs `brain-creator@personal`.

### User Entrypoint To Agent Tool Map

| User request | Default Agent action |
|---|---|
| Preview ambiguous operational wording | `bc_intent_preview` |
| Analyze a requirement document or link | `bc_configure target=knowledge-project`, then `bc_prepare` |
| Review knowledge and coverage | `bc_status` and `bc_review` |
| Approve and compile tests | `bc_prepare action=approve-baseline`, then `compile-cases` |
| Create and bind a real system | `bc_configure target=system`, then `bc_configure target=system-binding` |
| Configure auth | `bc_configure target=auth` |
| Wait for protected login | `bc_configure target=checkpoint` |
| Preview and run approved requirement cases | `bc_run mode=requirement-suite` |
| Run an existing case document | `bc_run mode=case-source-suite confirm=false`, then `bc_run mode=case-source-suite confirm=true` |
| Regress bugs | `bc_run mode=bug-regression` |
| Review bugs and Gaps | `bc_review target="bug"`, `bc_review target="gap"` |
| Record an external blocker | `bc_report_gap` |
| Show shortcuts | `/bc help` |

Prefer `statusMarkdown` and `reviewMarkdown` for user-facing summaries.

`bc_status.readiness` is `ready`, `action-required`, or `blocked`. Unfinished suites, pending AgentTasks, open bugs, and open Gaps produce `action-required`; unavailable bridges and manual auth checkpoints produce `blocked`. Suite progress separates passed, failed, blocked, waiting-for-agent, and not-started cases, and `nextCaseNo` prioritizes the active AgentTask.

Brain Creator creates a BugReport only when evidence supports a business expectation mismatch. Generated test syntax, parser, index, locator, or missing-element evidence failures create Gaps and can be reviewed as `automation_failure` or `locator_failure`.

### Requirement Workflow

1. Create a knowledge project without requiring a runtime system.
2. Ingest a local document, Feishu link, Web page, or Obsidian reference.
3. Run builtin requirement analysis and test design, or normalize optional host Skill output.
4. Review source traceability, coverage, risks, Gaps, TestIntents, and TestDataProfiles.
5. Approve explicitly and compile ExecutableCases.
6. Bind a real system and verified auth.
7. Preview and confirm `requirement-suite` execution.
8. Review step evidence, BugReports, Gaps, and requirement-versus-observation conflicts.

### Feishu

Set both `BRAIN_CREATOR_FEISHU_APP_ID` and `BRAIN_CREATOR_FEISHU_APP_SECRET` for direct OpenAPI reading. Without them, use the host lark connector and submit a normalized content package. Credentials remain environment references only.

Notion and Google Drive are future adapters; Feishu has priority.

### Release Readiness

```bash
npm test
npm run build
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run release:check
```

The MIT license is declared in [LICENSE](LICENSE). Release details are in [docs/release-checklist.md](docs/release-checklist.md).
