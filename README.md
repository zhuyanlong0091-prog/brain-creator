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
  -> 绑定真实系统 + System Brain
  -> 证据化 ExecutableCase
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
- 需求会拆成带 `#clause-N` 来源锚点的原子条款，每条条款分别生成可追踪的 TestIntent，不再用一条宽泛用例覆盖整篇文档。
- Requirement Eval 会输出条款覆盖率、无依据内容、直接矛盾、缺失条件分支和所需人工动作；需要确认的动作跨会话持久化，确认说明会回流为知识节点，直接矛盾必须修订需求源。
- 内置 7 个 HR、订单、库存、商业规则和权限控制黄金样本，覆盖普通条款、复杂 Markdown 表格、跨模块流程、权限矩阵、矛盾和缺失分支；通过 `npm run verify:requirement-eval` 固定覆盖率、来源追踪和逐条 TestIntent 基线。
- Requirement Eval 历史统计会基于 ExecutionEvidence、BugReport 和技术失败计算需求结论验证率、系统符合率与追溯率；产品缺陷不会被误算为需求分析错误，技术阻塞保持不确定。
- 需求 hash 幂等、版本修订、影响节点、受影响回归范围和旧版本追溯。
- TestIntent、TestDataProfile、ExecutableCase、隐含唯一动作补全与歧义 Gap。
- Test Data Planner 只选取当前 TestIntent 的数据配置，生成依赖顺序、候选值、查找/复用/创建决策、secret 引用和清理策略；重复字段、缺失依赖和循环依赖会阻塞，不能通过填写任意值绕过。
- Test Data Provider 将既有数据查找、显式授权创建和执行后清理封装为幂等 Host Agent 任务；`TestDataLease` 保存引用、证据和清理状态，准备失败与清理失败分别创建 Gap。
- Execution Preflight 将需求基线、系统、鉴权、导航、状态动作、数据租约、Gap 和清理状态编译为不可变 `ExecutionPlan`；只有 ready 快照才能进入 Generator，ExecutionEvidence 会绑定对应计划。
- 多系统绑定、鉴权、AuthCheckpoint、Claude/Codex/host-agent Bridge。
- System Brain 将 PageModel、LocatorPoint、ProbeResult、SystemExploration、TrainingSession、ActionStep 和 ApiFlow 聚合为按系统隔离的页面、状态转换、流程、级联行为和 API 证据；重复刷新幂等，需求预期与系统观察冲突单独保留。
- 用例编译会在 System Brain 导航图上计算入口到目标页面的最短证据路径；只有唯一最短路径才会补全为 `origin=observed` 的导航步骤，同长多路径或目标不可达会阻塞并创建 Gap。
- 状态动作编译完全由 `SystemBrainStateTransition` 驱动：通用匹配目标控件、动作、输入值和前后状态差异，并保存 `statePlan`。它不包含招聘、订单等业务特判；文档中的业务场景只作为编排验证样例。
- 指定 `systemId` 编译 ExecutableCase 时，步骤会绑定真实 PageModel/LocatorPoint/ProbeResult 证据；缺少页面或定位证据时阻塞并创建 Gap。
- Generator、真实 Playwright、有限 Healer、Suite、BugReport、Gap 和证据复盘。
- 旧版 `.xlsx` / `.md` 测试用例文档的预览、确认、执行、续跑、回归和可选 Excel 回写。

### 业务项目安装步骤

#### MCP CLI connection mode（推荐）

在需要测试的业务项目中安装：

