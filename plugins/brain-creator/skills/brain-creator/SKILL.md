---
name: brain-creator
description: 当用户要求使用 Brain Creator 时触发：接入业务系统、配置鉴权、管理术语/业务规则、生成测试计划、运行智能体原生测试、查看产物或处理 Gap。When the user asks to use Brain Creator, connect a business system, configure auth, manage glossary or business rules, generate reviewed test plans, run agent-native tests, inspect artifacts, or handle gaps.
---

# Brain Creator

Use Brain Creator as an agent-native testing business brain through MCP tools. Claude Code or Codex is the user interface; Brain Creator supplies system context, auth handling, business language, planning, generated artifacts, chain execution, and gap tracking.

Agent bridge policy: Brain Creator may run Planner / Generator / Healer through Claude Code subprocess, Codex subprocess, host-agent task handoff, or disabled preview-only mode. Prefer `bc_status` or `bc_session_resume` to inspect bridge state before confirmed execution. If bridge state is blocked, report the blocker or create a Gap instead of waiting on a long timeout. In host-agent mode, `bc_prepare_agent_task` and approved `bc_run_chain` calls return `status: "needs_agent_execution"` task packages. Read `input.prompt.md` and `input.context.json`, create the requested outputs as the current agent, then call `bc_submit_agent_output`; linked chain tasks will record AgentRun, ChainRun, and generated artifact ownership after successful submission.

## 入口路由（Entry Routing）

用户通过两种方式使用 Brain Creator。每次用户消息到达时自动判断入口模式。

| | 🗣 自然语言（Natural Language） | ⚡ 快速维护（Quick Maintenance） |
|---|---|---|
| **触发方式** | 自由描述测试需求 | 描述已有用例的操作意图，如"查看状态""跑高优先级用例""修复失败" |
| **适用场景** | 新系统接入、新需求探索、首次生成测试 | 已有用例的维护、执行、状态查询、Gap 处理 |
| **用户心智** | "我不知道有什么，你帮我弄" | "我知道我要什么，快速操作" |

### 自动路由规则

```
用户消息到达
  ├─ 意图清晰指向已有用例维护？
  │   （如"跑一下"、"状态怎么样"、"有哪些Gap"、"修复失败"）
  │   └─ 是 → ⚡ 快速维护路由：直接查询状态 + 给出执行建议
  │
  ├─ 意图清晰指向新系统/新需求？
  │   （如"接入"、"connect"、"新系统"、"生成测试"、"帮我测"）
  │   └─ 是 → 🗣 自然语言路由：按 One-Sentence Workflow 执行
  │
  └─ 意图模糊，无法判断？
      → 主动提示用户当前系统状态，并给出下一步建议
```

> **注意：** 自然语言仍是推荐入口。若用户明确输入 `/bc ...`，调用 `bc_command` 解析最小快捷命令：`/bc status`、`/bc run "<path>"`（可带 `--case`、`--module`、`--priority`）、`/bc continue`、`/bc bugs`、`/bc gaps`、`/bc regress bugs`（可带 `--bug`、`--module`、`--priority`）、`/bc review suite`。`bc_command` 会转发到对应 Facade 工具；不要让用户手动编排底层 `bc_*` 工具。

---

## Facade-First Tool Policy

Default to the high-level facade tools. The fine-grained `bc_*` tools remain available for compatibility, debugging, audit, and fallback, but the user should not have to orchestrate them. `bc_status` returns `toolGuidance`; follow it before reaching for internal tools.

## User Entrypoint Map

