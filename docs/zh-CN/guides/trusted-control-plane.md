# 可信控制面

所有运行状态变更都应通过 Brain Creator Facade 完成。不要通过修改 `.brain-creator/store/`、`.brain-creator/local-assets.json`、生成测试或已安装 npm 包来绕过工作流。

## 控制 Agent 返回体大小

Facade 工具支持 `responseMode`：

- `summary`：只返回状态、人类可读摘要、下一步动作和有界资产引用。
- `full`：保留原有完整结果，用于兼容和审计。

Brain Creator Skill 默认使用 `summary`。只有查看特定资产或诊断流程时才请求 `full`。

## 验证鉴权

先生成受保护的浏览器状态，再通过 Facade 验证：

```json
{
  "target": "auth",
  "operation": "verify",
  "systemId": "system_xxx",
  "authProfileId": "auth_xxx",
  "responseMode": "summary"
}
```

验证会使用新的浏览器上下文访问系统基础 URL。只修改状态字段不能作为鉴权证据。浏览器状态缺失、过期、跳回登录页或浏览器不可用时，返回稳定错误码和可执行的下一步动作。

使用 `operation=archive` 归档 AuthProfile。使用 `operation=create` 或省略 `operation` 保持原有创建流程。

## 一次编译整个需求

编译某个需求版本下的全部已审批 TestIntent：

```json
{
  "action": "compile-cases",
  "requirementSetId": "requirementSet_xxx",
  "systemId": "system_xxx",
  "modules": ["订单"],
  "responseMode": "summary"
}
```

可通过 `testIntentIds` 指定子集；原有单条 `testIntentId` 继续兼容。

每次批量编译都会生成 `CompileRun`，统计 `ready`、`needsExploration`、`needsData`、`blocked`、`ambiguous`、`skipped` 和 `reused`。幂等键由 TestIntent、系统、需求 hash 和当前 System Brain 证据组成。输入未变化时复用已有用例；证据变化时生成新用例，并将旧用例标记为 `superseded`。

刷新 System Brain 后，使用 `bc_prepare action=reconcile-system-brain` 将已批准需求语义与选定系统的观察证据进行对账，再通过 `bc_review target=semantic-binding` 查看绑定结果。别名、多步骤展开和条件映射都保留为可审计候选；冲突和未观察到的内容不会被静默确认。行为 ChangeSet 将意图或用例标记为 stale 后，先确认新快照，再用 `bc_prepare action=recompile-stale-cases` 只重编译受影响的意图。

使用以下调用分页查看详情：

```json
{
  "target": "compile-run",
  "knowledgeProjectId": "knowledgeProject_xxx",
  "id": "compileRun_xxx",
  "limit": 25,
  "offset": 0
}
```

## 确认歧义页面

存在多个候选页面时，Agent 必须向用户展示候选项并获得明确选择，再记录绑定：

```json
{
  "action": "confirm-page-binding",
  "testIntentId": "testIntent_xxx",
  "systemId": "system_xxx",
  "pageModelId": "page_xxx",
  "role": "buyer",
  "confirmationNote": "已根据批准的订单流程确认。",
  "confirm": true
}
```

该记录是当前 TestIntent 和系统范围内的证据，不是写死在代码中的业务规则。

## 解决编译探索任务

System Brain 证据缺失或歧义时会创建 `ExplorationTask`，它不是最终 Gap。通过 CompileRun 或 `bc_status` 查看任务，补充页面、导航、状态或定位证据，然后先预览再确认结果：

```json
{
  "action": "resolve-exploration-task",
  "explorationTaskId": "explorationTask_xxx",
  "explorationOutcome": "resolved",
  "evidenceRefs": ["page-model:page_xxx", "locator-point:locator_xxx"],
  "confirm": true
}
```

解决成功后自动重新编译对应 TestIntent。标记失败时必须提供原因，并创建 `system-brain-exploration` Gap；取消只记录决定，不伪造阻塞。

## 授权状态化探索

首次接入系统时，应在 Requirement Eval 通过、系统已绑定且所有角色鉴权已验证后，调用 `bc_prepare action=create-onboarding-plan`。Brain Creator 会根据已确认的流程、状态机、决策表和 TestIntent 生成具体探索问题，并在 OnboardingPlan 内创建受限的 ExplorationPlan。

