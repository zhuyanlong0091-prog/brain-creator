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

每次批量编译都会生成 `CompileRun`，统计 `ready`、`blocked`、`ambiguous`、`skipped` 和 `reused`。幂等键由 TestIntent、系统、需求 hash 和当前 System Brain 证据组成。输入未变化时复用已有用例；证据变化时生成新用例，并将旧用例标记为 `superseded`。

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

## 安全处理 Gap

使用 `resolve-gap`、`dismiss-gap` 或 `reopen-gap`。先以 `confirm=false` 预览，再使用 `confirm=true`、非空 `confirmationNote` 和 `evidenceRefs` 确认。

- `resolve-gap`：证据表明缺失前提已经满足。
- `dismiss-gap`：用户明确接受该事项不在范围内。
- `reopen-gap`：新证据使已解决或已忽略的 Gap 再次需要处理。

每次转换都会追加到 Gap 生命周期，不会覆盖历史记录。

## 不重启 MCP 刷新存储

外部恢复完成后，可调用 `bc_configure target=runtime operation=reload-store`。存在活动 Suite 或 Agent 任务时，Brain Creator 会拒绝刷新。该命令是受控恢复入口，不代表允许手工修改存储。

## 错误契约

失败结果保留 `success`、`data`、`errors` 和 `traceId`，同时增加稳定 `code`、中英文 `userMessage`、`technicalMessage`、`nextAction` 与 `retryable`。每次响应都生成新的 UUID `traceId`，反馈问题时应附带该值。