```bash
npm install --save-dev brain-creator
npx brain-creator --version
npx brain-creator --help
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
| 确认 Requirement Eval 动作 | `bc_prepare action=confirm-eval-actions confirm=true`，必须提交 `confirmationNote` |
| 审批需求基线 | `bc_prepare action=approve-baseline` |
| 创建/绑定系统 | `bc_configure target=system` / `bc_configure target=system-binding` |
| 自动探索真实系统 | `bc_prepare action=explore-system`；默认只访问 allowlist 内链接，显式设置 `interactionMode=safe` 才探测受限安全交互 |
| 提交页面/训练证据 | 宿主 Agent 浏览真实系统后使用 `bc_prepare action=record-page-evidence` / `record-training-evidence` |
| 刷新系统知识 | `bc_prepare action=refresh-system-brain`，内部聚合页面建模和训练证据 |
| 按系统编译 | `bc_prepare action=compile-cases` 并传入 `systemId` |
| 准备测试数据 | `bc_prepare action=prepare-test-data` 先预览，确认后派发 Host Agent 任务；创建数据必须显式设置 `allowCreate=true` |
| 回传数据证据 | Host Agent 使用 `bc_prepare action=submit-test-data` 回传复用/创建引用与 `sourceRefs`；旧 `resolve-test-data` 仅保留兼容 |
| 执行前检查 | `bc_prepare action=prepare-execution` 预览并确认不可变 ExecutionPlan；可用 `bc_review target=execution-plan` 复盘 |
| 配置鉴权 | `bc_configure target=auth` |
| 等待人工登录 | `bc_configure target=checkpoint` |
| 查看知识或系统状态 | `bc_status`，优先展示 `statusMarkdown` |
| 预览/执行需求套件 | `bc_run mode=requirement-suite` |
| 兼容执行测试文档 | `bc_run mode=case-source-suite confirm=false`，确认后 `bc_run mode=case-source-suite confirm=true` |
| 回归 Bug | `bc_run mode=bug-regression` |
| 查看 Bug/Gap/证据 | `bc_review target="bug"`、`bc_review target="gap"`，优先展示 `reviewMarkdown` |
| 复核历史执行诊断 | 先用 `bc_review target=execution-diagnosis` 查看候选，再用 `bc_prepare action=review-legacy-diagnosis confirm=false` 预览，用户确认后以相同参数和 `confirmationNote` 传 `confirm=true` |
| 回滚历史诊断迁移 | 使用 `bc_prepare action=rollback-legacy-diagnosis` 和 `diagnosisReviewId` 先预览，再携带人工 `confirmationNote` 确认；只撤销该次迁移创建的诊断和 Gap |
| 查看需求质量历史 | `bc_review target=requirement-eval-accuracy` |
| 查看系统知识 | `bc_review target=system-brain` 并传入 `systemId` |
| 查看系统探索记录 | `bc_review target=system-exploration` |
| 记录外部阻塞 | `bc_report_gap` |
| 快捷帮助 | `/bc help`（可选） |

Facade 工具被拒绝或取消后，Agent 不得改用底层同义工具绕过授权。

`bc_status` 的 `readiness` 分为 `ready`、`action-required` 和 `blocked`。存在未完成 Suite、待执行 AgentTask、开放 Bug 或 Gap 时返回 `action-required`；Bridge 或人工鉴权检查点不可用时返回 `blocked`。Suite 状态会分别展示已通过、已失败、已阻塞、等待 Agent 和未开始的用例，并让 `nextCaseNo` 优先指向真实等待执行的任务。

需求知识项目存在待确认 Eval action 时，`bc_status.nextAction` 返回 `confirm_requirement_eval`；存在不可确认的矛盾时返回 `revise_blocked_requirement`。

执行失败只有在证据支持“系统行为不符合预期”时才创建 BugReport。生成脚本语法、解析、索引、定位器或缺少元素证据等自动化实现问题会创建 Gap，并可在复盘时按 `automation_failure` 或 `locator_failure` 过滤。

### 需求准备与审批

1. 创建 `KnowledgeProject`。
2. 用 `bc_prepare` 导入需求来源。
3. 将需求拆成原子条款，为每条条款生成来源可追踪的知识节点、TestIntent 和 TestDataProfile。
4. 展示条款覆盖率、无依据内容、风险、矛盾、缺失条件分支、Gap 和测试数据。
5. 展示每个 Eval action；可澄清项和缺失分支使用 `confirm-eval-actions` 保存用户说明，直接矛盾必须修订需求源，不能通过确认绕过。
6. 所有 Eval action 通过门禁后，用户再次明确确认并审批 baseline。
7. 创建并绑定 SystemProfile，配置鉴权；优先调用 `bc_prepare action=explore-system` 自动发现 allowlist 内页面、交互元素和导航关系。需要观察 Tab、展开控件或原生下拉的级联变化时，可由用户显式批准 `interactionMode=safe`；更复杂菜单和业务流程仍由宿主 Agent 补充页面/训练证据。
8. 指定 `systemId` 编译 ExecutableCase；系统保存可审计的 `pathPlan`，只补全唯一最短且有页面、导航边和定位证据的动作。同长多路径、目标页不明确或不可达时创建 Gap。
9. 检查 `testDataPlan`。可继续用 `prepare-test-data` 单独预览和准备；在 Requirement Suite 中，确认后会按用例自动派发数据准备任务。默认只允许复用，只有用户明确授权并传入 `allowCreateTestData=true` 时才能创建数据。
10. Host Agent 在当前系统中查询或创建数据，并通过 `submit-test-data` 回传稳定引用、非敏感值和 `sourceRefs`。创建数据必须配置 `delete-created` 或 `restore`；重复调用会复用当前待办，不会重复造数。
11. 每条用例的数据就绪后才冻结 ExecutionPlan 并启动 Generator。测试结束后，复用数据自动释放；创建数据必须先完成清理任务，Suite 才能进入下一条或结束。
12. `bc_run mode=requirement-suite confirm=false` 返回全量预检。确认时所有非数据阻塞必须先通过；可解析的数据缺口由 Suite 接管。`RequirementSuiteRun` 一次只允许一条用例处于数据准备、Agent 执行或清理状态。
13. 业务失败记录 Bug 后继续；数据、清理和其他技术失败创建 Gap 并默认停止。显式恢复会重试当前数据阶段，而不是跳过或重复执行已经完成的业务步骤。
14. 用 `bc_review target=requirement-suite-run`、`execution-plan` 和其他 review 入口查看进度、计划、证据、Bug、Gap、Requirement Eval 历史准确率和需求/观察冲突。

Requirement Suite 支持经确认的执行控制，且不新增用户必须记忆的工具：

- 取消：先预览 `bc_run mode=requirement-suite suiteAction=cancel confirm=false`，确认后设为 `confirm=true`。挂起的 Agent/TestData 任务会取消，已完成结果保留；已创建数据的清理义务不会消失。
- 重试：使用 `suiteAction=retry` 和目标 `executableCaseId`。仅允许重试 failed/blocked 用例，旧 ExecutionPlan、证据、Bug、Gap 会进入 `attempts` 历史；passed 用例不可重试。
- 跳过：使用 `suiteAction=skip` 和目标 `executableCaseId`。仅允许显式跳过 blocked 用例；存在待清理的创建数据时拒绝跳过。
- 三种控制都必须先 `confirm=false` 预览，再由用户批准 `confirm=true`。`bc_status` 与 `bc_review target=requirement-suite-run` 返回 passed/failed/blocked/skipped/cancelled 计数和尝试历史。

Requirement Suite 和 Excel/Markdown Document Suite 都会写入持久化 RunLedger。它按时间记录 Suite 创建、用例开始、Agent 等待、执行结果和 Suite 结束；Requirement Suite 还记录数据准备/清理、ExecutionPlan、重试、跳过和取消。`bc_status` 返回当前运行摘要和最近事件；`bc_review target=run-ledger` 可分别用 `knowledgeProjectId` 或 `systemId` 按 Suite ID 复盘完整时间线。Ledger 只记录已经发生的事实，不替代各 Suite 的控制状态。

终态失败会先进入 `ExecutionDiagnosis` 门禁。它结合失败类型、Healer 已尝试次数和证据引用，把结果归类为产品 Bug、自动化、测试数据、鉴权、环境、网络、执行或未知 Gap；只有受控重试结束后仍存在明确预期/实际差异时才创建 BugReport。`bc_status` 返回有界诊断摘要，`bc_review target=execution-diagnosis` 可查看标准化原因、重试预算和证据 ID。诊断资产不保存原始 stderr、prompt 或密钥。

该门禁同时覆盖 Requirement Suite、Excel/Markdown Document Suite 和 Bug 回归。文档用例诊断会关联来源、Suite、用例编号和 Bug；回归只有再次确认 `product_bug` 才写为 `retest-failed`，自动化、数据、鉴权、环境或网络阻塞会保留 Bug 原状态。没有 KnowledgeProject 时也可按 `systemId` 使用 `bc_status` 和 `bc_review target=execution-diagnosis` 查看分流统计。

对门禁上线前产生的 Bug/Gap，`bc_status.executionDiagnoses.legacyAudit` 只返回候选数量摘要，`bc_review target=execution-diagnosis` 返回最多 100 条标准化复核候选。该审计是只读建议：不会关闭 Bug、创建或解决 Gap，也不会复制历史原始错误文本。Agent 必须展示候选并取得明确确认后，未来的迁移流程才可改动资产。

历史候选通过 `bc_prepare action=review-legacy-diagnosis` 逐条处理。`confirm=false` 只返回变更预览；`confirm=true` 必须携带人工复核说明。确认 Bug 或 Gap 只补诊断关联且不改变原状态；确认技术 Bug 转 Gap 时会关闭该 Bug、创建标准化 Gap，并保存 `ExecutionDiagnosisReview`、原状态、诊断 ID 和新 Gap ID。`needs_evidence` 只保存人工标签，不迁移资产。重复、跨系统或与候选建议不匹配的确认会被拒绝。

如果审计建议本身错误，使用 `diagnosisDecision=override_classification`，并同时提供一致的 `correctedFailureType` 与 `correctedVerdict`。Brain Creator 会同时保留算法原判和人工正确结论。`humanAdjudicationEval` 会展示观察准确率与样本数，但默认至少 20 条有效人工裁决后才给出 `reportableAccuracy`；`needs_evidence` 和已回滚复核不进入分母。可用 `minSampleSize` 调整审计门槛，并通过 `npm run verify:historical-diagnosis-eval` 对当前本地仓库执行只读验证。历史 Gap 因缺少完整用例上下文，不能直接纠正为产品 Bug。

误确认的迁移可通过 `bc_prepare action=rollback-legacy-diagnosis` 逐条回滚。`confirm=false` 只返回影响预览；`confirm=true` 必须提交新的人工说明。回滚会恢复 Bug 原状态，删除且仅删除该次迁移创建的 Gap 和诊断，并把 Review 保留为 `rolled-back` 审计记录；随后源资产会重新进入历史审计候选。

系统自动探索默认最多访问 5 页、2 层链接、运行 60 秒；可调整但硬上限为 25 页、4 层、300 秒。`interactionMode` 默认为 `off`，此时不点击控件。显式设置 `safe` 后，每页默认最多探测 3 个、硬上限 10 个 Tab、展开控件或原生下拉，并记录前后状态、可见字段、弹窗、URL、截图与被拦截请求。危险名称、无稳定 selector、提交类控件、非 GET/HEAD/OPTIONS 请求和危险 URL 会被跳过或拦截；该模式不会提交表单，也不能证明设计错误的 GET 接口绝无副作用。复杂菜单、需要输入的数据流程和真实业务提交仍应通过宿主 Agent 的 `record-page-evidence` / `record-training-evidence` 补充。

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
  requirements/<requirement-set-id>/{source.md,analysis.md,evaluation-confirmations.md}
  modules/<dynamic-module>/{analysis.md,rules.md,flows.md,data.md,cases.md}
  systems/<system-id>/{brain.md,expected.md,observed.md,conflicts.md}
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
npm run verify:requirement-eval
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
npx brain-creator --version
npx brain-creator --help
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
| Confirm Requirement Eval actions | `bc_prepare action=confirm-eval-actions confirm=true` with a resolution note |
| Approve the requirement baseline | `bc_prepare action=approve-baseline` |
| Create and bind a real system | `bc_configure target=system`, then `bc_configure target=system-binding` |
| Explore a real system | `bc_prepare action=explore-system`; link-only by default, with opt-in `interactionMode=safe` for bounded safe probes |
| Submit page/training evidence | `bc_prepare action=record-page-evidence` / `record-training-evidence` after host browser exploration |
| Refresh system knowledge | `bc_prepare action=refresh-system-brain` |
| Compile against real evidence | `bc_prepare action=compile-cases` with `systemId` |
| Prepare test data | Preview and confirm `bc_prepare action=prepare-test-data`; creation additionally requires explicit `allowCreate=true` |
| Submit data evidence | `bc_prepare action=submit-test-data` with a stable reference and `sourceRefs`; legacy `resolve-test-data` remains compatible |
| Prepare execution | Preview and confirm `bc_prepare action=prepare-execution`; review immutable snapshots with `bc_review target=execution-plan` |
| Configure auth | `bc_configure target=auth` |
| Wait for protected login | `bc_configure target=checkpoint` |
| Preview and run approved requirement cases | `bc_run mode=requirement-suite` |
| Run an existing case document | `bc_run mode=case-source-suite confirm=false`, then `bc_run mode=case-source-suite confirm=true` |
| Regress bugs | `bc_run mode=bug-regression` |
| Review bugs and Gaps | `bc_review target="bug"`, `bc_review target="gap"` |
| Review a legacy execution diagnosis | Inspect candidates with `bc_review target=execution-diagnosis`, preview `bc_prepare action=review-legacy-diagnosis confirm=false`, then repeat with `confirm=true` and `confirmationNote` only after explicit user approval |
| Roll back a diagnosis migration | Preview `bc_prepare action=rollback-legacy-diagnosis` with `diagnosisReviewId`, then confirm with a human `confirmationNote`; only artifacts created by that migration are removed |
| Review Requirement Eval history | `bc_review target=requirement-eval-accuracy` |
| Review System Brain | `bc_review target=system-brain` with `systemId` |
| Review exploration runs | `bc_review target=system-exploration` |
| Record an external blocker | `bc_report_gap` |
| Show shortcuts | `/bc help` |

Prefer `statusMarkdown` and `reviewMarkdown` for user-facing summaries.

`bc_status.readiness` is `ready`, `action-required`, or `blocked`. Unfinished suites, pending AgentTasks, open bugs, and open Gaps produce `action-required`; unavailable bridges and manual auth checkpoints produce `blocked`. Suite progress separates passed, failed, blocked, waiting-for-agent, and not-started cases, and `nextCaseNo` prioritizes the active AgentTask.

For knowledge projects, `bc_status.nextAction` returns `confirm_requirement_eval` for pending actions and `revise_blocked_requirement` for non-confirmable contradictions.

Brain Creator creates a BugReport only when evidence supports a business expectation mismatch. Generated test syntax, parser, index, locator, or missing-element evidence failures create Gaps and can be reviewed as `automation_failure` or `locator_failure`.

### Requirement Workflow

1. Create a knowledge project without requiring a runtime system.
2. Ingest a local document, Feishu link, Web page, or Obsidian reference.
3. Split the source into atomic clauses with `#clause-N` evidence anchors, then create typed knowledge and one traceable TestIntent per clause.
4. Review clause coverage, unsupported claims, contradictions, missing branches, risks, Gaps, and TestDataProfiles.
5. Present each Eval action. Confirm clarification and missing-branch actions with a durable resolution note; revise the source for blocked contradictions.
6. After the Eval gate passes, approve the requirement baseline explicitly.
7. Bind a real system and verified auth. Run `bc_prepare action=explore-system` to discover allowlisted pages, controls, and navigation links. Explicitly opt in to `interactionMode=safe` to observe bounded tab, disclosure, and native-select state changes; use host-browser evidence for more complex menus and business workflows.
8. Compile ExecutableCases with `systemId`; missing PageModel or LocatorPoint evidence blocks compilation with a Gap.
9. Inspect `testDataPlan`. Manual `prepare-test-data` preview remains available, while a confirmed Requirement Suite dispatches preparation per case. Reuse is read-only by default; creation requires explicit `allowCreateTestData=true`.
10. The host Agent submits lookup or creation evidence through `submit-test-data`. Created data requires `delete-created` or `restore`, and repeated calls reuse the current task instead of creating duplicate data.
11. Brain Creator freezes each ExecutionPlan only after that case's data is ready. After execution, reused leases are released automatically and created data must finish cleanup before the Suite advances.
12. Requirement Suite confirmation validates all non-data blockers, then creates one ordered `RequirementSuiteRun`. Only one case may prepare data, run an Agent, or clean up at a time.
13. Business failures continue after recording a Bug. Data, cleanup, and other technical failures create Gaps and stop by default. Explicit resume retries the current data phase rather than skipping or repeating completed business steps.
14. Review RequirementSuiteRuns, ExecutionPlans, step evidence, BugReports, Gaps, historical Requirement Eval accuracy, and requirement-versus-observation conflicts.

