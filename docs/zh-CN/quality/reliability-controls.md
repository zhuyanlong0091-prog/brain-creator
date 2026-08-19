# 执行可靠性控制

Brain Creator 将可靠性作为可审计的控制面，而不是把一次绿色运行当作需求整体通过的证明。

## 跨页面与多 surface 恢复

系统探索会记录目标 surface（`document`、`iframe`、`popup`、`shadow-root`、`wujie`），并独立恢复目标 surface。子页面不可用时不会静默退回主文档；跨域或未注册的 surface 会阻断并保留证据，供后续创建 Gap。

## 鉴权刷新

鉴权刷新采用统一供应商注册表和适配器协议。Token 和 Cookie 配置可以通过内置适配器重新物化为受保护的 storage state；OAuth 使用标准 refresh-token grant，CAS 校验配置的 service ticket，SAML 将宿主采集的 SAMLResponse 交换为会话。浏览器特定或厂商特定流程继续由 host-agent 适配器承接。供应商凭据与端点通过加密 AuthProfile 提供，刷新有超时限制，结果不会返回明文密钥。

可以先通过 `bc_configure target=auth operation=preflight` 检查供应商 readiness，再用 `operation=refresh` 显式请求刷新。`bc_status` 会展示已注册、已配置和不可用的刷新供应商；缺少或不可用的供应商会创建鉴权预检 Gap，并阻止用例进入 Agent/Playwright 链路。

## 同系统多需求对账

需求套件会持久化预期需求集合，并在创建和复盘时对账可执行用例：

- `complete`：所有需求集合都有当前用例，且没有跨系统引用或重复编译键。
- `partial`：需求集合或可执行用例缺失。
- `conflicted`：用例属于其他系统，或当前编译键重复。

通过 `bc_review` 的 `target=requirement-suite-run` 查看对账结果。结果还会展示缺失的 TestIntent、缺失的可执行用例、已废弃需求版本和未绑定系统的用例。

## 长周期稳定性

稳定性评估包含目标次数、最小样本、失败率、连续失败、最长耗时、强证据和阻断策略。单次绿色运行仍然是 `insufficient-sample`。配置最小间隔后，下一轮会持久化 `nextRunAt`，不会提前执行；下一次显式调用 `bc_run` 或 resume 且时间到达后才会启动。

稳定性任务现在提供显式的 claim/lease 控制面：外部定时器或宿主 Agent 可以预览到期任务，使用 `suiteAction=claim-scheduled` 领取，长任务期间续租，失败时释放并写入错误。租约过期后其他执行者可以恢复领取，进程崩溃不会永久卡住任务。当前仍是可持久化调度元数据，不是后台 Worker；生产定时器和分布式存储仍需按部署环境接入。

## 执行过程可见性

每条 Run Ledger 记录都会获得运行内稳定序号，并投影为统一的 `ExecutionProgressEvent`。Reporter 回传的步骤会补充步骤 ID、标题、断言摘要、截图、耗时和 trace 标识；敏感值和页面 URL 查询参数会在持久化前脱敏。

调用方提供 progress token 时，`bc_run` 和 `bc_submit_agent_output` 会发送 MCP Progress Notification。通知属于尽力而为通道，发送失败不改变执行结果，持久化 Ledger 始终是权威来源。`bc_status` 返回当前事件；活动事件超过阈值时显示 `possiblyStalled`，终态事件不会误报卡住。每条用例完成后都会增量重写静态 Suite 报告，测试工程师无需等待整套结束即可查看证据。
