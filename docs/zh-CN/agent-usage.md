# Brain Creator Agent 使用指南

用户只需在 Claude Code 或 Codex 中描述测试目标；Agent 选择 Facade MCP 工具，并保持审批边界可见。

## 推荐第一条请求

```text
用 Brain Creator 分析这个需求文档，生成可追踪的测试设计和测试数据，并等待我批准。
```

推荐路径从需求开始。只有维护已有系统或执行现成人工用例文档时，才直接从系统或文档套件开始。

## 需求优先流程

### 1. 建立知识上下文

Agent 通过 `bc_configure target=knowledge-project` 创建知识项目，此时不要求真实系统。

### 2. 导入需求

`bc_prepare action=ingest-requirement` 支持 Markdown、TXT、DOCX、PDF、HTTP(S)、Obsidian 和飞书。

飞书优先使用 OpenAPI；没有凭据时，宿主 Agent 读取文档并提交标准 `RequirementContentPackage`。

### 3. 分析与测试设计

`bc_prepare action=generate-test-design` 返回模块、角色、字段、规则、流程、状态、权限、集成、来源引用、置信度、风险、TestIntent、TestDataProfile 和 Gap。

内置策略不依赖外部 Skill。宿主存在 `RequirementAnalysis.skill` 或 `TestCaseDesign.skill` 时可增强分析，但仍必须经过 Brain Creator schema、Eval、来源追踪和审批。

### 4. 批准基线

每个 Requirement Eval action 都必须展示给用户。澄清项与缺失分支需要 `confirmationNote`；直接矛盾必须修订来源。门禁通过后才允许 `approve-baseline confirm=true`。

### 5. 绑定并探索 System Brain

Agent 创建/选择系统与绑定关系，配置鉴权，再调用 `explore-system`。探索仅访问 allowlist 内 HTTP(S) 链接，并受页面数、深度和时间预算限制。

`interactionMode` 默认 `off`。只有用户需要 Tab、折叠或原生下拉状态证据时才使用 `safe`，且不提交表单。复杂菜单、数据录入和业务流由宿主 Agent 补充页面或训练证据。

### 6. 编译用例

`compile-cases` 必须带 `systemId`。Brain Creator 只在唯一最短导航路径和唯一状态转换证据存在时补全隐含动作，并保存 `pathPlan` 与 `statePlan`。候选相同、目标不可达或定位证据缺失时创建 Gap。

### 7. 规划测试数据

编译结果包含当前 TestIntent 的 `testDataPlan`。默认复用已有数据；创建数据需要用户显式设置 `allowCreateTestData=true`，并配置 `delete-created` 或 `restore`。

宿主 Agent 查询或创建数据后，通过 `submit-test-data` 提交稳定引用、非敏感值和 `sourceRefs`。失败会创建数据 Gap，不得填入任意值绕过。

### 8. 准备执行

Agent 先以 `confirm=false` 预览 `prepare-execution`，展示需求、系统、鉴权、路径、状态、数据、Gap 和清理检查。用户确认后才生成不可变 ExecutionPlan。

blocked 或 needs-confirmation 草稿只用于诊断，不能进入 Generator。secret 不进入 ExecutionPlan。

### 9. 预览与执行

Requirement Suite 先以 `confirm=false` 预览，用户批准后再 `confirm=true`。只有一条用例可以处于数据准备、Agent 执行或清理状态。

业务差异记录 Bug 并继续；数据、清理和其他技术失败创建 Gap 并默认停止。重复确认返回当前任务，不创建重复任务。

### 10. 复盘证据

使用 `bc_review` 查看需求、知识、覆盖、System Brain、ExecutionPlan、步骤证据、Bug、Gap 和运行账本。需求预期与系统观察始终分层展示。

## 可信控制面约定

