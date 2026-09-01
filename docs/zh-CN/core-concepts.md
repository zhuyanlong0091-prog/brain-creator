# Brain Creator 核心概念

理解 Brain Creator 如何分离需求意图、系统证据、可执行测试和失败诊断。

## 产品模型

Brain Creator 不是通用浏览器宏录制器，也不是 Web UI。它是在 Claude Code、Codex 等 Agent 宿主中使用的测试领域层。

```text
来源 -> Requirement Brain -> 测试设计 -> 审批
    -> System Brain -> 用例编译 -> 测试数据
    -> ExecutionPlan -> Playwright -> Evidence
    -> Bug 或 Gap -> 复盘与知识回流
```

Agent 负责对话和宿主能力。Brain Creator 提供持久化领域模型、确定性门禁、执行编排和证据契约。

## 五个 Brain 与 Harness

五个 Brain 是同一个 TypeScript 包内的逻辑边界，不拆成五个服务：

- `Requirement Brain`：需求预期、来源条款、规则、流程和覆盖。
- `System Brain`：真实系统的页面、定位点、导航、状态转换和接口证据。
- `Testcase Brain`：可审核的测试意图和绑定证据的可执行用例。
- `Testdata Brain`：业务实体、数据配方、租约、依赖和清理。
- `Testexecution Brain`：执行计划、断言、证据、诊断和回归历史。

共享语义主干负责连接这些边界。例如，需求中的“新增”和系统中的“新建”可以解析为同一个 `action:create` 概念；`employee:testperson001` 是可被后续编辑用例消费的业务实体引用。

schema 20 建立了 L3 所需的持久化词汇：`BusinessObjectModel`、`DecisionTableModel`、`SemanticBinding`、`BusinessScenario`、`ScenarioAssuranceContract`、`ScenarioTrustRecord` 和 `OnboardingPlan`。OnboardingPlan 现在通过一次审批连接已评审需求基线与需求驱动的受限系统探索；场景生成和自主可信晋升仍属于后续能力。旧版可执行用例不会在迁移时直接获得 `verified` 或 `trusted`。

内置动作别名策略是通用且可审计的，可以归一化“新增”“新建”和 `create` 等词。仅有文案别名不能证明两个业务动作等价；条件映射和多步骤展开仍必须经过系统证据与后续可信门禁。

Harness Runtime 管理每次 Agent 任务的上下文、审批、执行、Eval、重试预算和终态。Agent 输出必须先通过结构化门禁才能写入领域资产。当前可以通过 `bc_status` 查看任务状态和事件，底层编排接口仍保持兼容。

### Harness 统一输出与门禁

Planner、Generator、Healer 使用版本化结构化输出。每个场景、步骤、断言和修复都必须带来源引用；Generator/Healer 只能在声明的文件边界内工作，Healer 不得删除断言。Planner 的非 `pass` Eval 会阻止后续测试资产写入；执行链的业务断言失败仍会进入 Reporter、Bug/Gap 和诊断流程。

## Requirement Brain

Requirement Brain 回答：**业务系统应该做什么，这个预期来自哪里？**

它包含：

- `KnowledgeProject`：独立于运行系统的需求知识边界。
- `RequirementSource`：本地文件、飞书文档、网页或宿主提交的内容包。
- `RequirementSet`：一次需求版本及其影响范围。
- `KnowledgeNode` 和 `KnowledgeEdge`：模块、角色、对象、字段、规则、流程、状态、权限、集成、数据约束、术语和需求条款。
- `TestIntent`：与来源条款关联、面向人工审核的测试目标。
- `TestDataProfile`：执行测试意图所需的数据策略。

宿主辅助分析使用四任务 Harness：文档地图、条款分析、业务建模和隔离 Coverage Critic。前三个阶段把正文、表格和已确认图片转换为带来源的条款、业务对象、流程、状态、决策表和不变量；Critic 只接收这些结构与来源证据，不继承设计者对话。结构合法不等于需求基线可信：Critic 阻塞时不得写入 Requirement 领域资产，第二次 schema 失败会形成可恢复 Gap。

自动生成的知识初始为 draft。confirmed 知识必须保留来源引用。直接矛盾不能靠确认绕过，必须修订来源或基线。

## System Brain

System Brain 回答：**选定的真实系统当前如何工作？**

它从以下系统隔离资产生成：

- `PageModel` 与截图；
- `LocatorPoint` 与定位置信度；
- `ProbeResult` 与浏览器诊断；
- `SystemExploration` 与已观察导航边；
- `TrainingSession` 与 `ActionStep`；
- `ApiFlow`；
- 受限安全交互产生的状态转换。

需求预期与系统观察是不同层。发现差异后保持 conflict，直到执行证据能够判断它是产品 Bug、过期需求还是未解决 Gap。

### 快照与差异

每次刷新 System Brain 都可以生成候选快照。快照使用路由、语义角色和归一化含义确定身份，不使用随机 PageModel ID。通过 `bc_review target=system-brain view=history` 查看历史，通过 `view=diff` 查看两个版本的差异。

只有定位器选择器变化且语义目标和角色保持不变时，才记为 `locator-changed` 并可自动接受。流程、状态转换或接口行为变化会记为 `behavior-changed`，需要复核并重新评估受影响用例。单次未观察到资产不能直接判定系统删除。