Requirement Suite controls remain behind the existing `bc_run` facade:

- Cancel: preview with `suiteAction=cancel` and `confirm=false`, then confirm explicitly. Pending Agent/TestData tasks are cancelled and completed results remain. Created-data cleanup obligations remain visible.
- Retry: use `suiteAction=retry` with `executableCaseId`. Only failed or blocked cases can retry. Previous plans, evidence, Bugs, and Gaps are retained in `attempts`; passed cases cannot retry.
- Skip: use `suiteAction=skip` with `executableCaseId`. Only blocked cases can be skipped, and cleanup-due created data prevents skipping.
- Every control requires preview then confirmation. `bc_status` and `bc_review target=requirement-suite-run` expose passed, failed, blocked, skipped, cancelled, and prior-attempt history.

Requirement Suites and Excel/Markdown Document Suites both write a persistent RunLedger. It records Suite creation, case start, Agent waits, case outcomes, and Suite completion; Requirement Suites additionally record data preparation/cleanup, ExecutionPlan freezing, retries, skips, and cancellation. `bc_status` exposes active summaries and recent events. Use `bc_review target=run-ledger` with `knowledgeProjectId` or `systemId` to replay the relevant Suite timeline by ID. The ledger records facts and does not replace either Suite control model.

Terminal failures now pass through an `ExecutionDiagnosis` gate. It combines the normalized failure type, bounded Healer attempt count, and evidence references to classify a product bug or an automation, test-data, auth, environment, network, execution, or unknown Gap. A BugReport is allowed only when an explicit expected/actual mismatch remains after controlled retries. `bc_status` returns a bounded diagnosis summary, and `bc_review target=execution-diagnosis` shows normalized reasons, retry budget, and evidence IDs. Diagnoses never persist raw stderr, prompts, or secrets.