正常 Facade 调用使用 `responseMode=summary`，只有审计特定资产时使用 `full`。需求用例优先通过 `requirementSetId`、`testIntentIds` 或模块一次批量编译，并通过 `bc_review target=compile-run` 分页查看详情。页面歧义必须由用户确认后调用 `confirm-page-binding`；Gap 的解决、忽略和重开必须先预览，再携带人工说明与证据引用确认。鉴权验证必须访问真实页面，不能只修改状态字段。

## 用户入口映射

| 用户意图 | 默认 Facade 动作 |
|---|---|
| 预览模糊表达 | `bc_intent_preview` |
| 查看当前状态 | `bc_status`，优先展示 `statusMarkdown` |
| 创建或绑定系统 | `bc_configure target=system` |
| 配置鉴权 | `bc_configure target=auth` |
| 等待人工登录 | `bc_configure target=checkpoint` |
| 预览人工用例文档 | `bc_run mode=case-source-suite confirm=false` |
| 执行已确认文档 | `bc_run mode=case-source-suite confirm=true` |
| 回归 open Bug | `bc_run mode=bug-regression` |
| 查看 Bug | `bc_review target="bug"`，优先展示 `reviewMarkdown` |
| 查看 Gap | `bc_review target="gap"`，优先展示 `reviewMarkdown` |
| 记录外部阻塞 | `bc_report_gap` |
| 显示快捷帮助 | `/bc help` |

Facade 请求被拒绝或取消后，不得使用底层同义工具重试。

## 已有测试用例文档

对于 `.xlsx` 或可执行 `.md`：

1. `bc_run mode=case-source-suite confirm=false` 只预览来源。
2. Agent 展示数量、模块、优先级、样例、bridge 状态和风险。
3. 用户一次确认。
4. `confirm=true` 按来源顺序执行。
5. `bc_review` 返回 SuiteRun、ChainRun、BugReport、Gap 和证据路径。

除非用户显式要求并确认，否则不回写 Excel。

## Host-Agent 执行

Codex 插件默认使用 `host-agent`。出现 `needs_agent_execution` 时：

1. 读取 `input.prompt.md` 与 `input.context.json`。
2. 只创建指定 Planner、Generator 或 Healer 输出。
3. 调用 `bc_submit_agent_output`。
4. 如果返回下一任务则继续。
5. 到达 `completed`、`failed` 或 `blocked` 后停止。

`waiting-for-agent` 不是 bridge 缺失。

## 恢复新会话

对于已有系统，`bc_session_resume` 或 `bc_status` 会一次返回系统、鉴权、checkpoint、规则、术语、用例、最近运行、产物、开放 Gap、bridge preflight 和推荐动作，避免 6 到 7 次独立查询。

```text
用 Brain Creator 恢复上次会话，告诉我当前阻塞和下一步。
```

## 套件控制

- 取消：先预览 `suiteAction=cancel`，再显式确认。保留已完成结果和数据清理义务。
- 重试：只允许 failed/blocked 用例，旧计划和证据进入 attempts 历史。
- 跳过：只允许 blocked 用例，存在待清理创建数据时禁止跳过。

所有控制都必须先预览再确认。

## 失败诊断

终态失败先进入 ExecutionDiagnosis。只有证据支持 `product_bug` 时创建 BugReport；自动化、定位、数据、鉴权、环境、网络、执行和未知结果保持为 Gap。

历史 Bug/Gap 的诊断迁移必须逐条预览、获取人工说明再确认，不允许批量改变资产。错误迁移可通过独立 rollback 流程撤销。

## 安全要求

- 不在需求、计划、测试、Gap 或报告中暴露 secret。
- 不执行未批准需求基线。
- 不跨系统或知识项目混用资产。
- 不用系统观察覆盖需求预期。
- 不伪造定位器、测试结果或证据路径。
- 不为 Agent 原生产品建设业务操作 Web UI；文档站仅用于说明和检索。

## 验证命令

```bash
npm test
npm run build
npm run docs:build
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run verify:host-agent-chain
npm run verify:host-agent-document-suite
```
