# 测试用例脑与测试数据脑

Testcase Brain 将已审核的业务意图编译为可执行用例。Testdata Brain 让用例使用的数据显式、可复用、可审计。两者通过稳定的业务实体引用关联，而不是依赖套件“碰巧先执行了哪条用例”。

## 编译顺序

Brain Creator 按以下顺序编译用例：

```text
BusinessScenario
  -> 需求流程或状态路径
  -> System Brain 导航和动作绑定
  -> 业务实体依赖图
  -> TestDataPlan
  -> 断言 Oracle
  -> ExecutableCase
```

每个可执行步骤都会保留来源引用。只有在需求流程或 System Brain 证据给出唯一明确路径时，才允许补充 `derived` 动作。证据缺失或存在歧义时保持待审核状态，不会转化为猜测动作。

## 业务实体引用

为业务实体使用稳定引用，例如 `employee:testperson001`：

```text
新增员工       produces: employee:testperson001
编辑员工       consumes: employee:testperson001
审批员工       consumes: employee:testperson001
```

引用不是密钥，也不替代表单中实际输入的值。它用于标识多个用例之间的同一个业务实体。编译结果会在 `entityReferenceRequirements`、数据计划、数据操作和相关步骤绑定中保留该引用。

依赖图强制区分四种结果：

- 一个生产者：消费者排在生产者之后执行，并记录依赖边。
- 没有生产者：用例进入 `needs-data`。
- 多个生产者：用例进入 `ambiguous`，Brain Creator 不会擅自选择。
- 存在依赖环：用例进入 `blocked`，需要重新设计数据依赖。

已过期或已被替代的可执行用例不会被视为当前生产者。历史执行结果或旧编译产物不能静默满足新用例的数据依赖。

通过现有 Facade 查看依赖图：

```text
bc_review target=case-dependency systemId=<system-id> responseMode=summary
```

返回内容包含节点、依赖边、执行顺序、未解决原因和来源引用。只有进行具体审计时才使用 `responseMode=full`。

## Testdata Provider 生命周期

系统专用适配器实现现有 Provider 契约：

```text
lookup -> create -> transition -> verify -> cleanup
```

Provider 会收到业务实体引用和选定的 `systemId`。Testdata Brain 记录返回的引用、证据、租约和清理状态。默认优先复用已有数据。创建数据必须显式授权并设置清理策略。Provider 失败会进入类型化的数据或环境 Gap，不会直接被判定为产品 Bug。

内置 Provider 只是确定性测试夹具，不是任意业务系统的通用适配器。真实集成需要提供系统专用的查询、增删改、流程状态转换和清理能力，或者由宿主 Agent 在批准范围内完成操作，再通过 Facade 提交引用和证据。

## 断言契约

断言与动作文本分开编译。每条断言都必须具备：

- 需求或已批准来源引用；
- value、state、visibility、workflow、network 或 side-effect 等 Oracle 类型；
- 需要采集什么证据的说明；
- `strong` 或 `limited` 强度。

Playwright 执行成功本身不是业务断言。没有来源支持的 Oracle 时，用例会被阻塞或降级为有限验证，不能静默晋级为可信回归用例。

## 执行前检查清单

执行前检查：

1. 依赖图没有缺失、歧义或循环引用。
2. 每个创建的实体都有查询或创建决策和清理策略。
3. 每个消费实体都指向明确生产者或已批准的外部引用。
4. 每条断言都明确什么证据可以证明业务结果。
5. 用例绑定当前 System Brain，不使用过期产物。

这样既能让测试用例跨业务系统复用，又把系统特有的数据操作留在适配器中，同时保持需求预期与系统观察相互独立。
