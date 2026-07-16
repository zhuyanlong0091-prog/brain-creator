---
name: brain-creator
description: Use Brain Creator when a user provides a requirement document, Feishu link, Web requirement, test-case document, or asks to prepare, approve, execute, or review agent-native tests. 当用户要求分析需求、沉淀业务知识、设计测试、执行测试或复盘证据时使用。
---

# Brain Creator

Brain Creator is a requirement-driven, agent-native testing business brain for Claude Code and Codex. The host Agent is the user interface. Do not create or prioritize a Web UI.

The recommended entrypoint is a requirement document or link. Existing Excel/Markdown test cases remain a compatibility entrypoint. Users should not need to know MCP tool names or say `Skill("brain-creator")`; keep `Skill("brain-creator")` only as an explicit fallback.

## Core Rules

- Keep every knowledge asset and execution asset isolated by `knowledgeProjectId` or `systemId`.
- Keep approved requirement expectations separate from observed system behavior and test results.
- Do not approve a baseline with unresolved clarification Gaps.
- Do not execute before the baseline is approved, cases are compiled, a system is bound, and auth is ready.
- Do not invent navigation, locators, data, expected results, or evidence. Create a Gap when evidence is missing or more than one workflow path is plausible.
- Never echo passwords, tokens, cookies, storage state, Feishu secrets, or verification codes.
- Do not retry a cancelled or denied facade call through an equivalent fine-grained tool.

## Facade-First Tool Policy

New installations use `BRAIN_CREATOR_TOOL_PROFILE=facade`. Prefer these high-level tools:

- `bc_prepare`: ingest requirements, generate analysis and test design, approve baselines, compile cases, and record system observations.
- `bc_status`: inspect knowledge projects or runtime systems and choose the next action.
- `bc_configure`: create knowledge projects, systems, auth, rules, terms, bindings, checkpoints, and inspect connectors.
- `bc_run`: preview or execute requirement suites, approved cases, document suites, and bug regression.
- `bc_review`: review requirements, knowledge, coverage, test intents, executable cases, evidence, suites, bugs, and Gaps.
- `bc_intent_preview`: preview ambiguous operational wording without executing it.
- `bc_submit_agent_output`: return Planner, Generator, or Healer output in host-agent mode.
- `bc_command`: optional `/bc help`, status, suite, bug, and Gap shortcuts.

Fine-grained tools remain available with `BRAIN_CREATOR_TOOL_PROFILE=full` for compatibility, audit, and debugging.

## User Entrypoint Map

| User intent | Default Agent path | Approval boundary |
|---|---|---|
| Analyze a local requirement, DOCX, PDF, or Web page | `bc_configure target=knowledge-project` then `bc_prepare action=ingest-requirement` | Generated knowledge stays draft |
| Analyze a Feishu Wiki/Doc | `bc_prepare action=ingest-requirement` | Use direct OpenAPI or host content-package fallback |
| Generate requirement analysis and tests | `bc_prepare action=generate-test-design` | Review coverage, Gaps, and data before approval |
| Approve and compile | `bc_prepare action=approve-baseline confirm=true`, then `compile-cases` | Explicit user confirmation required |
| Bind a real system | `bc_configure target=system`, then `bc_configure target=system-binding` | Confirm environment and allowlist |
| Configure auth | `bc_configure target=auth` or `bc_configure target=checkpoint` | Never expose secrets |
| Execute approved requirement cases | `bc_run mode=requirement-suite` | Preview first, then `confirm: true` |
| Execute an existing test document | `bc_run mode=case-source-suite confirm=false`, then `bc_run mode=case-source-suite confirm=true` | Explicit confirmation required |
| Regress bugs | `bc_run mode=bug-regression` | Show filters and candidates |
| Review status | `bc_status`, then `bc_review target="bug"` or `bc_review target="gap"` | Read-only |
| Record an external blocker | `bc_report_gap` | Include reason, severity, owner, and evidence context |

Use `statusMarkdown` and `reviewMarkdown` when present for concise replies. `/bc help` is optional shorthand, not the primary product entrypoint.

## Requirement-First Workflow

When the user provides a requirement path or URL:

1. Find or create a knowledge project with `bc_configure target=knowledge-project`. Do not require a runtime system yet.
2. Call `bc_prepare action=ingest-requirement` with the source.
3. Call `bc_prepare action=generate-test-design` using `provider=builtin` by default.
4. Present requirement coverage, open questions, risks, test techniques, TestIntents, and TestDataProfiles.
5. Resolve clarification Gaps. After explicit approval, call `bc_prepare action=approve-baseline confirm=true`.
6. Compile approved TestIntents with `bc_prepare action=compile-cases`.
7. Create or select a runtime system with `bc_configure target=system`, then bind it with `bc_configure target=system-binding`.
8. Configure and verify auth. Use `bc_create_auth_checkpoint` for password, CAPTCHA, recovery, or 2FA intervention.
9. Preview with `bc_run mode=requirement-suite confirm=false`; execute only after confirmation with `bc_run mode=requirement-suite confirm=true`.
10. Use `bc_review` to report evidence, BugReports, Gaps, and requirement-versus-observation conflicts.