The same gate covers Requirement Suites, Excel/Markdown document suites, and bug regression. Document diagnoses link the source, suite, case number, and BugReport. A regression becomes `retest-failed` only when `product_bug` is confirmed again; automation, data, auth, environment, and network blockers preserve the prior bug status. Without a KnowledgeProject, use `bc_status` and `bc_review target=execution-diagnosis` with `systemId` to inspect routing metrics.

For Bugs and Gaps created before the gate existed, `bc_status.executionDiagnoses.legacyAudit` returns counts only, while `bc_review target=execution-diagnosis` returns at most 100 normalized review candidates. This audit is advisory and read-only: it never closes a Bug, creates or resolves a Gap, or copies raw historical failure text. The Agent must present candidates and obtain explicit confirmation before any future migration may change assets.

Process legacy candidates one at a time with `bc_prepare action=review-legacy-diagnosis`. `confirm=false` is read-only; `confirm=true` requires a human review note. Confirming a Bug or Gap adds diagnosis links without changing its status. Confirming a technical Bug-to-Gap reclassification closes that Bug, creates a normalized Gap, and stores an `ExecutionDiagnosisReview` with the prior status, diagnosis ID, and created Gap ID. `needs_evidence` records only the human label. Repeated, cross-system, or recommendation-mismatched confirmations are rejected.

