# 执行可靠性控制

Brain Creator 将可靠性作为可审计的控制面，而不是把一次绿色运行当作需求整体通过的证明。

## 跨页面与多 surface 恢复

系统探索会记录目标 surface（`document`、`iframe`、`popup`、`shadow-root`、`wujie`），并独立恢复目标 surface。子页面不可用时不会静默退回主文档；跨域或未注册的 surface 会阻断并保留证据，供后续创建 Gap。

## 鉴权刷新

鉴权刷新采用供应商注册表。内置 host-agent 适配器兼容现有 Claude、Codex 和宿主回调。Token、Cookie、OAuth、CAS、SAML 是明确的扩展槽位，不会伪装成已经具备供应商级刷新能力；没有适配器时返回 `needs-user`，继续走 AuthCheckpoint。刷新有超时限制，结果不会返回明文密钥。

可以通过 `bc_configure`、`target=auth`、`operation=refresh` 显式请求刷新。

## 同系统多需求对账

需求套件会持久化预期需求集合，并在创建和复盘时对账可执行用例：

- `complete`：所有需求集合都有当前用例，且没有跨系统引用或重复编译键。
- `partial`：需求集合或可执行用例缺失。
- `conflicted`：用例属于其他系统，或当前编译键重复。

通过 `bc_review` 的 `target=requirement-suite-run` 查看对账结果。

## 长周期稳定性

稳定性评估包含目标次数、最小样本、失败率、连续失败、最长耗时、强证据和阻断策略。单次绿色运行仍然是 `insufficient-sample`。配置最小间隔后，下一轮会持久化 `nextRunAt`，不会提前执行；下一次显式调用 `bc_run` 或 resume 且时间到达后才会启动。

当前实现的是可持久化的调度元数据，不是后台 Worker。生产环境的定时器、分布式租约和具体鉴权供应商刷新仍需按部署环境扩展。
