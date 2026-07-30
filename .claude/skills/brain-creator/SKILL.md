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

- `bc_prepare`: ingest requirements, generate analysis and test design, approve baselines, run bounded system exploration with link-only and opt-in safe-interaction modes, submit page/training evidence, refresh System Brain, compile evidence-bound cases, and record system observations.
- `bc_status`: inspect knowledge projects or runtime systems and choose the next action.
- `bc_configure`: create knowledge projects, systems, auth, rules, terms, bindings, checkpoints, and inspect connectors.
- `bc_run`: preview or execute requirement suites, approved cases, document suites, and bug regression.
- `bc_review`: review requirements, knowledge, coverage, Requirement Eval history, System Brain, test intents, executable cases, evidence, suites, bugs, and Gaps.
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
| Confirm Requirement Eval actions | `bc_prepare action=confirm-eval-actions confirm=true` | Present each action and preserve the user's `confirmationNote` |
| Approve a baseline | `bc_prepare action=approve-baseline confirm=true` | Explicit user confirmation required |
| Bind a real system | `bc_configure target=system`, then `bc_configure target=system-binding` | Confirm environment and allowlist |
| Explore a real system | `bc_prepare action=explore-system` | Link-only by default; explicit `interactionMode=safe` probes bounded tabs, disclosures, and native selects |
| Submit page/training evidence | `bc_prepare action=record-page-evidence` / `record-training-evidence` | Use real host-browser evidence inside the selected system allowlist |
| Refresh System Brain | `bc_prepare action=refresh-system-brain` | Preserve system isolation and evidence references |
| Compile against a system | `bc_prepare action=compile-cases` with `systemId` | Only a unique shortest observed path is compiled; ambiguous, unreachable, or missing evidence creates a Gap |
| Prepare test data | `bc_prepare action=prepare-test-data` | Preview first; reuse is default and create requires explicit `allowCreate=true` |
| Submit data or cleanup evidence | `bc_prepare action=submit-test-data` | Require stable references and non-empty `sourceRefs`; never expose secrets |
| Prepare execution | `bc_prepare action=prepare-execution` | Persist only a ready immutable plan; blocked and needs-confirmation drafts cannot start Generator |
| Configure auth | `bc_configure target=auth` or `bc_configure target=checkpoint` | Never expose secrets |
| Execute approved requirement cases | `bc_run mode=requirement-suite` | Preview first, then `confirm: true` |
| Execute an existing test document | `bc_run mode=case-source-suite confirm=false`, then `bc_run mode=case-source-suite confirm=true` | Explicit confirmation required |
| Regress bugs | `bc_run mode=bug-regression` | Show filters and candidates |
| Review status | `bc_status`, then `bc_review target="bug"`, `bc_review target="gap"`, `bc_review target=requirement-eval-accuracy`, `bc_review target=system-brain`, or `bc_review target=system-exploration` | Read-only |
| Record an external blocker | `bc_report_gap` | Include reason, severity, owner, and evidence context |

Use `statusMarkdown` and `reviewMarkdown` when present for concise replies. `/bc help` is optional shorthand, not the primary product entrypoint.

## Requirement-First Workflow

When the user provides a requirement path or URL:

1. Find or create a knowledge project with `bc_configure target=knowledge-project`. Do not require a runtime system yet.
2. Call `bc_prepare action=ingest-requirement` with the source.
3. Call `bc_prepare action=generate-test-design` using `provider=builtin` by default.
4. Present atomic clauses and their source anchors, typed coverage, unsupported claims, contradictions, missing branches, risks, test techniques, TestIntents, and TestDataProfiles. Do not collapse the result into one broad requirement summary.
5. Present each pending Eval action. For clarification or a missing branch, call `bc_prepare action=confirm-eval-actions confirm=true` with the selected `actionIds` and the user's non-empty `confirmationNote`. Never infer or fabricate that note.
6. A blocked contradiction cannot be confirmed. Ask the user to revise or refresh the requirement source, then regenerate the design.
7. Only after the Eval gate passes, call `bc_prepare action=approve-baseline confirm=true`.
8. Create or select a runtime system with `bc_configure target=system`, bind it with `bc_configure target=system-binding`, and configure verified auth.
9. Call `bc_prepare action=explore-system` to discover allowlisted pages, controls, and navigation links. Keep `interactionMode=off` unless safe state evidence is needed. With explicit user approval, use `interactionMode=safe` and a small `maxInteractionsPerPage` to observe tabs, disclosure controls, and native-select cascades. Use `record-page-evidence` and `record-training-evidence` for complex menus, data entry, and business workflows.
10. Compile approved TestIntents with `bc_prepare action=compile-cases` and the selected `systemId`. Inspect `workflowPath`: only `unique` or `not-required` may continue. For `ambiguous`, present `candidatePathCount` and the returned candidate details, then ask for evidence or selection; for `missing`, collect more System Brain evidence. Candidate details are capped at 10 to keep context bounded. Never select a path on the user's behalf.
11. Inspect `stateActions` after path planning. Only `unique` or `not-required` may continue. Present state candidates when ambiguous and collect missing input or locator evidence when blocked. Treat all domain scenarios as data: never add product-specific branches to the planner.
12. Inspect `testDataPlan`. For an existing reference, call `prepare-test-data confirm=false`, present the lookup and allowed decisions, then call it with `confirm=true` after approval. Reuse is the default. Set `allowCreate=true` only after explicit user authorization.
13. Execute the returned Host Agent task in the bound system. Call `submit-test-data` with its `taskId`, result, stable reference, and evidence `sourceRefs`. Created data requires `delete-created` or `restore`; provider failure creates a Gap. Never resolve structural data errors by inventing a value and never copy a secret into an executable step.
14. Call `prepare-execution confirm=false` and present every Requirement, System, Auth, Path, State, Data, Gap, and Cleanup check. Confirm only a ready draft. The plan freezes title, preconditions, ContextPack, steps, data bindings, and the auth reference. Identical semantic state reuses the immutable snapshot; blocked or needs-confirmation results cannot start Generator.
15. Preview with `bc_run mode=requirement-suite confirm=false`; execute only after confirmation with `bc_run mode=requirement-suite confirm=true`. Confirmation preflights every candidate before starting any case. Generator, Seed, and ExecutionEvidence consume the frozen plan. A stale hash at initial execution or `bc_submit_agent_output` must stop without task-submission side effects and return to `prepare-execution`.
16. Use `bc_review target=execution-plan`, `bc_review target=requirement-eval-accuracy`, `bc_review target=system-brain`, and `bc_review target=system-exploration` alongside evidence, BugReport, and Gap reviews.