When the audit recommendation is wrong, use `diagnosisDecision=override_classification` with a consistent `correctedFailureType` and `correctedVerdict`. Brain Creator preserves both the algorithm proposal and the human-adjudicated conclusion. `humanAdjudicationEval` shows observed accuracy and sample size, but withholds `reportableAccuracy` until the default minimum of 20 active adjudications is reached. `needs_evidence` and rolled-back reviews are excluded. Override the audit threshold with `minSampleSize`, and run `npm run verify:historical-diagnosis-eval` for a read-only report against the current local repository. A historical Gap cannot be promoted directly to a product Bug because it lacks complete case evidence.

An incorrect migration can be reversed one item at a time with `bc_prepare action=rollback-legacy-diagnosis`. Preview first, then confirm with a new human note. Rollback restores the prior Bug status, removes only the diagnosis and Gap created by that migration, retains a `rolled-back` review record, and makes the source asset eligible for audit again.

System exploration defaults to 5 pages, depth 2, and 60 seconds, with hard limits of 25 pages, depth 4, and 300 seconds. `interactionMode` defaults to `off`. Opt-in `safe` mode probes at most 3 controls per page by default, with a hard limit of 10, and only considers tabs, disclosure controls, and native selects with stable selectors. It records before/after states and blocks write methods, dangerous URLs, and write-like labels. It never submits forms, but cannot prove that a misdesigned GET endpoint has no side effect. Complex menus, data-entry flows, and business submissions still require supplemental host-Agent page or training evidence.