Do not let observed system behavior overwrite approved requirements. Submit observed rules or workflows with `bc_prepare action=record-observation`, including evidence `sourceRefs`. Conflicts must remain visible and block execution until resolved.

## Requirement Sources

Supported first-party adapters:

- Local `.md`, `.txt`, `.docx`, and `.pdf` files.
- Public HTTP(S) pages; private-network URLs require explicit `allowPrivateNetwork=true`.
- Obsidian references such as `obsidian:<path>` and `[[path]]`.
- Feishu Wiki/Doc links.

For Feishu, prefer direct OpenAPI when both `BRAIN_CREATOR_FEISHU_APP_ID` and `BRAIN_CREATOR_FEISHU_APP_SECRET` are configured. Otherwise use the host lark capability and retry with a `RequirementContentPackage`. Unsupported tables, sheets, diagrams, whiteboards, and attachments must create Gaps. Never store Feishu credentials in Brain Creator assets.

If `RequirementAnalysis.skill` or `TestCaseDesign.skill` is available and useful, the host may call it and submit normalized output with `provider=host-skill`. Host Skill output must include source references and still pass Brain Creator schema validation, Eval, Gap, and approval gates. Builtin policies must remain fully functional without those Skills.

## Test-Document Compatibility

When the user supplies `.xlsx` or executable `.md` test cases:

1. Call `bc_run mode=case-source-suite confirm=false`.
   The structured Facade payload uses `confirm: false` for preview.
2. Show counts, modules, priorities, filters, samples, bridge state, and risks.
3. Wait for explicit confirmation.
4. Call `bc_run mode=case-source-suite confirm=true` with the same filters.
   The confirmed payload uses `confirm: true`.
5. In host-agent mode, execute every returned `needs_agent_execution` package and call `bc_submit_agent_output` until completed, failed, or blocked.
6. Use `bc_review` for SuiteRun, ChainRun, BugReport, Gap, and artifact evidence.

Document suites stop on the first environment, auth, locator, or evidence Gap unless the user explicitly selects `continueOnBlocked: true`. Do not write results back to Excel unless both `writeBack: true` and `confirmWriteBack: true` are explicit.

## Host-Agent And Bridge

Codex plugin mode normally uses `host-agent`. Treat `needs_agent_execution` and `waiting-for-agent` as actionable work, not a missing AgentBridge. Read the task prompt/context, write only requested outputs, then call `bc_submit_agent_output`.

Subprocess modes may use Claude or Codex. Check bridge readiness with `bc_status` or `brain-creator-doctor` before confirmed execution. If unavailable, report the blocker immediately instead of waiting for a long timeout.

Generator writes Playwright tests, Playwright executes them, and Healer performs bounded repairs. Business mismatches create BugReports. Auth, environment, locator, network, and missing-evidence blockers create Gaps.

## System

- Use `bc_list_systems` only in full-profile discovery or debugging.
- Prefer `bc_configure target=system` for creation and `bc_status` for selection.
- Never mix knowledge or assets across systems.
- The natural-language phrase `Use Brain Creator to connect this system` is a valid entrypoint.

## Auth

- Prefer `bc_configure target=auth`; `bc_create_auth` remains an internal compatibility tool.
- Verify saved auth and use workspace-local storage state under `.brain-creator/auth/`.
- `bc_create_auth_checkpoint` pauses protected login work safely.

## Glossary

- Prefer `bc_configure target=term`.
- Internal compatibility tools include `bc_add_term`, `bc_batch_confirm_terms`, and term update/delete tools.
- Terms belong to the selected system or knowledge context and must retain source scope.

## Rules

- Prefer `bc_configure target=rule`.
- Internal compatibility tools include `bc_add_rule`, rule listing, and `bc_delete_rule`.
- Blocking rules are quality gates; warning rules are advisory.

## Plan

- Requirement-first planning uses `bc_prepare` and approved TestIntents.
- Legacy natural-language planning keeps `bc_generate_plan`, `bc_approve_plan`, and `mode: "full-workflow"` for compatibility.
- Do not generate test code before approval.

## Run

- Prefer `bc_run` modes `requirement-suite`, `approved-case`, `full-workflow`, `case-source-suite`, and `bug-regression`.
- `bc_run_chain` remains an internal compatibility tool.
- Preserve every AgentRun, ChainRun, SuiteRun, screenshot, trace, console/network result, assertion, and inference source.

## Assets And Gaps

- Prefer `bc_review` and `bc_status`.
- Internal audit tools include `bc_artifact_overview`, `bc_search_assets`, and `bc_list_gaps`.
- A failed run with a precise Gap is valid. Fabricated success is not.

## One-Sentence Workflow

Recommended prompts:

```text
Use Brain Creator to analyze this requirement document, generate test design and data, and wait for my approval.
```

```text
用 Brain Creator 分析这个飞书需求链接，沉淀知识并生成可审核的测试意图。
```

```text
Use Brain Creator to connect this system, bind the approved requirement baseline, and preview the executable suite.
```

```text
Use Brain Creator to execute this test case document and report bugs, gaps, and evidence.
```

The Agent should use high-level Facades first, preserve approval boundaries, and return a human-readable summary rather than exposing raw MCP choreography.
