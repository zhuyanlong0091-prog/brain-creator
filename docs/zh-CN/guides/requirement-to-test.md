# 从需求到执行测试

将一份需求来源依次完成分析、批准、系统绑定、数据准备、执行和证据复盘。

本指南使用自然语言请求。Brain Creator 在内部选择 Facade 工具；文中提到工具名只是为了让流程可审计。

## 开始之前

先完成[快速开始](../getting-started.md)，并确认 `brain-creator doctor` 能识别有意选择的 Agent provider 和可用浏览器。

准备以下信息：

- 需求文件或链接；
- 目标系统基础 URL 和允许访问范围；
- 鉴权方式或人工登录计划；
- 当场景不能复用已有数据时，创建测试数据的授权。

## 1. 导入需求

发送：

```text
用 Brain Creator 导入并分析这个需求，保留来源引用，先不要执行：<path or URL>
```

Brain Creator 创建或复用 `KnowledgeProject`，记录来源 hash 和版本，并建立 draft 知识。

支持 Markdown、TXT、DOCX、PDF、HTTP(S)、Obsidian 引用和飞书 Wiki/Doc。Excel 与 Markdown 人工用例走兼容的文档套件流程。

**验证：** 响应明确来源、版本、解析告警和知识项目。

## 2. 审核分析与测试设计

Brain Creator 将宿主辅助的需求理解拆成四个独立任务：

1. 文档地图：识别目标、范围、模块、角色、业务对象和附件证据。
2. 条款分析：输出原子化显式/推导条款、置信度和精确来源引用。
3. 业务建模：从正文、表格和已确认图片建立对象生命周期、流程、状态机、决策表和不变量。
4. 覆盖 Critic：在隔离任务中只读取来源与结构化产物，不继承设计者对话，检查遗漏主流程、分支、异常、后续角色、终态、矛盾和无依据推导。

使用 `bc_prepare action=generate-analysis provider=host-agent`。宿主执行返回的任务后，以同一 action 携带 `taskId` 和 `analysisPackage` 逐阶段提交 JSON；Critic 完成后再以相同 provider 调用 `generate-test-design`。正常流程使用 4 次 Agent 调用，schema 或 Eval 仅允许重试 1 次，第二次失败必须创建可恢复 Gap。Host Skill 可以增强文档地图和条款分析，但不能跳过业务建模与 Critic。

Brain Creator 应展示：

- 原子需求条款和来源锚点；
- 模块、角色、对象、字段、规则、流程、状态、权限和集成；
- 风险、矛盾、假设和缺失分支；
- TestIntent、测试设计技术、优先级和预期结果；
- TestDataProfile 和未解决数据依赖；
- Requirement Eval 覆盖率和必要动作。

已确认的图片流程证据会落为 `WorkflowModel` 和 `StateMachineModel`，每条转换都保留附件边的来源引用。状态模型会生成正向转换用例，并在适用时生成缺少前置状态、角色不匹配和未定义转换等负向用例；跨角色流程会生成 Actor Journey。`RequirementCoverageProfile` 会对账字段、流程、状态、权限和集成五类需求引用与 TestIntent。

关键流程图或状态机在识别并确认前不能批准基线。仅发现附件不会创建 Gap，但 Brain Creator 也不能据此声称需求覆盖完整。确认后再次生成测试设计会使用新的输入指纹，替代先前偏字段的草稿。

使用持久业务证据回答澄清问题。澄清项与缺失分支可以携带说明确认；直接矛盾必须修订来源或基线。

**验证：** 每个 TestIntent 至少引用一条需求条款或已确认附件边；无依据结论保持可见，不能成为事实。使用 `bc_review target=coverage` 查看流程模型和各维度缺失引用。

## 3. 批准需求基线

分析正确后发送：

```text
确认以上澄清结果，重新运行 Requirement Eval；如果门禁通过，提交需求基线给我最终审批。
```

然后显式批准：

```text
批准该需求基线。下一步只绑定和探索系统，不执行测试。
```

**验证：** 基线为 approved，且不存在待确认或 blocked Eval action。

## 4. 创建或复用系统

让 Brain Creator 创建或选择 SystemProfile：

```text
将需求绑定到测试系统 <base URL>，环境为 test，URL 只允许访问 <allowlist>。
```

一个知识项目可以绑定多个系统或环境。运行资产不得跨 `systemId` 使用。

**验证：** 状态响应同时给出 `knowledgeProjectId` 和 `systemId`。

## 5. 绑定真实系统

访问受保护页面前先配置鉴权。优先使用 Token、Cookie 或工作区内的 Playwright storage-state 引用。

遇到密码、CAPTCHA、恢复问题或 2FA 时，Brain Creator 创建 AuthCheckpoint，等待用户或宿主 Agent 完成登录。不要把 secret 发到对话或生成测试中。

然后发送：