### Requirement Eval And System Brain

`npm run verify:requirement-eval` evaluates seven cross-domain golden samples, including complex Markdown rule tables, cross-module workflows, and permission matrices. `bc_review target=requirement-eval-accuracy` then estimates historical accuracy from traceable execution: passed evidence and business mismatches linked to BugReports validate the requirement expectation, unclassified semantic failures require review, and blocked or technical failures remain inconclusive.

System Brain is a derived, system-isolated view over PageModel, LocatorPoint, ProbeResult, SystemExploration, TrainingSession, ActionStep, and ApiFlow assets. `explore-system` performs a bounded breadth-first scan using Playwright and can optionally capture safe interaction state transitions. `refresh-system-brain` writes `.brain-creator/knowledge/<project>/systems/<system-id>/brain.md`, including navigation and state graphs, while preserving separate expected, observed, and conflict layers.

During case compilation, Brain Creator finds the shortest evidence-backed route from a graph entry page to the target page. It compiles navigation clicks only when that shortest path is unique, marks them as `origin=observed`, and stores an auditable `pathPlan`. Equally short alternatives, an ambiguous target page, an unreachable target, or an exhausted path-search budget block the case and create a System Brain Gap. `candidatePathCount` preserves the total while at most 10 candidate details are returned to keep Agent context bounded.

