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

来源包含图片时，生成测试设计前必须使用返回的 `requirementSourceId` 调用 `bc_prepare action=analyze-attachments`。Brain Creator 先把附件下载到受控本地路径；返回 `needs-host-vision` 时，宿主使用多模态能力读取每个 `recognitionRequests[].localPath`，再通过 `submit-attachment-analysis` 提交符合 schema 的结构化结果。结果保持 draft，展示给用户并明确确认后，才能调用 `confirm-attachment-analysis confirm=true`。仅发现附件不是失败，只有已记录的下载或识别重试耗尽后才能创建 Gap。

确认后再次执行 `generate-test-design`。设计指纹包含已确认的附件分析，旧草稿会重建为包含 WorkflowModel/StateMachineModel 条款、状态正负向用例、Actor Journey 和五维覆盖的版本。存在 blocked 的 `unconfirmed-attachment` 或 `missing-process-coverage` 时不得批准基线。

### 3. 分析与测试设计

`bc_prepare action=generate-test-design` 返回模块、角色、字段、规则、流程、状态、权限、集成、来源引用、置信度、风险、TestIntent、TestDataProfile 和 Gap。

内置策略不依赖外部 Skill。宿主存在 `RequirementAnalysis.skill` 或 `TestCaseDesign.skill` 时可增强分析，但仍必须经过 Brain Creator schema、Eval、来源追踪和审批。

### 4. 批准基线

每个 Requirement Eval action 都必须展示给用户。澄清项与缺失分支需要 `confirmationNote`；直接矛盾必须修订来源。门禁通过后才允许 `approve-baseline confirm=true`。

### 5. 绑定并探索 System Brain

Agent 创建/选择系统与绑定关系，配置鉴权，再调用 `explore-system`。探索仅访问 allowlist 内 HTTP(S) 链接，并受页面数、深度和时间预算限制。

`interactionMode` 默认 `off`。只有用户需要 Tab、折叠或原生下拉状态证据时才使用 `safe`，且不提交表单。复杂菜单、数据录入和业务流由宿主 Agent 补充页面或训练证据。

### 6. 编译用例

`compile-cases` 必须带 `systemId`。Brain Creator 按需求路径、System Brain、测试数据、步骤来源和最终用例五阶段编译，只在唯一最短导航路径和唯一状态转换证据存在时补全隐含动作，并保存 `pathPlan` 与 `statePlan`。

候选相同、目标不可达或定位证据缺失时，状态为 `ambiguous` 或 `needs-exploration`，并创建可恢复的 `ExplorationTask`，不会立即创建 Gap。System Brain 补充证据后，先预览再确认 `bc_prepare action=resolve-exploration-task`，编译器会自动续编。只有探索明确失败时才创建 `system-brain-exploration` Gap。

如果证据需要真实写操作或角色流转，不能借用 `interactionMode=safe`。应为待处理任务创建 `ExplorationPlan`，向用户展示角色、路由、动作、数据策略、写次数/时长和清理策略，整套方案批准后再调用 `approve-exploration-plan confirm=true`。`start-exploration-plan` 若返回测试数据任务，应先完成数据准备，再由宿主 Agent 执行受限工作包。通过 `submit-exploration-result` 回传逐动作证据后，Brain Creator 会校验授权范围、刷新 System Brain 并自动续编。使用 `bc_review target=exploration-plan` 复盘；未启动方案被拒绝时应取消。

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

正常 Facade 调用使用 `responseMode=summary`，只有审计特定资产时使用 `full`。需求用例优先通过 `requirementSetId`、`testIntentIds` 或模块一次批量编译，并通过 `bc_review target=compile-run` 分页查看详情。页面歧义必须先进入探索；只有用户真实选择了候选页面时才调用 `confirm-page-binding`。探索结论和 Gap 生命周期操作都必须先预览，再携带证据确认。鉴权验证必须访问真实页面，不能只修改状态字段。

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

## 产物归属与维护

Planner、Generator、Reporter 和 Suite 产物统一归属到 `.brain-creator/artifacts/<系统>/<需求>-v<版本>/<Suite 运行>/`。不要要求宿主 Agent 把新文件写入根目录 `specs/` 或 `tests/generated/`。

存在历史文件时，先运行 `brain-creator artifacts migrate` 并向用户展示可确定归属和 unresolved 数量，获得明确确认后才应用。回滚和 retention 同样需要显式确认；清理不会选择活动运行或 `latest.json` 指向的运行。使用 `brain-creator export --suite <id>` 导出文档 Suite 或 Requirement Suite 的完整脱敏归档。

```text
用 Brain Creator 恢复上次会话，告诉我当前阻塞和下一步。
```

## 执行可见性

`bc_run` 默认使用 `observationMode=summary`，每次操作返回一条有界进度；用户明确要求逐步观察时使用 `observationMode=step-by-step`。宿主提供 MCP progress token 时，Brain Creator 会发送尽力而为的 Progress Notification；宿主不支持通知或连接中断时，带序号的 Run Ledger 仍是权威恢复来源。

`bc_status` 会显示当前用例、步骤、页面、耗时、最后更新时间、等待原因和 `possiblyStalled`。卡住告警只表示超过更新时间阈值，不会把用例自动判为失败。每条用例结束后，Brain Creator 都会增量更新运行目录中的离线 `suite-report.html`，无需等到整个 Suite 终态。

`observationMode` 只控制进度消息粒度，不会打开浏览器窗口。用户明确要求旁观时，预览和确认执行都传入 `browserMode=observe`。运行中的 Suite 不允许切换模式；Host Agent 续跑、Healer 重试、文档套件续跑和 Bug 回归都会继承已选模式。观察模式必须运行在交互式桌面会话中；CI、Windows 服务会话或缺少 `DISPLAY/WAYLAND_DISPLAY` 的 Linux 会返回可操作的能力阻断，不会静默降级。可见窗口只能辅助判断执行轨迹，最终结论仍以 Reporter、断言、截图和 trace 为准。

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