```text
探索当前系统，默认只访问 allowlist 内链接，不提交表单。列出发现的页面、入口、定位点和阻塞项。
```

探索默认只进行受限链接导航。只有需要 Tab、折叠控件或原生下拉状态证据时，才启用 `interactionMode=safe`。复杂菜单和业务流程需要宿主 Agent 提交页面或训练证据。

**验证：** System Brain 包含版本化页面、定位器、探针和导航证据。登录页、空证据或不安全转换会创建 Gap。

## 6. 编译可执行用例

发送：

```text
基于已批准需求和当前 System Brain 编译可执行用例，展示所有补全动作的证据来源。
```

只有唯一已观察路径存在时，Brain Creator 才能补全隐含动作。等价入口、缺失目标、缺失值或缺失定位器会创建可恢复的 ExplorationTask。补充或确认 System Brain 证据后解决任务，编译会自动继续；只有将探索标记为失败时才创建最终 Gap。

**验证：** 每个步骤都有需求、流程、页面、定位器、状态转换、数据或 derived 证据。检查 `compilationStages`、`pathPlan`、`statePlan`、ExplorationTask 和候选数量。

## 7. 准备测试数据

先预览数据计划：

```text
为这些用例准备测试数据计划，优先复用已有数据；任何创建操作先等我授权。
```

必须创建时显式授权并指定清理：

```text
允许为本次套件创建缺失数据，使用 delete-created 清理策略；先返回准备结果和稳定引用。
```

宿主 Agent 执行查询或创建，再提交带证据的引用。Brain Creator 保存租约，不保存明文 secret。

**验证：** 依赖顺序正确，稳定引用存在，所有新建数据都有清理义务。

## 8. 预览并执行

先要求完整预检：

```text
预览 Requirement Suite。检查需求基线、系统、鉴权、页面证据、测试数据、开放 Gap 和执行计划，先不要执行。
```

检查用例数量、顺序、阻塞和证据后，一次确认：

```text
确认执行该 Requirement Suite。
```

每条用例数据就绪后，Brain Creator 才冻结对应 ExecutionPlan。Generator 生成 Playwright 测试，Playwright 执行，Healer 只对自动化失败进行有限重试。

**验证：** `bc_status` 显示活动套件、当前用例、等待原因、最近账本事件和下一步。

## 9. 复盘证据

发送：

```text
复盘本次套件，按用例展示步骤、输入、断言、截图或 trace、实际结果和失败分类。
```

有效复盘必须区分：

- 已通过用例；
- 已验证产品 Bug；
- 自动化与定位 Gap；
- 数据、清理、鉴权、环境或网络 Gap；
- 跳过或取消用例；
- 剩余回归任务。

RunLedger 提供时间线，ExecutionEvidence 提供步骤证据。Bug 必须关联已批准预期、实际差异、复现路径和证据引用。

系统探索还会记录采集过程中发现的浏览器表面。System Brain 可以区分主文档、允许范围内的 iframe、开放 Shadow DOM 和 Wujie-like 容器摘要。安全交互导致 URL 变化时会加入探索队列。表面证据只用于观察，不会授权写操作，也不会静默推断跨 frame 动作。

使用 `bc_review` 并设置 `target=coverage` 查看 TestIntent 执行台账。每条意图都会被归类为 strong-verified、limited、failed、blocked、not-selected 或 superseded。同一响应还会返回来源台账，包含块、需求版本、知识节点、意图、可执行用例、执行证据和未读取附件，并展示 `field`、`workflow`、`state`、`permission`、`integration` 五类维度的必需、已验证和缺失情况。需要验证稳定性时，在 `bc_run mode=requirement-suite` 中使用 `repeatCount`。

## 10. 恢复或回归

新会话中发送：

```text
用 Brain Creator 恢复这个系统的上次会话，显示未完成套件、当前任务、开放 Bug/Gap 和推荐下一步。
```

回归已验证 Bug：

```text
回归当前系统中所有 open Bug，仍然先预览范围和鉴权状态。
```

重试、跳过和取消都必须先预览再显式确认，历史尝试和证据不会丢失。

## 已有测试用例文档

对于 Excel 或 Markdown 用例文件，发送：

```text
用 Brain Creator 预览这个测试用例文档，告诉我总数、优先级、模块、缺失字段和执行风险，先不要运行：<path>
```

确认后，Brain Creator 创建一个按来源顺序执行的文档套件。业务差异创建 BugReport，证据或环境阻塞创建 Gap。除非显式请求并且功能支持，否则来源文档保持只读。

## 下一步

- 阅读[核心概念](../core-concepts.md)了解资产模型。
- provider、浏览器、连接器、鉴权或执行门禁阻塞时查看[故障排查](../troubleshooting.md)。
- 需要 Facade 与兼容行为细节时查看 [Agent 使用](../agent-usage.md)。
