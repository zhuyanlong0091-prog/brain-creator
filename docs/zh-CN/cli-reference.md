# Brain Creator CLI 参考

使用统一的 `brain-creator` 命令安装、查看、诊断和启动 Brain Creator。

## 命令概览

| 命令 | 说明 | 示例 |
|---|---|---|
| `brain-creator init` | 安装项目资产并创建或更新 MCP 配置 | `npx brain-creator init --provider host-agent` |
| `brain-creator doctor` | 检查 provider、浏览器、连接器、知识目录和安装资产 | `npx brain-creator doctor` |
| `brain-creator config` | 输出脱敏后的有效 MCP 配置 | `npx brain-creator config --json` |
| `brain-creator config write` | 有意写入 MCP 配置 | `npx brain-creator config write --provider codex` |
| `brain-creator plugin install` | 安装 Codex 插件和 host-agent 配置 | `npx brain-creator plugin install` |
| `brain-creator mcp` | 通过 stdio 启动 MCP server | `npx brain-creator mcp` |
| `brain-creator help legacy` | 列出独立兼容命令 | `npx brain-creator help legacy` |
| `brain-creator --version` | 输出安装版本 | `npx brain-creator --version` |
| `brain-creator --help` | 输出顶层帮助 | `npx brain-creator --help` |

除非参数另有说明，命令都应在业务项目中运行。

## `brain-creator init`

```text
brain-creator init [--provider <provider>] [--with-plugin] [--target <path>] [--global] [--force] [--json]
```

安装 Brain Creator Skill、Playwright Agent 定义和 MCP 配置。已有自定义资产会被跳过，除非使用 `--force`。

| 参数 | 说明 |
|---|---|
| `--provider <provider>` | 设置 `auto`、`claude`、`codex`、`host-agent` 或 `disabled` |
| `--with-plugin` | 初始化时同时安装 Codex 插件 |
| `--target <path>` | 初始化其他项目目录 |
| `--global` | 写入使用全局命令的配置 |
| `--force` | 替换本应跳过的托管资产 |
| `--json` | 返回机器可读输出 |

推荐 Codex 项目配置：

```bash
npx brain-creator init --provider host-agent --with-plugin
```

## `brain-creator doctor`

```text
brain-creator doctor [--json]
```

这是只读命令，检查并提供以下修复建议：

- Agent provider 与 bridge 命令；
- provider 超时和参数；
- Playwright 或本机浏览器；
- Facade 或 full MCP 工具 Profile；
- 知识目录；
- 飞书连接器配置；
- 已安装项目资产。

在 CI 或诊断场景使用 JSON：

```bash
npx brain-creator doctor --json
```

## `brain-creator config`

```text
brain-creator config [show] [--target <path>] [--json]
```

查看脱敏后的有效配置，不修改 `.mcp.json`。

## `brain-creator config write`

```text
brain-creator config write [--provider <provider>] [--global] [--target <path>] [--json]
```

有意写入 MCP 配置。在切换 Agent 执行方式时使用：

```bash
npx brain-creator config write --provider claude
npx brain-creator config write --provider codex
npx brain-creator config write --provider host-agent
```

## `brain-creator plugin install`

```text
brain-creator plugin install [--target <path>] [--package-root <path>] [--json]
```

将安装包注册为 Codex 插件市场，安装 `brain-creator@personal`，并为目标项目写入 host-agent MCP 配置。

```bash
npx brain-creator plugin install
codex plugin list
```

## `brain-creator mcp`

通过 stdio 启动 MCP server。MCP 宿主通常从 `.mcp.json` 启动该命令，除非调试传输启动，否则不要再开一个交互副本。

## 兼容命令

早期版本暴露了以下独立命令：

- `brain-creator-mcp`
- `brain-creator-doctor`
- `brain-creator-install-assets`
- `brain-creator-write-mcp-config`
- `brain-creator-install-codex-plugin`

现有自动化仍可使用它们，新文档统一使用 `brain-creator` CLI。

## 环境变量

| 变量 | 用途 | 常用值 |
|---|---|---|
| `BRAIN_CREATOR_WORKSPACE` | 运行工作区根目录 | `.` |
| `BRAIN_CREATOR_TOOL_PROFILE` | MCP 工具表面 | `facade` |
| `BRAIN_CREATOR_AGENT_PROVIDER` | Agent 执行方式 | `host-agent` |
| `BRAIN_CREATOR_AGENT_TIMEOUT_MS` | Agent 调用超时 | `120000` |
| `BRAIN_CREATOR_KNOWLEDGE_DIR` | 外部知识目录 | `<absolute-knowledge-path>` |
| `BRAIN_CREATOR_FEISHU_APP_ID` | 飞书 OpenAPI app ID | 环境 secret 引用 |
| `BRAIN_CREATOR_FEISHU_APP_SECRET` | 飞书 OpenAPI app secret | 环境 secret 引用 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | 显式浏览器可执行文件 | 本机 Chrome/Edge 路径 |

Claude 与 Codex subprocess provider 还支持特定命令和参数变量。优先使用 `brain-creator config write` 生成有效起始配置。

## 退出与错误行为

- 无效命令输出用法并返回非零退出码。
- `doctor` 输出失败检查与修复建议，`--json` 保留结构化状态。
- 配置显示会隐藏 secret。
- `mcp` 通过 stdio 写协议消息，运行诊断写入 stderr。

按症状修复请查看[故障排查](troubleshooting.md)。
