# Brain Creator 快速开始

在业务项目中安装 Brain Creator、验证运行环境，并生成第一份可审核的需求分析。

完成本页后，你将能在 Claude Code 或 Codex 中用一句自然语言触发 Brain Creator，并看到带来源引用的需求分析。测试不会在你批准前执行。

## 前置条件

- Node.js 20 或更高版本。
- 已安装 Claude Code 或 Codex，并能打开目标项目。
- 一个可写的业务项目目录。
- 本地需求文件、HTTP(S) 页面或飞书文档链接。

你不需要 PostgreSQL、Redis、Web UI 或独立的 Brain Creator 账号。

## 1. 安装

在需要测试的业务项目中运行：

```bash
npm install --save-dev brain-creator
npx brain-creator --version
```

预期结果：版本命令打印已安装的包版本。

## 2. 初始化项目

当当前 Claude Code 或 Codex 会话需要亲自完成 Planner、Generator 和 Healer 任务时，使用 `host-agent`：

```bash
npx brain-creator init --provider host-agent
```

该命令安装项目级 Skill、Playwright Agent 资产，并创建或更新 `.mcp.json`。除非显式使用 `--force`，否则不会覆盖已有自定义资产。

Codex 用户还可以安装项目级插件入口：

```bash
npx brain-creator plugin install
```

修改 MCP 或插件配置后，需要重启宿主。

## 3. 验证环境

```bash
npx brain-creator doctor
```

继续前检查以下结果：

| 检查项 | 就绪含义 |
|---|---|
| Agent provider | 已有意选择 `host-agent`、`claude` 或 `codex` |
| 浏览器 | Playwright Chromium 或受支持的本机 Chrome/Edge 可用 |
| 工具 Profile | 普通 Agent 使用 `facade` |
| 知识目录 | 解析后的目录可写 |
| 飞书连接器 | 直连凭据完整，或宿主读取降级通道可用 |

如果必要检查失败，先按照 `doctor` 输出修复，或阅读[故障排查](troubleshooting.md)。

## 4. 发出第一条请求

在同一项目中打开 Claude Code 或 Codex，然后发送：

```text
用 Brain Creator 分析这个需求文档，生成需求分析、覆盖矩阵、测试数据和测试意图，等我确认后再执行：<文件路径或链接>
```

Brain Creator 应优先使用高阶 Facade 入口。你不需要指定某个 `bc_*` 工具。

## 5. 审核结果

第一次有效响应应包含：

- 需求来源、版本或 hash；
- 从来源中识别的模块、角色、字段、规则、流程和状态；
- 生成知识与 TestIntent 的来源引用；
- 需要确认的缺失分支、矛盾和问题；
- 建议的 TestDataProfile；
- 覆盖情况与 Requirement Eval 状态；
- 推荐的下一步。

未经你确认，Brain Creator 不得批准基线或执行真实系统。

## 6. 安全地继续

分析正确后发送：

```text
确认这些澄清结果并重新评估；通过后让我审批需求基线。
```

需求基线获批后，绑定真实系统：

```text
将这个需求基线绑定到 <system URL>，先检查鉴权并探索系统，不要提交业务表单。
```

继续阅读[从需求到测试](guides/requirement-to-test.md)，完成系统探索、测试数据准备、执行和证据复盘。

## 常用命令

| 命令 | 用途 |
|---|---|
| `brain-creator init --provider host-agent` | 安装项目资产和 MCP 配置 |
| `brain-creator doctor` | 检查 provider、浏览器、连接器和工作区 |
| `brain-creator config` | 查看脱敏后的有效配置 |
| `brain-creator config write --provider codex` | 有意更新 MCP 配置 |
| `brain-creator plugin install` | 安装项目级 Codex 插件入口 |
| `brain-creator mcp` | 通过 stdio 启动 MCP server |
| `brain-creator help legacy` | 查看兼容命令 |

所有参数见 [CLI 参考](cli-reference.md)。

## 下一步

- 阅读[核心概念](core-concepts.md)理解产品模型。
- 按[从需求到测试](guides/requirement-to-test.md)运行完整流程。
- 在 [MCP 安装](mcp-installation.md)中配置 subprocess 或 host-agent。
- 遇到阻塞时查看[故障排查](troubleshooting.md)。