State-action compilation is data-driven from `SystemBrainStateTransition`: it matches generic control targets, actions, input values, and before/after effects, then stores an auditable `statePlan`. No product-domain rule is encoded in the planner; recruiting, settings, and other examples are fixtures that validate the same orchestration contract. Equal candidates, missing input values, or missing locator evidence block with a Gap.

Test-data compilation is scoped to the current TestIntent and stored as `dataPlan`. It deterministically orders declared dependencies and supports fixed, generated, unique, existing-reference, runtime-captured, and secret-reference strategies. `prepare-test-data` creates an idempotent, auditable Host Agent task for unresolved references. Requirement Suites now orchestrate that task per case, persist the waiting phase, and resume without duplicate lookup or creation. Reuse is the default; creation requires explicit `allowCreateTestData=true` plus a cleanup policy. `submit-test-data` records evidence-backed `TestDataLease` assets. Terminal execution releases reused leases and blocks Suite advancement until created data is cleaned. Provider and cleanup failures create separate Gaps and explicit resume retries the same phase. Duplicate fields, missing dependencies, and cycles remain structural Gaps, and secret references never become executable step values.

Execution Preflight compiles approved requirement state, the bound system, optional explicit auth, path/state plans, data bindings and leases, open Gaps, cleanup obligations, and the bounded generator ContextPack into a SHA-256-addressed immutable ExecutionPlan. Timestamp-only changes do not create a new snapshot; semantic or retrieved-context changes do. Blocked and needs-confirmation drafts are diagnostic only. Requirement Suite confirmation validates every non-data blocker before side effects, persists an ordered run, and freezes each case plan only after its data lease is ready. Generator, Seed, host-agent continuation, and ExecutionEvidence retain and revalidate that plan, while secrets remain references.

### Feishu

Set both `BRAIN_CREATOR_FEISHU_APP_ID` and `BRAIN_CREATOR_FEISHU_APP_SECRET` for direct OpenAPI reading. Without them, use the host lark connector and submit a normalized content package. Credentials remain environment references only.

Notion and Google Drive are future adapters; Feishu has priority.

### Release Readiness

```bash
npm test
npm run build
npm run verify:requirement-eval
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run release:check
```

The MIT license is declared in [LICENSE](LICENSE). Release details are in [docs/release-checklist.md](docs/release-checklist.md).