| User intent | Default tool path | Confirmation boundary | Reply focus |
|---|---|---|---|
| Check current system state | `bc_status` | None | Prefer `statusMarkdown`; summarize system, auth, suites, bugs, gaps, artifacts, and next action. |
| Connect a new system | `bc_configure target=system` | Confirm name, environment, base URL, and allowlist before creation. | Return system id and setup recommendations. |
| Configure auth | `bc_configure target=auth` | Never echo secrets; keep sensitive values only in the tool input. | Return redacted auth state and verification result. |
| Wait for manual login, CAPTCHA, recovery, or 2FA | `bc_configure target=checkpoint` | Continue only after the user says the checkpoint is complete. | Explain why execution is waiting and how to resume. |
| Preview ambiguous operational wording | `bc_intent_preview` | Preview only; do not execute. | Show the suggested facade call, parameters, and risks. |
| Preview a test document suite | `bc_run mode=case-source-suite confirm=false` | Required before execution. | Show counts, module and priority stats, sample cases, bridge state, and risks. |
| Execute a confirmed test document suite | `bc_run mode=case-source-suite confirm=true` | Requires prior preview; Excel write-back also requires explicit write-back confirmation. | Report suite results, BugReports, Gaps, and evidence paths. |
| Continue an unfinished suite | `bc_status` then `bc_run mode=case-source-suite confirm=true` | Confirm the latest unfinished suite is the intended target when ambiguous. | Report rerun results and remaining blockers. |
| Regress open bugs | `bc_run mode=bug-regression` | No plan approval required; make any `bugIds`, `modules`, and `priorities` filters visible. | Report candidates, pass/fail/blocked counts, and `regressionMarkdown`. |
| Review bugs, gaps, artifacts, cases, or suites | `bc_review target="bug"`, `bc_review target="gap"`, or the matching target | None | Prefer `reviewMarkdown` for concise replies, use `reviewSummary` for structured reasoning, and include `reportMarkdown` only when useful. |
| Record an external blocker or missing evidence | `bc_report_gap` | Require reason, severity, and owner context. | Return the Gap id, status, and next handling suggestion. |

0. For ambiguous natural-language operational requests, use `bc_intent_preview` to map the user wording to a suggested facade call. It must not execute; present the preview and keep the approval boundary for document suites. It can preview document-suite filters (`caseNos`, `modules`, `priorities`), open bug review, open bug regression, and suite continuation.
1. Use `bc_status` as the first call in a new session. Prefer `systemId` when known; otherwise pass `systemName` and, when needed, `environment`. The Facade tools `bc_status`, `bc_run`, and `bc_review` all support this system resolution. If multiple systems match, ask the user to choose instead of guessing. Prefer `statusMarkdown` for concise user-facing status replies, then inspect structured fields only when the user asks for detail.
2. Use `bc_configure` for high-level setup of systems, auth, terms, rules, and auth checkpoints.
3. Use `bc_run` for execution:
   - `mode: "approved-case"` for an already approved case.
   - `mode: "full-workflow"` when the user says "confirm and run" for a draft case.
   - `mode: "case-source-suite"` when the user supplies an `.xlsx` or `.md` test case document path.
   - `mode: "bug-regression"` when the user asks to retest open bugs.
4. Use `bc_review` for suite runs, cases, bugs, gaps, and artifacts. Prefer `reviewMarkdown` for concise user-facing replies, inspect `reviewSummary` for structured status and next actions, and use `reportMarkdown` or `regressionMarkdown` only when the user needs a detailed handoff.
5. Use internal tools such as `bc_generate_plan`, `bc_run_chain`, `bc_list_gaps`, or `bc_read_spec` only when a facade lacks the needed detail or the user is debugging/auditing.

When the user provides a test case document path, first call `bc_run` with `mode: "case-source-suite"` and `confirm: false`. Present the preview summary, risks, bridge status, and sample cases. Only after explicit user confirmation call the same mode with `confirm: true`.

Document source details:
- Supported inputs are local `.xlsx`, executable `.md` tables, `obsidian:<path>`, `claudian:<path>`, and `[[path]]`.
- For Obsidian/Claudian-style references, keep the original source reference in Brain Creator assets; do not paste the full document content into chat.
- If the user asks to run only specific cases, modules, or priorities, pass `caseNos`, `modules`, and `priorities` to `bc_run mode="case-source-suite"`. These filters are intersected. Preview with the same filters before asking for confirmation.
- Do not write results back to a source document by default. Only when the user explicitly asks to update Excel/source results, pass both `writeBack: true` and `confirmWriteBack: true`. Write-back currently supports local `.xlsx` only, updates actual result, case status, and BugID, and returns `backupPath` for the pre-write backup.
- To continue an interrupted or failed suite, first call `bc_status` and inspect `suites.unfinished`. Prefer `bc_run mode="case-source-suite"` with `resume: true` and `confirm: true`; Brain Creator reuses the latest unfinished suite's `source` and `suiteId` and reruns only cases that have not passed. Use explicit `source` + `suiteId` only when the user selects a specific older suite.
- For bugs, call `bc_review target="bug"` to get a status summary, regression candidates, BugReport list, and `reportMarkdown`. When the user asks to regress open bugs, call `bc_run mode="bug-regression"`; pass `bugIds`, `modules`, and `priorities` when the user narrows the regression scope. These filters are intersected. Include the returned `regressionMarkdown` in the handoff when useful.

