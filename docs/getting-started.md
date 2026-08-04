# Brain Creator Quickstart

Install Brain Creator in a business project, verify the runtime, and produce your first reviewable requirement analysis.

完成本页后，你将能在 Claude Code 或 Codex 中用一句自然语言触发 Brain Creator，并看到带来源引用的需求分析。测试不会在你批准前执行。

## Prerequisites

- Node.js 20 or later.
- Claude Code or Codex installed and able to open the target project.
- A writable project directory.
- A local requirement file, an HTTP(S) page, or a Feishu document link.

You do not need PostgreSQL, Redis, a Web UI, or a separate Brain Creator account.

## 1. Install

Run these commands from the business project you want Brain Creator to work in:

```bash
npm install --save-dev brain-creator
npx brain-creator --version
```

Expected result: the version command prints the installed package version.

## 2. Initialize The Project

Use `host-agent` when the current Claude Code or Codex session should perform Planner, Generator, and Healer tasks itself:

```bash
npx brain-creator init --provider host-agent
```

The command installs project-local Skill and Playwright Agent assets and creates or updates `.mcp.json`. Existing custom assets are skipped unless you explicitly use `--force`.

Codex users can add the packaged plugin entrypoint:

```bash
npx brain-creator plugin install
```

Restart the host after changing MCP or plugin configuration.

## 3. Verify The Environment

```bash
npx brain-creator doctor
```

Check these results before continuing:

| Check | Ready means |
|---|---|
| Agent provider | `host-agent`, `claude`, or `codex` is resolved intentionally |
| Browser | Playwright Chromium or a supported local Chrome/Edge is available |
| Tool profile | `facade` is selected for normal Agent use |
| Knowledge directory | The resolved directory is writable |
| Feishu connector | Either direct credentials are complete or host fallback is available |

If any required check fails, follow the remediation printed by `doctor` or use [Troubleshooting](troubleshooting.md).

## 4. Send The First Request

Open Claude Code or Codex in the same project and send:

```text
用 Brain Creator 分析这个需求文档，生成需求分析、覆盖矩阵、测试数据和测试意图，等我确认后再执行：<文件路径或链接>
```

English equivalent:

```text
Use Brain Creator to analyze this requirement, generate traceable coverage, test data, and test intent, and wait for my approval: <path or URL>
```

Brain Creator should use the high-level Facade entrypoints. You should not need to request a specific `bc_*` tool.

## 5. Review The Result

The first useful response should include:

- the requirement source and version or hash;
- modules, actors, fields, rules, workflows, and states found in the source;
- source references for generated knowledge and TestIntents;
- missing branches, contradictions, and questions that need confirmation;
- proposed TestDataProfiles;
- coverage and Requirement Eval status;
- the recommended next action.

Brain Creator must not approve the baseline or execute a real system without your confirmation.

## 6. Continue Safely

When the analysis is correct, say:

```text
确认这些澄清结果并重新评估；通过后让我审批需求基线。
```

After the baseline is approved, bind a real system:

```text
将这个需求基线绑定到 <system URL>，先检查鉴权并探索系统，不要提交业务表单。
```

Continue with [Requirement to test](guides/requirement-to-test.md) for system exploration, test-data preparation, execution, and evidence review.

## Essential Commands

| Command | Purpose |
|---|---|
| `brain-creator init --provider host-agent` | Install project assets and MCP configuration |
| `brain-creator doctor` | Diagnose provider, browser, connector, and workspace readiness |
| `brain-creator config` | Show the redacted effective configuration |
| `brain-creator config write --provider codex` | Update MCP configuration intentionally |
| `brain-creator plugin install` | Install the project-local Codex plugin entrypoint |
| `brain-creator mcp` | Start the MCP server over stdio |
| `brain-creator help legacy` | List compatibility executables |

See [CLI reference](cli-reference.md) for all options.

## Next Steps

- Learn the mental model in [Core concepts](core-concepts.md).
- Run the complete workflow in [Requirement to test](guides/requirement-to-test.md).
- Configure subprocess or host-agent execution in [MCP installation](mcp-installation.md).
- Resolve setup problems with [Troubleshooting](troubleshooting.md).
