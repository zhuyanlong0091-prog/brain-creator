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

## Requirement Brain

Requirement Brain 回答：**业务系统应该做什么，这个预期来自哪里？**

它包含：

- `KnowledgeProject`：独立于运行系统的需求知识边界。
- `RequirementSource`：本地文件、飞书文档、网页或宿主提交的内容包。
- `RequirementSet`：一次需求版本及其影响范围。
- `KnowledgeNode` 和 `KnowledgeEdge`：模块、角色、对象、字段、规则、流程、状态、权限、集成、数据约束、术语和需求条款。
- `TestIntent`：与来源条款关联、面向人工审核的测试目标。
- `TestDataProfile`：执行测试意图所需的数据策略。

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

## Case Compiler

编译器将已批准 `TestIntent` 转换为某个绑定 `systemId` 下的 `ExecutableCase`。

只有证据支持唯一且高置信度的路径时，编译器才能补充隐含导航或状态动作。多条路径、缺失值、缺失定位器和不可达页面都会阻塞编译并创建 Gap。

这条规则用于避免 Agent 静默编造人工测试人员可能凭经验补齐的隐藏动作。

## 测试数据

`TestDataProfile` 描述所需数据。`TestDataPlan` 排列依赖关系，并从固定值、生成值、唯一值、已有引用、运行时捕获和 secret 引用中选择策略。

`TestDataLease` 记录复用或创建的数据、证据和清理状态。默认复用；创建数据需要显式授权和清理策略。

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
