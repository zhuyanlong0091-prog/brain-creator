# Brain Creator 故障排查

先找到症状，再运行最小诊断并应用对应修复。

## 先运行 Doctor

在业务项目中运行：

```bash
npx brain-creator doctor
```

生成可分享且隐藏 secret 的报告：

```bash
npx brain-creator doctor --json
```

`doctor` 是只读命令。

## 按症状定位

| 症状 | 查看 |
|---|---|
| 找不到 `brain-creator` | [CLI 不可用](#cli-不可用) |
| Claude Code/Codex 看不到 Brain Creator | [MCP 工具缺失](#mcp-工具缺失) |
| Planner 或 Generator 超时 | [Agent provider 不可用](#agent-provider-不可用) |
| 返回 `needs_agent_execution` | [Host-Agent 任务待完成](#host-agent-任务待完成) |
| 无法启动浏览器 | [Playwright 浏览器不可用](#playwright-浏览器不可用) |
| 登录、CAPTCHA 或 2FA 阻塞 | [鉴权需要 Checkpoint](#鉴权需要-checkpoint) |
| 无法读取飞书链接 | [飞书来源读取失败](#飞书来源读取失败) |
| 无法批准需求基线 | [Requirement Eval 阻塞](#requirement-eval-阻塞) |
| 编译需要探索 | [系统证据不完整](#系统证据不完整) |
| 自动化问题被当作 Bug | [Bug 与 Gap 分类异常](#bug-与-gap-分类异常) |
| 新会话不知道如何继续 | [恢复会话状态](#恢复会话状态) |

## CLI 不可用

**症状**

```text
'brain-creator' is not recognized
```

**原因**

当前项目没有安装包，或本地安装时没有通过 `npx` 调用。

**修复**

```bash
npm install --save-dev brain-creator
npx brain-creator --version
```

全局安装是可选方案：

```bash
npm install -g brain-creator
brain-creator --version
```

## MCP 工具缺失

**症状**

- Agent 表示 Brain Creator 不可用。
- 无法发现 `/bc help`。
- 安装后没有 Brain Creator MCP 工具。

**修复**

```bash
npx brain-creator init --provider host-agent
npx brain-creator doctor
```

然后重启 Claude Code 或 Codex。确认项目中存在 `.mcp.json`，并且 `BRAIN_CREATOR_WORKSPACE` 指向正确工作区。

Codex 插件：

```bash
npx brain-creator plugin install
codex plugin list
```

## Agent Provider 不可用

**症状**

- bridge preflight 失败。
- Planner、Generator 或 Healer 没有启动。
- 子进程达到 `BRAIN_CREATOR_AGENT_TIMEOUT_MS`。

**诊断**

```bash
npx brain-creator doctor
npx brain-creator config
```

**修复**

- Codex 插件优先使用 `host-agent`，避免嵌套启动 Agent。
- Claude subprocess 使用 `claude`，并确认命令在 `PATH` 中。
- Codex subprocess 使用 `codex`，并确认 CLI 支持非交互运行。
- `disabled` 只用于预览。

```bash
npx brain-creator config write --provider host-agent
```

修改后重启 MCP 宿主。

## Host-Agent 任务待完成

**症状**

返回 `needs_agent_execution`，或套件停在 `waiting-for-agent`。

**含义**

这不是 bridge 缺失。当前 Agent 必须读取任务包，创建结构化 Planner、Generator 或 Healer 输出，再提交给 Brain Creator。

**修复**

```text
继续完成 Brain Creator 返回的 host-agent 任务，提交结果后恢复当前套件。
```

不要切换到底层同义工具，也不要在任务允许路径之外生成无关脚本。

## Playwright 浏览器不可用

**症状**

- Chromium executable missing。
- 探索或套件在打开页面前失败。

**修复**

```bash
npx playwright install chromium
```

或者设置：

```text
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<absolute-browser-path>
```

重新运行 `doctor`。浏览器可启动不代表目标系统鉴权有效。

## 鉴权需要 Checkpoint

**症状**

- 页面跳转到登录。
- 出现 CAPTCHA、2FA、恢复问题或密码输入。
- storage state 验证失败。

**修复**

让 Brain Creator 创建 AuthCheckpoint，在隔离的有头浏览器中完成登录，把 storage state 保存到 `.brain-creator/auth/<systemId>/storage-state.json`，并在新的只读上下文中验证后再完成 checkpoint。

不要把密码或一次性验证码写入对话、生成测试、命令参数或提交文件。

## 飞书来源读取失败

**症状**

- Wiki 节点解析失败。
- 文档私有或应用无权限。
- 复杂块或附件没有解析。

**诊断**

`doctor` 会检查以下两个变量是否同时存在：

```text
BRAIN_CREATOR_FEISHU_APP_ID
BRAIN_CREATOR_FEISHU_APP_SECRET
```

**修复**

- 修正应用权限或文档共享范围。
- 没有直连凭据时，让宿主 Agent 读取飞书文档并提交标准内容包。
- 两种通道都不可用时，导出 DOCX、PDF 或 Markdown。

未解析表格、画板和附件先作为已发现资产持续可见。调用 `bc_prepare action=analyze-attachments` 后，只有已记录的下载/识别重试失败或权限无法恢复时，Brain Creator 才创建 connector 或 attachment Gap。

## Requirement Eval 阻塞

**症状**

- `nextAction=confirm_requirement_eval`。
- `nextAction=revise_blocked_requirement`。
- 基线批准被拒绝。

**修复**

- 业务方给出答案后，用持久 `confirmationNote` 确认澄清项或缺失分支。
- 直接矛盾必须修订需求来源，说明不能绕过门禁。
- 来源或 confirmed 知识变化后重新生成分析。

不要通过直接绑定系统和执行来规避需求门禁。

## 系统证据不完整

**症状**

- 用例编译报告导航不唯一。
- 缺少页面、定位器、输入值或状态转换。
- 返回多条同等候选路径。

**修复**

刷新 System Brain，或让宿主浏览器提交聚焦的页面/训练证据。安全探索只用于受限 Tab、折叠和原生下拉。复杂菜单、数据输入和业务状态变化使用训练证据。

通过 `bc_status` 或 CompileRun 查看返回的 ExplorationTask。补充证据后，先预览再确认 `bc_prepare action=resolve-exploration-task`，系统会自动续编。证据尝试未结束前不要把任务标记为失败；失败才会创建最终 Gap。

Brain Creator 不应自动挑选一条模糊路径。

## Bug 与 Gap 分类异常

**症状**

- 语法、解析、定位或缺少元素被报告为产品 Bug。
- 已验证预期/实际差异只生成技术 Gap。

**修复**

复盘 ExecutionDiagnosis、重试预算和证据引用。产品 Bug 必须有已批准预期和受控重试后的实际差异。技术失败保持为类型化 Gap。

历史资产要先预览诊断建议，再逐条获得人工确认，不能无证据批量迁移。

## 恢复会话状态

发送：

```text
用 Brain Creator 恢复当前系统的会话，显示需求、鉴权、活动套件、Agent 任务、Bug、Gap、最近账本事件和下一步。
```

Agent 应使用会话/状态 Facade，而不是重新执行多次 list 查询。状态与持久套件证据不一致时，先复盘 RunLedger，再重试。

## 收集诊断报告

```bash
npx brain-creator --version
npx brain-creator doctor --json
npx brain-creator config --json
```

同时提供失败命令或自然语言请求、readiness 或 Gap 类型，以及不含 secret 的证据路径。不要提供 `.brain-creator/auth`、访问令牌、密码或 storage-state 内容。

## 下一步

- 返回[快速开始](getting-started.md)。
- 在 [CLI 参考](cli-reference.md)中检查语法。
- 在 [MCP 安装](mcp-installation.md)中复核 provider 配置。