---

## One-Sentence Workflow

When the user gives a request such as "Use Brain Creator to connect this CRM and generate tests for order approval":

1. Find or create the target business system. Prefer `bc_status` when `systemId` is known; otherwise use existing system discovery or `bc_configure target=system`.
2. If auth is needed, use `bc_configure target=auth`; never echo secrets back to chat. For password, recovery, CAPTCHA, or 2FA that must be completed by the user, use `bc_configure target=checkpoint`.
3. Capture known business language and quality gates with `bc_configure target=term` and `bc_configure target=rule`.
4. For a natural-language requirement, generate a draft plan through the existing planning flow, present it to the user, and wait for approval before code generation.
5. When the user says "approve and run" or "确认并执行", prefer `bc_run mode=full-workflow`.
6. When the user provides a test case document path, prefer `bc_run mode=case-source-suite confirm=false`; include `caseNos`, `modules`, or `priorities` when the user narrows the scope. After explicit confirmation, call `bc_run mode=case-source-suite confirm=true` with the same filters.
7. Use `bc_review` to summarize suite runs, cases, bugs, gaps, and artifacts when reporting outcomes or continuing later. Read `reviewSummary` first because suite, bug, gap, and artifact reviews normalize `title`, `status`, `metrics`, `evidencePaths`, `nextAction`, and `userMessage`. For detailed suite-run or BugReport handoff, include `reportMarkdown`; after bug regression, include `regressionMarkdown` when useful.
8. If an external preflight, auth, bridge, or evidence issue blocks execution, create/report a Gap instead of claiming success.

Users should not need to say `Skill("brain-creator")`. Treat natural-language requests such as "Use Brain Creator to connect this system", "用 Brain Creator 接入这个系统", "generate a reviewed test plan", "run the approved chain", or "show open gaps" as Brain Creator entrypoints. Keep `Skill("brain-creator")` only as an explicit fallback when automatic skill matching fails.

Do not create or prioritize a Web UI. If the user asks for an entrypoint, treat the entrypoint as natural conversation plus this skill and the Brain Creator MCP tools.

## System

Use the Brain Creator system tools to create and inspect reusable business system contexts.

1. Call `bc_list_systems` before assuming a system already exists.
2. Call `bc_create_system` when a user wants to connect a Web system and provides a system name, environment, base URL, default locale, and URL allowlist.
3. Call `bc_system_overview` to summarize onboarding completeness and asset counts.
4. Call `bc_archive_system` only when the user confirms a system should be retained for history but no longer used.

Never mix assets across systems. Every later Brain Creator action must use the selected system id.

## Auth

Use the auth tools to store credentials without exposing secrets in later conversation.

1. Call `bc_create_auth` with the selected system id as `projectId`.
2. Call `bc_verify_auth` after creating the profile.
3. Call `bc_list_auth` when you need to inspect configured profiles for the selected system.
4. Call `bc_generate_seed` only when a local Playwright seed fixture is needed for Planner or Generator execution.
5. Do not repeat raw token, cookie, or password values after the tool call.
6. Call `bc_create_auth_checkpoint` when the user must manually complete password, recovery, CAPTCHA, or 2FA.
7. Call `bc_complete_auth_checkpoint` after the user confirms the protected step is complete, or `bc_cancel_auth_checkpoint` when they stop.
8. Call `bc_archive_auth` when an auth profile should be retained for history but no longer used.

Supported `loginMethod` values are `password`, `cookie`, `token`, and `script`. Returned auth profiles redact all secrets. Auth checkpoints contain reasons and resume instructions only; never put credentials or verification codes in them.

## Glossary

Use glossary tools to keep business language reusable across planning and generation.

1. Call `bc_add_term` for known domain terms before planning.
2. Include aliases and `pageScope` when a term only applies to part of the system.
3. After `bc_generate_plan`, review `testCase.newTerms` with the user.
4. Call `bc_batch_confirm_terms` with confirmed candidate ids and ignored candidate ids.
5. Call `bc_update_term` when the user corrects wording, aliases, or page scope.
6. Call `bc_delete_term` when the user says a term should not be reusable system knowledge.
7. Call `bc_list_terms` to show the updated glossary.

