# From Requirement To Executed Test

Take one requirement source through analysis, approval, system binding, data preparation, execution, and evidence review.

This guide uses natural-language requests. Brain Creator selects Facade tools internally; tool names are included only to make the workflow auditable.

## Before You Start

Complete the [Quickstart](../getting-started.md) and make sure `brain-creator doctor` reports an intentional Agent provider and a usable browser.

Prepare:

- a requirement file or link;
- the target system base URL and allowed URL scope;
- an authentication method or a plan for manual login;
- permission to create test data if the scenario cannot reuse existing data.

## 1. Ingest The Requirement

Ask:

```text
用 Brain Creator 导入并分析这个需求，保留来源引用，先不要执行：<path or URL>
```

Brain Creator creates or reuses a `KnowledgeProject`, ingests the source, records its hash and version, and builds draft knowledge.

Supported inputs include Markdown, TXT, DOCX, PDF, HTTP(S), Obsidian references, and Feishu Wiki/Doc links. Excel and Markdown test-case documents use the compatibility suite flow instead of the requirement-first flow.

**Verify:** the response identifies the source, version, parsing warnings, and knowledge project.

## 2. Review Analysis And Test Design

Brain Creator should present:

- atomic requirement clauses and source anchors;
- modules, actors, objects, fields, rules, workflows, states, permissions, and integrations;
- risks, contradictions, assumptions, and missing branches;
- TestIntents, test techniques, priorities, and expected results;
- TestDataProfiles and unresolved data dependencies;
- Requirement Eval coverage and required actions.

Answer clarifying questions with durable business evidence. Clarifications and missing branches can be confirmed with a note. Direct contradictions require revising the source or baseline.

**Verify:** every TestIntent references at least one requirement clause. Unsupported claims remain visible instead of being treated as facts.

## 3. Approve The Baseline

When the analysis is correct, say:

```text
确认以上澄清结果，重新运行 Requirement Eval；如果门禁通过，提交需求基线给我最终审批。
```

Then approve explicitly:

```text
批准该需求基线。下一步只绑定和探索系统，不执行测试。
```

**Verify:** the baseline status is approved and no confirmable or blocked Eval action remains.

## 4. Create Or Reuse A System

Ask Brain Creator to create or select a SystemProfile:

```text
将需求绑定到测试系统 <base URL>，环境为 test，URL 只允许访问 <allowlist>。
```

Knowledge projects can bind to multiple systems or environments. Runtime assets must never cross `systemId` boundaries.

**Verify:** the status response identifies both `knowledgeProjectId` and `systemId`.

## 5. Bind A Real System

Configure authentication before exploring protected pages. Use Token, Cookie, or a workspace-local Playwright storage-state reference when possible.

For password, CAPTCHA, recovery, or 2FA flows, Brain Creator creates an AuthCheckpoint and waits while the user or host Agent completes login. Do not send secrets in chat or persist them in generated tests.

Then ask:

```text
探索当前系统，默认只访问 allowlist 内链接，不提交表单。列出发现的页面、入口、定位点和阻塞项。
```

Exploration defaults to bounded, link-only navigation. Opt in to `interactionMode=safe` only when tab, disclosure, or native-select state evidence is needed. Complex menus and business workflows require host-Agent page or training evidence.

**Verify:** System Brain contains versioned page, locator, probe, and navigation evidence. Login pages, empty evidence, or unsafe transitions create a Gap.

## 6. Compile Executable Cases

Ask:

```text
基于已批准需求和当前 System Brain 编译可执行用例，展示所有补全动作的证据来源。
```

Brain Creator may complete an implicit action only when one unique observed path supports it. Multiple equivalent entries, missing targets, missing values, or missing locators block the case.

**Verify:** each step has requirement, workflow, page, locator, state-transition, or derived evidence. Review `pathPlan`, `statePlan`, and candidate counts.

## 7. Prepare Test Data

Preview the data plan first:

```text
为这些用例准备测试数据计划，优先复用已有数据；任何创建操作先等我授权。
```

If creation is necessary, approve it explicitly and require cleanup:

```text
允许为本次套件创建缺失数据，使用 delete-created 清理策略；先返回准备结果和稳定引用。
```

The host Agent performs lookup or creation and submits evidence-backed references. Brain Creator stores leases, not raw secrets.

**Verify:** dependencies are ordered, stable references exist, and created data has a cleanup obligation.

## 8. Preview And Run

Ask for a full preflight:

```text
预览 Requirement Suite。检查需求基线、系统、鉴权、页面证据、测试数据、开放 Gap 和执行计划，先不要执行。
```

After reviewing case count, order, blockers, and evidence, confirm once:

```text
确认执行该 Requirement Suite。
```

Brain Creator freezes each case's ExecutionPlan only after its data is ready. Generator creates Playwright tests, Playwright runs them, and Healer receives a bounded retry budget for automation failures.

**Verify:** `bc_status` shows the active suite, current case, waiting reason, recent ledger events, and next action.

## 9. Review Evidence

Ask:

```text
复盘本次套件，按用例展示步骤、输入、断言、截图或 trace、实际结果和失败分类。
```

A useful review separates:

- passed cases;
- verified product Bugs;
- automation and locator Gaps;
- data, cleanup, auth, environment, or network Gaps;
- skipped or cancelled cases;
- remaining regression work.

Use the RunLedger for the timeline and ExecutionEvidence for step-level proof. A Bug must include an approved expectation, actual mismatch, reproduction path, and evidence references.

System exploration also records browser surfaces discovered during capture. The System Brain can distinguish the main document, allowlisted iframe, open Shadow DOM, and Wujie-like container summaries. A URL-changing safe interaction is added to the exploration queue. Surface evidence is observational; it does not authorize writes or silently infer a cross-frame action.

Use `bc_review` with `target=coverage` to inspect the TestIntent execution ledger. Every intent is classified as strong-verified, limited, failed, blocked, not-selected, or superseded. The same response includes a source ledger with blocks, requirement revisions, knowledge nodes, intents, executable cases, evidence, and unread attachments. It also reports required, verified, and missing dimensions for `field`, `workflow`, `state`, `permission`, and `integration`. Use `repeatCount` on `bc_run mode=requirement-suite` for isolated stability iterations.

Suite exports are security-gated. Before a ZIP archive is written, Brain Creator scans available artifacts against the current system's protected credential values. If a report, trace metadata file, or generated test contains a saved Token/Cookie value, export stops and reports only the affected artifact path and credential field name.

## 10. Resume Or Regress

In a new Agent session, say:

```text
用 Brain Creator 恢复这个系统的上次会话，显示未完成套件、当前任务、开放 Bug/Gap 和推荐下一步。
```

For a verified Bug:

```text
回归当前系统中所有 open Bug，仍然先预览范围和鉴权状态。
```

Retry, skip, and cancel operations require preview followed by explicit confirmation. Previous attempts and evidence remain in history.

## Existing Test Case Documents

For an Excel or Markdown case file, use:

```text
用 Brain Creator 预览这个测试用例文档，告诉我总数、优先级、模块、缺失字段和执行风险，先不要运行：<path>
```

After confirmation, Brain Creator creates one ordered document suite. Business mismatches create BugReports; evidence or environment blockers create Gaps. The source document stays read-only unless result write-back is explicitly requested and supported.

## Next Steps

- Read [Core concepts](../core-concepts.md) for the asset model.
- Use [Troubleshooting](../troubleshooting.md) when a provider, browser, connector, auth, or execution gate blocks the flow.
- Use [Agent usage](../agent-usage.md) for detailed Facade and compatibility behavior.