先预览 `approve-onboarding-plan`，向用户展示需求摘要、未解决问题、覆盖矩阵、角色、路由、写操作、时长和清理策略，再携带 `confirm=true`、`confirmedBy` 和 `confirmationNote` 确认。默认 `approvalStage=exploration` 只授权受限证据探索，不代表需求已经具备执行条件。探索完成并刷新覆盖矩阵后，使用 `approvalStage=execution` 进入严格门禁：所有覆盖项必须为 `covered`，所有允许动作必须同时绑定需求来源和系统证据，且不能有未解决问题。同一个需求版本和目标系统只允许存在一个 OnboardingPlan；重复创建会返回原计划，草案刷新会递增 revision 并保留历史。使用 `start-onboarding-plan` 启动探索；通过 `bc_status` 和 `bc_review target=onboarding-plan` 可恢复当前计划。原有分别批准基线和 ExplorationPlan 的流程继续兼容后续补充探索。

只读探索无法发现仅在新建、提交、审批、驳回或关闭后出现的控件。后续出现证据缺口时，从一个或多个待处理 ExplorationTask 创建 `ExplorationPlan`，明确鉴权角色、允许路由、授权动作、写次数、时长和清理策略。

依次调用 `bc_prepare action=create-exploration-plan`、预览 `approve-exploration-plan`，再携带人工说明和确认人一次批准。Brain Creator 会拒绝生产环境、未验证或跨系统角色、allowlist 外 URL、危险动作和超预算结果。`start-exploration-plan` 返回受限的宿主 Agent 工作包；测试数据未就绪时先返回 `needs-data`。

浏览器操作完成后，通过 `submit-exploration-result` 回传逐动作来源，以及 PageModel、SystemExploration 或 TrainingSession 证据。清理策略为 `delete` 或 `close` 时，创建的数据必须先释放；否则方案 blocked 并创建高优先级 Gap。成功回传会刷新 System Brain、解决关联 ExplorationTask，并自动续编。使用 `bc_review target=exploration-plan` 复盘；用户拒绝写操作时使用 `cancel-exploration-plan`。

## 安全处理 Gap

使用 `resolve-gap`、`dismiss-gap` 或 `reopen-gap`。先以 `confirm=false` 预览，再使用 `confirm=true`、非空 `confirmationNote` 和 `evidenceRefs` 确认。

- `resolve-gap`：证据表明缺失前提已经满足。
- `dismiss-gap`：用户明确接受该事项不在范围内。
- `reopen-gap`：新证据使已解决或已忽略的 Gap 再次需要处理。

每次转换都会追加到 Gap 生命周期，不会覆盖历史记录。

## 准备确定性测试数据

如果编译后的用例包含带确定性值的 `generated` 或 `unique` 数据配置，Facade
可以在不打开目标系统的情况下解析该值：

```json
{
  "action": "prepare-test-data",
  "knowledgeProjectId": "knowledge-project-id",
  "systemId": "system-id",
  "executableCaseId": "executable-case-id",
  "confirm": true,
  "automatic": true
}
```

该模式只会写入已经由已确认数据计划推导出的值，不会创建业务记录、伪造查询
证据，也不会绕过清理规则。已有记录查询、记录创建、审批和清理仍然先预览，
再通过可审计的 Host Agent 任务完成。

## 不重启 MCP 刷新存储

外部恢复完成后，可调用 `bc_configure target=runtime operation=reload-store`。存在活动 Suite 或 Agent 任务时，Brain Creator 会拒绝刷新。Bridge 和连接器配置可以在不重启 MCP 的情况下更新：

```text
bc_configure target=runtime operation=update bridgeProvider=codex bridgeCommand=codex
bc_configure target=runtime operation=reload-config
```

运行时文件只保存命令、超时和 `env:`/`file:` 引用，环境变量拥有最高优先级。Brain Creator 会先校验并预检候选配置，成功后重建内置 OAuth/CAS/SAML Provider Registry 和飞书读取器，再持久化和激活；预检失败会保留旧配置。该命令是受控恢复/配置入口，不代表允许手工修改存储或运行时文件。

## 错误契约

失败结果保留 `success`、`data`、`errors` 和 `traceId`，同时增加稳定 `code`、中英文 `userMessage`、`technicalMessage`、`nextAction` 与 `retryable`。每次响应都生成新的 UUID `traceId`，反馈问题时应附带该值。