Do not silently add every candidate term. Do not delete terms without explicit user confirmation.

## Rules

Use rules to capture business quality gates before planning tests.

1. Call `bc_add_rule` for requirements that must be checked in generated scenarios.
2. Use `severity: "block"` for required coverage.
3. Use `severity: "warn"` for advisory checks.
4. Call `bc_list_rules` before generating a plan.
5. Call `bc_delete_rule` only after the user confirms the rule no longer applies to the selected system.

Quality gate checks are deterministic in v2 MVP, so rules should use clear domain terms such as order amount or payment status.

## Plan

Use planning tools to generate structured scenarios before code generation.

1. Confirm the target system id.
2. Ensure auth and business rules exist.
3. Call `bc_generate_plan` with `systemId` and the user's requirement.
4. Present the draft scenarios, new term candidates, and rule check results to the user.
5. Call `bc_update_plan` if the user wants to edit scenarios before approval.
6. Call `bc_approve_plan` only after the user confirms the test intent.
7. Call `bc_cancel_plan` when the user stops or closes a protected flow.
8. Call `bc_resume_plan` only after awaiting manual auth checkpoints are completed or cancelled.

Planning must not generate test code directly. The user should confirm the structured plan first. Approved plans are execution contracts and should not be changed silently.

## Run

Use run tools only after a test case is approved.

1. Confirm the test case has `status: "approved"`.
2. Call `bc_run_chain` with the approved `caseId`.
3. If `bc_run_chain` returns `status: "needs_agent_execution"` in host-agent mode, execute the returned task package yourself, write the requested output file, then call `bc_submit_agent_output`. Do not wait for a Claude or Codex subprocess. A successful submission records the linked chain run and generated artifact ownership.
4. Call `bc_list_chain_runs` when you need execution history for the selected system.
5. Report ChainRun status, generated spec path, generated test path, healer attempts, and any gaps.

Use `bc_run_agent` only when debugging a single Planner, Generator, or Healer run. It records an AgentRun but does not replace the approved-case execution flow. If the chain fails after healing attempts, treat returned gaps as work items rather than claiming the test is complete.

## Assets And Gaps

Use asset tools to inspect what has already been created for a business system.

1. Call `bc_list_cases` with `systemId` when the user asks for test history.
2. Call `bc_list_agent_runs` with `systemId` when the user asks for Planner, Generator, or Healer run history.
3. Call `bc_list_chain_runs` with `systemId` when the user asks for generator/test/healer chain history.
4. Call `bc_list_specs` and `bc_list_tests` with `systemId` when the user asks for generated spec or test file paths.
5. Call `bc_read_spec` or `bc_read_test` only for paths returned by the list tools.
6. Call `bc_artifact_overview` when the user needs a concise generated-artifact summary without inspecting raw paths first.
7. Call `bc_list_gaps` with `projectId` and optional `status` when the user asks what is blocked.
8. Call `bc_resolve_gap` only after the user confirms a gap has been handled.
9. Call `bc_report_gap` when an external preflight or manual workflow issue cannot be inferred from an existing chain.
10. Call `bc_list_auth_checkpoints` when the user asks what manual authentication work is still waiting.
11. Call `bc_search_assets` with `projectId` and a short query for broad asset lookup.
12. Keep results scoped to the current system.

Asset search is for review and traceability. It is not a substitute for user approval of a generated plan.

## Guardrails

- Never skip plan approval before code generation.
- Never fabricate missing evidence; create or report gaps through `bc_report_gap`, `bc_list_gaps`, and `bc_resolve_gap`.
- Never mix assets across systems. All planning, execution, search, and gap handling must use the selected system id.
- Use `bc_run_agent` only for diagnostics; the normal user workflow is `bc_generate_plan` to `bc_approve_plan` to `bc_run_chain`.
- Treat generated artifacts as local workspace assets. Use `bc_read_spec` and `bc_read_test` only for paths returned by Brain Creator list tools.
- Never store passwords, recovery codes, CAPTCHA answers, or 2FA values in auth checkpoints, gaps, plans, or artifacts.
- **工具透明度（Tool Transparency）：** 默认不主动列出工具名，用自然语言描述行为。但当用户追问操作细节、调试失败、做 Eval 或审计时，必须说明调用了哪些 MCP 工具、产出了哪些资产和 Gap。Brain Creator 应当可控、可审计、可复盘。
