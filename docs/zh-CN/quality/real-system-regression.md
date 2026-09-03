# 真实系统回归样本

仓库提供了一组脱敏且可重复的回归样本，用于覆盖剩余执行可信度
partial 项。样本使用本地 HTTP 系统夹具，不提交生产地址、账号、密码、
Token、业务数据或截图。

## 样本验证内容

运行聚焦测试：

```bash
npx vitest run src/quality/realSystemRegression.test.ts
```

样本覆盖：

- 从模块入口跨页面进入表单页面；
- SPA `pushState` 和条件选择后的表单重挂载；
- 使用真实 Chromium 上下文验证过期 storage state、宿主刷新和刷新后的再次验证；
- 在需求套件 Run Ledger 中记录鉴权刷新、角色和 AuthProfile 引用；
- 测试数据查找/创建、创建数据租约、终态执行证据、清理任务和租约释放；
- 两个角色、两个需求场景和三次相互隔离的稳定性迭代；
- 将一次有限保证级别的迭代降级为 `unstable` 的负向稳定性断言。

## 浏览器环境

测试按以下顺序选择浏览器：

1. `BRAIN_CREATOR_TEST_BROWSER_PATH`；
2. Windows 上已安装的 Google Chrome 或 Microsoft Edge；
3. 其他主机上的 Playwright 托管 Chromium。

没有可用浏览器时执行：

```bash
npx playwright install chromium
```

如果浏览器下载被网络策略阻断，可以将
`BRAIN_CREATOR_TEST_BROWSER_PATH` 指向受信任的本地 Chromium 浏览器。

## 与问题台账的关系

该样本增强了 B1/B4（跨页面与重挂载恢复）、C1（鉴权刷新与再次验证）、
B5/E6（测试数据闭环）、E4/E5（多角色与重复稳定性）以及 F5（同系统多
需求执行）的证据。由于台账还要求跨域页面恢复、不同鉴权供应商刷新、完整
需求对账和长周期调度等生产条件，这些事项仍保持 `partial`。

该夹具是验收样本，不代表所有真实系统都具有相同的 DOM、鉴权供应商、数据
接口或业务流程语义。

更完整的 L3 交付门禁可运行 `npm run verify:l3-eval`。该命令还会评估脱敏的
HR、订单审批、图片状态机、跨角色、同系统多需求和合成长周期样本。在部署环境
提供证据前，真实系统回归和历史 Bug 回放会明确保持 `not-measured`。