确认快照发生行为变化后，引用该 System Brain 的 TestIntent 和 ExecutableCase 会标记为 `stale`，并记录 ChangeSet、原因和时间。`bc_prepare action=reconcile-system-brain` 会把已批准需求语义与观察到的页面、流程、状态转换和接口进行对账；`bc_review target=semantic-binding` 会展示 exact、alias、step-expansion、conditional、missing 和 conflict 结果。测试数据补齐不会把 stale 用例伪装成 ready；需要先确认新快照，再使用 `bc_prepare action=recompile-stale-cases` 增量重编译受影响意图。`bc_review target=system-brain view=diff` 可查看差异，`bc_status` 可查看 stale 数量和运行恢复信息。

## Case Compiler

编译器将已批准 `TestIntent` 转换为某个绑定 `systemId` 下的 `ExecutableCase`。

只有证据支持唯一且高置信度的路径时，编译器才能补充隐含导航或状态动作。多条路径、缺失值、缺失定位器和不可达页面会创建可恢复的 `ExplorationTask`。编译器记录五个阶段结论，补充证据后自动续编；只有探索明确失败后才创建最终 Gap，待准备数据则使用 `needs-data`。

这条规则用于避免 Agent 静默编造人工测试人员可能凭经验补齐的隐藏动作。

## 测试数据

`TestDataProfile` 描述所需数据。`TestDataPlan` 排列依赖关系，并从固定值、生成值、唯一值、已有引用、运行时捕获和 secret 引用中选择策略。

`TestDataLease` 记录复用或创建的数据、证据和清理状态。默认复用；创建数据需要显式授权和清理策略。

Testdata Brain 还维护业务实体依赖图。实体可通过 `lookup`、`create`、`transition`、`verify` 和 `cleanup` Provider 生命周期化管理；后续用例引用同一实体，而不是依赖执行顺序猜测。已绑定知识项目可使用 `bc_review target=testdata systemId=<system-id>` 查看实体和依赖边。

secret 只保留引用，不得写入 prompt、生成测试、日志、报告或 npm 包。

## ExecutionPlan

`ExecutionPlan` 是不可变、按 hash 寻址的执行快照，包含已批准需求状态、目标系统、鉴权引用、导航与状态计划、测试数据租约、开放阻塞和受限 Generator 上下文。

只有 `ready` 计划能进入 Generator 和 Playwright。语义变化产生新快照，单纯时间戳变化不会。

## Bug 与 Gap

只有受控重试和诊断后，证据仍表明实际业务行为不符合已批准预期，才创建 `BugReport`。

Brain Creator 无法得出可信结论时创建 `Gap`。常见类型包括：

- 自动化或生成测试失败；
- 定位器或缺失元素证据；
- 测试数据准备或清理；
- 鉴权或人工检查点；
- 环境或网络失败；
- 连接器或来源解析失败；
- 业务流程不唯一；
- 缺少需求证据。

每个 blocked 终态必须能够通过 Gap 或 checkpoint 解释。

执行恢复信息来自持久化 Run Ledger，而不是宿主 Agent 的最后一句话。`bc_status` 会返回当前用例、步骤、页面、序号、等待原因、`possiblyStalled` 和下一步动作；没有进度通知能力的宿主也可以通过该账本恢复。

## Facade 与内部工具

普通 Agent 默认只看到少量 Facade：

- `bc_status`：当前就绪度和推荐动作。
- `bc_configure`：系统、鉴权、知识项目、术语、规则和 checkpoint。
- `bc_prepare`：需求、System Brain、测试数据和执行准备。
- `bc_run`：已批准需求套件、文档套件和回归。
- `bc_review`：知识、运行、证据、Bug 和 Gap。
- host-agent 任务准备和提交工具。

`full` Profile 保留底层工具用于兼容、测试、审计和调试。Facade 请求被拒绝或取消后，不得改用同义底层工具绕过。

## Agent Bridge

Planner、Generator 和 Healer 可以通过以下方式运行：

- `claude`：启动配置的 Claude 子进程。
- `codex`：启动配置的 Codex 子进程。
- `host-agent`：当前 Agent 接收任务包，再向 Brain Creator 提交结构化结果。

`host-agent` 不需要嵌套 Agent 进程，是 Codex 插件工作流的推荐设置。`disabled` 只支持预览。

确认执行前运行 `brain-creator doctor`，检查实际 provider。

## 存储

Brain Creator 采用本地优先策略。运行状态和证据默认写入 `.brain-creator/`，需求知识默认写入 `.brain-creator/knowledge`。

当前分片仓库版本为 schema 20。schema 19 仓库会在迁移前生成备份；如果写锁导致迁移无法完成，Brain Creator 会继续保留 schema 19 快照，不会部分宣称升级成功。

源码工作区可运行 `npm run verify:autonomy-baseline` 输出确定性的 L3 基线。报告会区分“已测量”和“尚未测量”；BusinessScenario 或 Mutation 指标尚未建设时会明确列为能力缺口，而不是记为通过。

可用 `BRAIN_CREATOR_KNOWLEDGE_DIR` 指向外部 Obsidian 兼容目录。运行数据、鉴权状态、prompt、trace 和生成测试不得提交到 Git。

## 安全边界

- 没有显式批准就不执行。
- 不跨系统复用执行证据。
- 不在用户资产中保存明文 secret。
- 系统探索仅访问 allowlist 中的 HTTP(S) URL，并受预算限制。
- 探索阶段阻止表单提交和写入型安全探针。
- 重试和 Healer 次数由确定性预算控制。
- 创建 Bug 前必须完成证据化诊断。

## 下一步

- 按[从需求到测试](guides/requirement-to-test.md)运行完整流程。
- 在 [MCP 安装](mcp-installation.md)中配置运行环境。
- 门禁阻塞时查看[故障排查](troubleshooting.md)。