Do not let observed system behavior overwrite approved requirements. Prefer `explore-system` before compilation, then use `refresh-system-brain` to derive observed pages, fields, navigation, state transitions, workflows, cascades, and API integrations from existing assets. Safe interaction mode must reject write-like labels and unstable selectors, block non-read HTTP methods and dangerous URLs, restore the page after every probe, and stay within the allowlist and interaction budget. Never submit forms, approve, delete, or publish. Disclose the residual risk that a misdesigned GET endpoint may have side effects. Submit additional observed rules or workflows with `bc_prepare action=record-observation`, including evidence `sourceRefs`. Conflicts must remain visible and block execution until resolved.

Workflow path planning is deterministic and evidence-only. Brain Creator may generate `origin=observed` navigation clicks from recorded navigation edges only when one shortest path connects an observed entry page to the selected target page. Equal shortest paths, target-page score ties, disconnected targets, and missing edge locators must remain blocked as Gaps.

State-action planning is also deterministic and domain-agnostic. It may reuse or insert a click/select step only from one relevant observed state transition with a stable locator and, for selects, a captured input value. Product names and business rules belong in requirement/System Brain data and test fixtures, never in planner code.

Test-data planning is deterministic and TestIntent-scoped. `fixed`, `generated`, and `unique` values may be proposed for user confirmation; `existing-reference` is prepared through an idempotent Host Agent task and an evidence-backed `TestDataLease`; `runtime-captured` requires declared dependencies; `secret-reference` stays a reference. Reuse is read-only by default. Creation requires explicit approval and a cleanup policy, and cleanup failures remain operational Gaps rather than product Bugs. Structural graph failures remain Gaps.

Execution Preflight is deterministic and read-only until confirmation. It creates a semantic hash over approved requirement state, system binding, optional explicit auth, frozen ContextPack, executable steps, path/state plans, data leases, open Gaps, and cleanup obligations. Persist only `verdict=ready`; never bypass a blocked or stale check with a lower-level execution tool. Keep secret material as references.

Historical Requirement Eval accuracy is an estimate, not a fabricated model score. Passed evidence and failed evidence linked to a BugReport validate the requirement expectation; unclassified semantic failures contradict it pending review; blocked, console, and network failures remain inconclusive. Report system conformance and traceability separately.

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

Treat `bc_status.readiness` as a three-state signal: `ready`, `action-required`, or `blocked`. Pending AgentTasks, unfinished suites, open BugReports, and open Gaps are `action-required`; Bridge or manual auth blockers are `blocked`. When suite progress includes an `activeTask`, continue that task before relying on an older failed case in `remainingCaseNos`.

After the bounded Healer attempt, create a BugReport only when the failure contains reliable business-result evidence. Generated test syntax, parser, index, locator, or missing-element evidence failures are automation/evidence Gaps. Use `automation_failure` and `locator_failure` review filters when diagnosing them.

## System

- Use `bc_list_systems` only in full-profile discovery or debugging.
- Prefer `bc_configure target=system` for creation and `bc_status` for selection.
- Refresh System Brain after page modeling or training changes. Repeated refreshes must be idempotent and isolated to the selected `systemId`.
- Compile with `systemId` so navigation and actions bind PageModel, LocatorPoint, and ProbeResult evidence instead of semantic guesses.
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
