# 测试数据 Provider

Brain Creator 将测试数据规划和真实系统操作分开。Testdata Brain 负责实体身份、依赖关系、租约、来源证据和清理状态；系统专用 Provider 负责实际的查询、创建、状态转换、验证和清理。

## Provider 契约

嵌入式集成创建 MCP context 时可以传入系统 Provider：

```ts
const provider: TestDataProvider = {
  name: "orders-system",
  supports: (input) => input.systemId === "system-orders",
  lookup: async (input) => lookupOrder(input),
  create: async (input) => createOrder(input),
  transition: async (input) => transitionOrder(input),
  verify: async (input) => verifyOrder(input),
  cleanup: async (input) => deleteOrRestoreOrder(input)
};
```

每个方法都要返回稳定引用、可选的非敏感值、明确的生命周期状态和来源证据。Provider 必须将每次操作限制在请求的 `systemId` 内，Testdata Brain 会拒绝跨系统引用。

## 生命周期

1. Brain Creator 规划依赖关系，并优先查询/复用数据。
2. 只有已批准的数据计划允许时，Provider 才查询或创建实体。
3. `submitted`、`approved` 等状态转换更新同一个实体引用。
4. 验证只记录证据，不覆盖需求预期。
5. 创建的数据获得租约，并且必须使用 `delete-created` 或 `restore` 清理。
6. 清理成功后实体标记为 released；清理失败时由 Suite/控制面记录类型化 Gap。

内置 Provider 只用于确定性夹具。真实系统应实现该契约，或由 Host Agent 完成操作后提交数据引用和证据。CI/Suite 控制面负责清理失败分类和 Gap 创建。凭据不能进入 Provider 返回值、生成测试或报告。

## CI Runner

可以从 cron、GitHub Actions、Jenkins 或其他调度器调用统一 CLI：

```bash
npx brain-creator runner run --owner ci --project knowledge-orders --lease-ms 300000 --json
```

退出码 `0` 表示没有到期任务或执行完成，`1` 表示失败/阻断/部分完成，`2` 表示可恢复等待。租约会持久化到仓库中，因此第二个调度器不能领取正在执行的任务。

仓库提供了可复制的 [GitHub Actions 示例](../examples/github-actions/brain-creator-runner.yml)。启用定时触发前，必须在被测项目中配置非交互式 Agent provider 及其密钥；该示例仅用于接入参考，不会由 Brain Creator 自动启用。
