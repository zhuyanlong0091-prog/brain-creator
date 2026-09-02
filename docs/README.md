# Brain Creator Documentation

Brain Creator turns requirements into traceable, reviewable, and executable Agent testing workflows for Claude Code and Codex.

Search the published site at <https://zhuyanlong0091-prog.github.io/brain-creator/>. The complete Simplified Chinese documentation is available under `/zh-CN/`.

This documentation is organized by what you are trying to accomplish. Start with one successful workflow, then read concepts and references only when you need them.

## Start Here

| Goal | Read |
|---|---|
| Install Brain Creator and analyze one requirement | [Quickstart](getting-started.md) |
| Understand the product model and safety boundaries | [Core concepts](core-concepts.md) |
| Take an approved requirement through real execution | [Requirement to test](guides/requirement-to-test.md) |
| Change auth, compile, page binding, or Gap state safely | [Trusted control plane](guides/trusted-control-plane.md) |
| Inspect storage health or export a Suite | [Storage and evidence](guides/storage-and-evidence.md) |
| Connect Claude Code, Codex, or another MCP host | [MCP installation](mcp-installation.md) |
| Look up a CLI command or option | [CLI reference](cli-reference.md) |
| Diagnose a setup or execution failure | [Troubleshooting](troubleshooting.md) |
| Understand recovery, auth refresh, reconciliation, and stability controls | [Reliability controls](quality/reliability-controls.md) |
| Integrate system-specific test data operations | [Testdata providers](guides/testdata-providers.md) |
| Understand cross-case data dependencies and compilation | [Testcase and Testdata Brain](guides/testcase-testdata-brain.md) |

## Choose A Workflow

### I have a requirement document

Use the requirement-first workflow. Brain Creator reads the source, creates traceable analysis and test intent, waits for approval, then binds the result to a real system.

Start with [Quickstart](getting-started.md), then continue with [Requirement to test](guides/requirement-to-test.md).

### I already have Excel or Markdown test cases

Use the document-suite compatibility workflow. Brain Creator previews the document, reports parsing and execution risks, asks once for confirmation, then executes the suite in source order.

See [Existing test case documents](agent-usage.md#existing-test-case-documents).

### I need to connect a real system

Create or reuse a SystemProfile, configure authentication, and let Brain Creator collect bounded System Brain evidence before compiling executable cases.

See [Bind a real system](guides/requirement-to-test.md#5-bind-a-real-system).

### A run failed

Start with [Troubleshooting](troubleshooting.md). Then use Brain Creator review commands to distinguish a product Bug from an automation, test-data, auth, environment, network, or evidence Gap.

## Learn The Product

- [Core concepts](core-concepts.md): the mental model and lifecycle.
- [Agent usage guide](agent-usage.md): detailed Facade behavior and approval rules.
- [Trusted control plane](guides/trusted-control-plane.md): safe state changes and bounded Facade responses.
- [Storage and evidence](guides/storage-and-evidence.md): schema 21 migration, evaluation integrity, shard layout, doctor checks, manifests, and Suite exports.
- [Session resume workflow](e2e-session-resume-workflow.md): restoring state in a new Agent session.
- [v2 low-level quickstart](v2-quickstart.md): compatibility reference for internal `bc_*` tools.

## Reference

- [CLI reference](cli-reference.md)
- [MCP installation and configuration](mcp-installation.md)
- [Machine-readable documentation index](llms.txt)
- [Release checklist](release-checklist.md)
- [Execution quality register](quality/problem-register.md)
- [Real-system regression samples](quality/real-system-regression.md)
- [Reliability controls](quality/reliability-controls.md)
- [Testdata providers](guides/testdata-providers.md)
- [Testcase and Testdata Brain](guides/testcase-testdata-brain.md)
- [Release notes 2.1.1](release-notes-2.1.1.md)
- [Release notes 2.0.3](release-notes-2.0.3.md)
- [Release notes 2.0.2](release-notes-2.0.2.md)

## 中文导航

- 第一次使用：阅读[快速开始](getting-started.md)。
- 在线搜索：[Brain Creator 中文文档](https://zhuyanlong0091-prog.github.io/brain-creator/zh-CN/)。
- 理解需求脑、系统脑和执行门禁：阅读[核心概念](core-concepts.md)。
- 从需求走到真实测试：阅读[需求到测试指南](guides/requirement-to-test.md)。
- 查询命令：阅读 [CLI 参考](cli-reference.md)。
- 安装或执行失败：阅读[故障排查](troubleshooting.md)。

All generated runtime knowledge and evidence stays under `.brain-creator/` by default and must not be committed or published.
