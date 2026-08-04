# Brain Creator MCP 安装

通过项目级 MCP server 将 Brain Creator 连接到 Claude Code 或 Codex。完成本页后，宿主能够发现 Facade 工具，`brain-creator doctor` 能解释当前 Agent 执行方式。

## 前置条件

- Node.js 20 或更高版本。
- 已安装 Claude Code 或 Codex。
- 一个可写的业务项目目录。
- 修改 MCP 配置后可以重启 Agent 宿主。

## 项目级 MCP 连接（推荐）

在业务项目中安装固定版本：

```bash
npm install --save-dev brain-creator
npx brain-creator --version
npx brain-creator --help
```

初始化 Skill、Playwright Agent 定义、Playwright 配置和 MCP 配置：

```bash
npx brain-creator init --provider host-agent
```

该命令幂等执行：保留已有 MCP server，并跳过现有自定义资产。只读查看脱敏配置：

```bash
npx brain-creator config
```

只有需要改变 provider 时才写配置：

```bash
npx brain-creator config write --provider host-agent
```

初始化默认设置 `BRAIN_CREATOR_TOOL_PROFILE=facade`，Agent 只看到准备、状态、配置、执行、复盘和 host-task 提交等高阶工具。仅在兼容、审计或调试时使用 `full`。

## Codex 插件

从项目本地安装包注册插件：

```bash
npx brain-creator plugin install
codex plugin list
```

该命令把安装包根目录注册为 Codex marketplace，安装 `brain-creator@personal`，并把当前工作区配置为 `BRAIN_CREATOR_AGENT_PROVIDER=host-agent`。

不要直接把 `plugins/`、`plugins/brain-creator` 或 `.agents/plugins/marketplace.json` 作为 marketplace 根目录。

## 选择 Agent Provider

| Provider | 使用场景 |
|---|---|
| `host-agent` | 当前 Claude Code/Codex 会话执行任务包；Codex 插件推荐 |
| `claude` | 显式启动 Claude 子进程 |
| `codex` | 显式启动 Codex 子进程 |
| `auto` | 让 Brain Creator 检测可用 bridge |
| `disabled` | 只做预览，不执行 Agent 链 |

切换 provider：

```bash
npx brain-creator config write --provider claude
npx brain-creator config write --provider codex
npx brain-creator config write --provider host-agent
```

推荐的项目配置类似：

```json
{
  "mcpServers": {
    "brain-creator": {
      "command": "npx",
      "args": ["brain-creator-mcp"],
      "env": {
        "BRAIN_CREATOR_WORKSPACE": ".",
        "BRAIN_CREATOR_TOOL_PROFILE": "facade",
        "BRAIN_CREATOR_AGENT_PROVIDER": "host-agent",
        "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

## Host-Agent 执行

在 `host-agent` 模式下，计划、执行链或文档套件可能返回 `needs_agent_execution`。这不是 bridge 缺失，而是当前 Agent 的待办：

1. 读取任务包中的 `input.prompt.md` 与 `input.context.json`。
2. 只生成任务要求的 Planner、Generator 或 Healer 输出。
3. 通过 host-task Facade 提交结构化结果。
4. 如果返回下一任务，继续处理。
5. 在 `completed`、`failed` 或 `blocked` 时停止。

`waiting-for-agent` 表示当前 Agent 应继续工作，不能改用底层工具绕过。

## Claude 子进程

使用托管配置生成默认 Claude 命令：

```bash
npx brain-creator config write --provider claude
npx brain-creator doctor
```

确保 `claude` 在 `PATH` 中，并支持非交互 print 模式。Brain Creator 在正式调用前执行快速 preflight，避免 bridge 不可用时等待完整超时。

## Codex 子进程

```bash
npx brain-creator config write --provider codex
npx brain-creator doctor
```

Codex 子进程适用于明确需要隔离调用的项目。插件方式优先使用 `host-agent`，避免在 Codex 中再启动 Codex。

## 验证安装

```bash
npx brain-creator doctor
```

Doctor 会输出：

- 实际解析的 provider 和命令；
- 浏览器可用性；
- MCP 工具 Profile；
- 知识目录；
- 飞书连接器就绪度；
- 缺失资产和建议动作。

如果 Playwright 浏览器和本机 Chrome/Edge 都不可用：

```bash
npx playwright install chromium
```

也可以设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向受支持的绝对路径。

## 鉴权状态

人工登录产生的 Playwright storage state 应保存在：

```text
.brain-creator/auth/<systemId>/storage-state.json
```

通过 `script` AuthProfile 中的 `storageStatePath` 引用它，并在新的只读浏览器上下文中验证。`.brain-creator/` 与 `.playwright-cli/` 必须保持忽略，不得进入 npm 包。

## 飞书连接器

直连飞书 Wiki/Doc 时同时设置：

```text
BRAIN_CREATOR_FEISHU_APP_ID
BRAIN_CREATOR_FEISHU_APP_SECRET
```

缺少任一变量都会立即失败。没有直连凭据时，宿主 Agent 可以使用飞书能力读取文档，再提交标准内容包。Brain Creator 不保存飞书访问令牌。

## 外部知识目录

需求知识默认写入 `.brain-creator/knowledge`。接入外部 Obsidian 目录：

```text
BRAIN_CREATOR_KNOWLEDGE_DIR=<absolute-knowledge-path>
```

## 全局安装

```bash
npm install -g brain-creator
brain-creator --version
brain-creator init --global --provider host-agent
brain-creator doctor
```

全局模式的 `.mcp.json` 使用 `brain-creator-mcp`，不通过 `npx`。插件仍建议从业务项目本地包安装，以固定版本和 marketplace 根目录。

## 源码开发模式

仅在开发 Brain Creator 本身时使用：

```bash
git clone https://github.com/zhuyanlong0091-prog/brain-creator.git
cd brain-creator
npm install
npm test
npm run dev:mcp
```

普通业务项目不需要源码仓库。

## 安装后的第一条请求

重启 Claude Code 或 Codex，然后发送：

```text
用 Brain Creator 分析这个需求文档或飞书链接，生成测试设计和测试数据，并等待我批准。
```

## 兼容命令

`brain-creator-mcp`、`brain-creator-doctor`、`brain-creator-install-assets`、`brain-creator-write-mcp-config` 和 `brain-creator-install-codex-plugin` 仍可用于旧配置。使用 `brain-creator help legacy` 查看统一替代命令。

## 下一步

- 按[快速开始](getting-started.md)完成首次流程。
- 阅读[核心概念](core-concepts.md)理解 provider 与证据边界。
- 连接或运行失败时查看[故障排查](troubleshooting.md)。
