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
- Do not invent navigation, locators, data, expected results, or evidence. Missing or ambiguous System Brain evidence creates an ExplorationTask first; only a failed exploration creates a Gap. Unresolved test data remains `needs-data`.
- Never echo passwords, tokens, cookies, storage state, Feishu secrets, or verification codes.
- Do not retry a cancelled or denied facade call through an equivalent fine-grained tool.

## L3 Trust Foundation

Repository schema 21 retains the L3 vocabulary and adds EvaluationTrial, SourceSnapshot, ProjectionManifest, and InterventionRecord. Before comparing providers, policies, or historical accuracy, start an evaluation trial that freezes the same requirement revision/hash, code revision, runtime versions, and an isolated Store path. Advance the projection only through an evidenced checkpoint. If the source, code, or Store changes out of band, report the Trial as invalidated and start a new one; never present its metrics as comparable. Persistence is not approval. Do not infer, announce, or write `verified` or `trusted` from a legacy ExecutableCase, a single Playwright pass, an LLM confidence value, or a semantic alias.

The built-in Alias Policy is domain-neutral and auditable. A term match such as `新增`/`新建`/`create` is only a candidate semantic relationship. Conditional behavior and multi-step expansion still require Requirement sources, System evidence, and the corresponding assurance gates. Use `bc_review target=business-scenario` to inspect generated scenario families, `bc_prepare action=assess-scenarios` to evaluate system/data/oracle readiness, and `bc_prepare action=record-scenario-run` only after a strong observed run. `verified` requires one unchanged strong run; `trusted` requires three. Mutation evaluation accepts recorded outcomes through `bc_prepare action=evaluate-mutations`; blocked outcomes are not counted as caught defects. Use the OnboardingPlan Facade for the default first-system workflow.

In a source checkout, `npm run verify:autonomy-baseline` reports measured deterministic scenario-portfolio and synthetic mutation foundations, while historical Bug replay and real-system mutation effectiveness remain unmeasured. Never summarize a `not-measured` metric as a pass.

## Facade-First Tool Policy

New installations use `BRAIN_CREATOR_TOOL_PROFILE=facade`. Prefer these high-level tools:

- `bc_prepare`: ingest requirements, generate analysis and test design, assess BusinessScenario assurance, record strong scenario runs, evaluate mutation outcomes, approve baselines, run bounded system exploration, submit evidence, batch compile cases, confirm page bindings, and control Gap lifecycles.
- `bc_status`: inspect knowledge projects or runtime systems and choose the next action.
- `bc_configure`: create knowledge projects, systems, auth, rules, terms, bindings, checkpoints, verify or archive auth, inspect connectors, update/reload runtime Bridge configuration, and reload the store safely.
- `bc_run`: preview or execute requirement suites, approved cases, document suites, and bug regression.
- `bc_review`: review requirements, knowledge, coverage, Requirement Eval history, System Brain, BusinessScenario, Scenario Assurance, Scenario Trust, CompileRuns, executable cases, evidence, suites, bugs, and Gaps.
- `bc_intent_preview`: preview ambiguous operational wording without executing it.
- `bc_submit_agent_output`: return Planner, Generator, or Healer output in host-agent mode.
- `bc_command`: optional `/bc help`, status, suite, bug, and Gap shortcuts.

Fine-grained tools remain available with `BRAIN_CREATOR_TOOL_PROFILE=full` for compatibility, audit, and debugging.

Use `responseMode=summary` for normal Facade calls. Request `full` only for a specific audit or diagnosis, and page large CompileRun details through `bc_review target=compile-run`. Resolve, dismiss, or reopen a Gap only through `bc_prepare` preview and confirmation with a human note and evidence references.

Real Playwright execution uses strict structured evidence by default. `evidenceMode=compatibility` is only valid for injected test runners; it cannot downgrade a real process, and reporter-less results are not strong auditable passes.

## User Entrypoint Map

| User intent | Default Agent path | Approval boundary |
|---|---|---|
| Analyze a local requirement, DOCX, PDF, or Web page | `bc_configure target=knowledge-project` then `bc_prepare action=ingest-requirement` | Generated knowledge stays draft |
| Analyze a Feishu Wiki/Doc | `bc_prepare action=ingest-requirement` | Use direct OpenAPI or host content-package fallback |
| Analyze requirement images | `bc_prepare action=analyze-attachments`, then `submit-attachment-analysis` and confirmed `confirm-attachment-analysis` | Use each controlled `localPath`; discovery alone must not create a Gap |
| Generate requirement analysis | `bc_prepare action=generate-analysis provider=host-agent`, then resubmit each returned `taskId` with schema-valid `analysisPackage` | Four isolated stages; one retry; blocked Critic cannot write domain assets |
| Generate test design | `bc_prepare action=generate-test-design provider=host-agent` after the Critic completes | Review coverage, Gaps, and data before approval |
| Confirm Requirement Eval actions | `bc_prepare action=confirm-eval-actions confirm=true` | Present each action and preserve the user's `confirmationNote` |
| Approve a baseline without system onboarding | `bc_prepare action=approve-baseline confirm=true` | Host analysis also requires a verified approval receipt; ordinary Agent notes do not approve |
| Bind a real system | `bc_configure target=system`, then `bc_configure target=system-binding` | Confirm environment and allowlist |
| Explore a real system | `bc_prepare action=explore-system` | Link-only by default; explicit `interactionMode=safe` probes bounded tabs, disclosures, and native selects |
| Submit page/training evidence | `bc_prepare action=record-page-evidence` / `record-training-evidence` | Use real host-browser evidence inside the selected system allowlist |
| Refresh System Brain | `bc_prepare action=refresh-system-brain` | Preserve system isolation and evidence references |
| Reconcile expected and observed behavior | `bc_prepare action=reconcile-system-brain` with `requirementSetId`, `systemId`, and `responseMode=summary` | Review `bc_review target=semantic-binding`; conflicts and stale bindings cannot be silently confirmed |
| Recompile after a System Brain change | `bc_prepare action=recompile-stale-cases` with `knowledgeProjectId` and `systemId` | Recompile only affected TestIntents after reviewing the ChangeSet; never reuse a stale case |
| Compile against a system | `bc_prepare action=compile-cases` with `requirementSetId` or `testIntentIds`, `systemId`, and `responseMode=summary` | Review five compilation stages and ExplorationTasks through `bc_review target=compile-run` |
| Review cross-case data dependencies | `bc_review target=case-dependency` with `systemId` and `responseMode=summary` | Check producer/consumer edges, dependency order, and unresolved data decisions before execution |
| Resolve compilation exploration | `bc_prepare action=resolve-exploration-task` | Preview first; resolved requires evidence, failed requires a reason and creates the final Gap |
| Approve a requirement and onboard its first system | `bc_prepare action=create-onboarding-plan`, preview/confirm `approve-onboarding-plan`, then `start-onboarding-plan` | Default path; one approval atomically covers the Requirement baseline and bounded exploration |
| Explore later stateful or multi-role gaps | `bc_prepare action=create-exploration-plan`, preview/confirm approval, then `start-exploration-plan` and `submit-exploration-result` | Compatibility/follow-up path; test/staging allowlist, verified roles, write/time budgets, evidence, and cleanup are mandatory |
| Prepare test data | `bc_prepare action=prepare-test-data` | Preview first; deterministic generated/unique values may use `automatic=true` only after the data plan is confirmed; reuse is default and create requires explicit `allowCreate=true` |
| Submit data or cleanup evidence | `bc_prepare action=submit-test-data` | Require stable references and non-empty `sourceRefs`; never expose secrets |
| Prepare execution | `bc_prepare action=prepare-execution` | Persist only a ready immutable plan; blocked and needs-confirmation drafts cannot start Generator |
| Configure auth | `bc_configure target=auth operation=create|verify|archive` or `bc_configure target=checkpoint` | Verify only through a fresh browser context; never expose secrets |
| Execute approved requirement cases | `bc_run mode=requirement-suite` | Preview first, then `confirm: true`; `automaticTestData=true` may resolve only confirmed deterministic generated/unique values |
| Execute an existing test document | `bc_run mode=case-source-suite confirm=false`, then `bc_run mode=case-source-suite confirm=true` | Explicit confirmation required |
| Regress bugs | `bc_run mode=bug-regression` | Show filters and candidates |
| Review status | `bc_status`, then `bc_review target="bug"`, `bc_review target="gap"`, `bc_review target=run-ledger`, `bc_review target=execution-diagnosis`, `bc_review target=requirement-eval-accuracy`, or System Brain reviews | Read-only |
| Record an external blocker | `bc_report_gap` | Include reason, severity, owner, and evidence context |

Use `statusMarkdown` and `reviewMarkdown` when present for concise replies. `/bc help` is optional shorthand, not the primary product entrypoint.

## Requirement-First Workflow

When the user provides a requirement path or URL:

1. Find or create a knowledge project with `bc_configure target=knowledge-project`. Do not require a runtime system yet.
2. Call `bc_prepare action=ingest-requirement` with the source.
3. If the source has attachments, call `bc_prepare action=analyze-attachments`. Use the host multimodal capability for every returned local path, submit schema-valid visual analysis, present the draft, and confirm it only after explicit user approval. Never create an attachment Gap before download or recognition retries are attempted.
4. Call `bc_prepare action=generate-analysis provider=host-agent`. Execute the returned Document Mapper, Clause Analyst, Business Modeler, and isolated Coverage Critic tasks in order. Submit each result by repeating `generate-analysis` with the returned `taskId` and a schema-valid `analysisPackage`. The Critic reads source evidence and structured outputs only, never designer conversation. Do not write Requirement domain assets when its verdict is blocked.
5. After the Critic completes, call `bc_prepare action=generate-test-design provider=host-agent`. Present atomic clauses and their source anchors, BusinessObjectModel/DecisionTableModel assets, WorkflowModel/StateMachineModel transitions, five-dimension coverage, unsupported claims, contradictions, missing branches, risks, test techniques, TestIntents, and TestDataProfiles. Re-run test design after confirming visual analysis; its fingerprint must invalidate an earlier field-only draft. Do not collapse the result into one broad requirement summary.
6. Present each pending Eval action. For clarification or a missing branch, call `bc_prepare action=confirm-eval-actions confirm=true` with the selected `actionIds` and the user's non-empty `confirmationNote`. Never infer or fabricate that note.
7. A blocked contradiction cannot be confirmed. Ask the user to revise or refresh the requirement source, then regenerate the design.
8. Create or select a runtime system with `bc_configure target=system`, bind it with `bc_configure target=system-binding`, and configure verified auth.
9. Call `bc_prepare action=create-onboarding-plan`. It derives requirement-directed questions from confirmed WorkflowModel, StateMachineModel, DecisionTableModel, and TestIntent assets, then wraps them in the existing role, route, write, time, data-lease, and cleanup controls.
10. Present the complete Requirement baseline, coverage matrix, unresolved questions, roles, routes, writes, duration, and cleanup policy. Call `approve-onboarding-plan confirm=true` with the default `approvalStage=exploration` only after one explicit user approval; this authorizes bounded evidence collection, not execution readiness. Start with `start-onboarding-plan`, execute only the returned work package, and return action evidence plus one `taskEvidence` entry for every requirement question and requested evidence label with `submit-exploration-result`. Refresh and review the coverage matrix, then use `approvalStage=execution` only when every item is covered and every allowed action has requirement and system evidence. `bc_prepare` rejects execution approval otherwise. Use `bc_review target=onboarding-plan` and `bc_status` to recover the plan. The older separate `approve-baseline` and ExplorationPlan flow remains a compatibility path.

10a. Host analysis records Producer, Schema Validator, isolated Critic, and Adjudicator results. Review them with `bc_review target=stage-eval`; changed source or model inputs stale the old records. For a host-agent or host-skill baseline, preview `approve-baseline` and create a one-time `challenge-response` receipt with `bc_configure target=approval`, or provide a host message id and proof hash for host attestation. Pass the resulting `approvalReceiptId` to the approval call. Never treat an Agent-written note as human approval.
11. Use `bc_prepare action=explore-system` only for additional read-only discovery outside the approved onboarding questions. Keep `interactionMode=off` unless safe state evidence is needed. With explicit user approval, use `interactionMode=safe` and a small `maxInteractionsPerPage` to observe tabs, disclosure controls, and native-select cascades. Use `record-page-evidence` and `record-training-evidence` for complex menus, data entry, and business workflows.
After refreshing System Brain, reconcile the approved RequirementSet with observed evidence through `bc_prepare action=reconcile-system-brain`. Review candidates with `bc_review target=semantic-binding`; exact, alias, step-expansion, and conditional matches remain auditable, while conflicts and missing observations stay unresolved until evidence or the user settles them. When a behavioral ChangeSet marks assets stale, confirm the new snapshot and use `bc_prepare action=recompile-stale-cases` to recompile only affected TestIntents.
12. Compile approved TestIntents in one bounded call with `bc_prepare action=compile-cases`, `requirementSetId` or `testIntentIds`, the selected `systemId`, and `responseMode=summary`. Review one `CompileRun` through `bc_review target=compile-run` with `limit` and `offset`. Inspect requirement-path, System Brain, test-data, provenance, and final-case stages.
13. For `needs-exploration` or `ambiguous`, present the ExplorationTask and requested evidence. Read-only evidence may use System Brain refresh and confirmed `resolve-exploration-task`. If evidence requires writes or role transitions, create an ExplorationPlan, show its complete boundary, obtain one explicit approval, prepare required data, execute only its host work package, and submit action evidence. Successful submission refreshes System Brain and recompiles automatically. Cancel a declined unstarted plan. Mark exploration failed only after attempts are exhausted; that is the point where Brain Creator creates a Gap. Treat all domain scenarios as data: never add product-specific branches to the planner.
14. Inspect `testDataPlan`. Manual `prepare-test-data` remains available, but the normal Requirement Suite path dispatches data preparation when each case becomes current. Reuse is the default. Set `allowCreateTestData=true` on `bc_run` only after explicit user authorization.
15. Execute the returned TestDataTask in the bound system and call `submit-test-data` with its decision, stable reference, and evidence `sourceRefs`. Created data requires `delete-created` or `restore`; repeated Suite calls reuse the pending task. Never invent structural data or expose a secret.
16. Preview `prepare-execution` when auditing one case. During Suite execution, Brain Creator freezes each ExecutionPlan only after that case's data is ready. The plan includes Requirement, System, Auth, Path, State, Data, Gap, Cleanup, ContextPack, and source references.
17. Preview with `bc_run mode=requirement-suite confirm=false`; execute only after confirmation with `confirm=true`. Confirmation validates all non-data blockers and creates one ordered RequirementSuiteRun. Only one case may prepare data, wait for an Agent, execute, or clean up at a time.
18. Submit each Host Agent result normally. Reused data is released automatically; created data must finish cleanup before the next case starts. Business failures continue after Bug creation. Data, cleanup, and other technical blockers create Gaps and stop. Explicit resume retries the same data phase; it must not repeat completed business steps.
19. Use `bc_review target=requirement-suite-run`, `bc_review target=execution-plan`, `bc_review target=requirement-eval-accuracy`, `bc_review target=system-brain`, and `bc_review target=system-exploration` alongside evidence, BugReport, and Gap reviews.
20. Control an existing Requirement Suite only through `bc_run suiteAction=cancel|retry|skip`. Preview with `confirm=false`, obtain user approval, then use `confirm=true`. Retry only failed/blocked cases, skip only blocked cases, never bypass created-data cleanup, and preserve prior attempts for review.
21. Use `bc_status` for the bounded active RunLedger and ExecutionDiagnosis summaries, `bc_review target=run-ledger` for a complete Suite timeline, and `bc_review target=execution-diagnosis` for terminal failure classification. Create a product Bug only when the diagnosis verdict is `product_bug`.

Do not let observed system behavior overwrite approved requirements. Prefer `explore-system` before compilation, then use `refresh-system-brain` to derive observed pages, fields, navigation, state transitions, workflows, cascades, and API integrations from existing assets. Safe interaction mode must reject write-like labels and unstable selectors, block non-read HTTP methods and dangerous URLs, restore the page after every probe, and stay within the allowlist and interaction budget. Never submit forms, approve, delete, or publish. Disclose the residual risk that a misdesigned GET endpoint may have side effects. Submit additional observed rules or workflows with `bc_prepare action=record-observation`, including evidence `sourceRefs`. Conflicts must remain visible and block execution until resolved.

Workflow path planning is deterministic and evidence-only. Brain Creator may generate `origin=observed` navigation clicks from recorded navigation edges only when one shortest path connects an observed entry page to the selected target page. Equal shortest paths, target-page score ties, disconnected targets, and missing edge locators remain `ambiguous` or `needs-exploration`; they become Gaps only after the corresponding ExplorationTask fails.

State-action planning is also deterministic and domain-agnostic. It may reuse or insert a click/select step only from one relevant observed state transition with a stable locator and, for selects, a captured input value. Product names and business rules belong in requirement/System Brain data and test fixtures, never in planner code.

Test-data planning is deterministic and TestIntent-scoped. `fixed`, `generated`, and `unique` values may be proposed for user confirmation; `existing-reference` is prepared through an idempotent Host Agent task and an evidence-backed `TestDataLease`; `runtime-captured` requires declared dependencies; `secret-reference` stays a reference. Reuse is read-only by default. Creation requires explicit approval and a cleanup policy, and cleanup failures remain operational Gaps rather than product Bugs. Structural graph failures remain Gaps.

Cross-case business data must use a stable semantic entity reference such as `employee:testperson001`. A producer case declares `producesEntityRefs`, a later case declares `consumesEntityRefs`, and the compiler records the dependency edge and order. Missing producers become `needs-data`, multiple producers become `ambiguous`, and cycles become `blocked`; stale or superseded cases never satisfy a current dependency. Each compiled case also carries assertion contracts with requirement references and evidence requirements. The built-in provider preserves the existing `lookup`, `create`, `transition`, `verify`, and `cleanup` lifecycle, but real systems still need a system-specific adapter or an approved Host Agent task.

Execution Preflight is deterministic and read-only until confirmation. It creates a semantic hash over approved requirement state, system binding, optional explicit auth, frozen ContextPack, executable steps, path/state plans, data leases, open Gaps, and cleanup obligations. Persist only `verdict=ready`; never bypass a blocked or stale check with a lower-level execution tool. RequirementSuiteRun is the resumable ordering ledger: at most one case is active, terminal business failures continue, and technical blockers require explicit resume. Keep secret material as references.

Historical Requirement Eval accuracy is an estimate, not a fabricated model score. Passed evidence and failed evidence linked to a BugReport validate the requirement expectation; unclassified semantic failures contradict it pending review; blocked, console, and network failures remain inconclusive. Report system conformance and traceability separately.

## Requirement Sources

Supported first-party adapters:

- Local `.md`, `.txt`, `.docx`, and `.pdf` files.
- Public HTTP(S) pages; private-network URLs require explicit `allowPrivateNetwork=true`.
- Obsidian references such as `obsidian:<path>` and `[[path]]`.
- Feishu Wiki/Doc links.

Requirement ingestion preserves an ordered block AST for Markdown, HTML, and DOCX. Heading levels, table headers/rows, image references, and stable source anchors must survive into the `RequirementContentPackage`; the host package normalizer fills missing anchors without discarding legacy packages. `.larkenterprise.com` is a supported Feishu domain. When `provider` is omitted, `generate-analysis` uses the host-agent Harness. Builtin remains an offline compatibility path, but an explicit builtin request for a structured or visual source is preview-only and cannot approve or execute it.

For Feishu, prefer direct OpenAPI when both `BRAIN_CREATOR_FEISHU_APP_ID` and `BRAIN_CREATOR_FEISHU_APP_SECRET` are configured. Otherwise use the host lark capability and retry with a `RequirementContentPackage`. Preserve stable block/file tokens, reacquire credentials for each media download, and never persist expiring `authcode` URLs. Unsupported or unreadable content may create a Gap only after the connector and visual-analysis attempts are recorded and exhausted. Never store Feishu credentials in Brain Creator assets.

If `RequirementAnalysis.skill` or `TestCaseDesign.skill` is available and useful, the host may call it and submit normalized output with `provider=host-skill`. Brain Creator normalizes that output into the mapper and clause stages, then still dispatches independent Business Modeler and Coverage Critic tasks. Host Skill output must include source references and cannot bypass schema validation, Eval, Gap, or approval gates. Builtin policies remain available for compatibility and offline deterministic fallback.

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

Document suites stop on the first environment, auth, locator, automation, or evidence Gap unless the user explicitly selects `continueOnBlocked: true`. Use the persisted ExecutionDiagnosis for the verdict and never create a BugReport from raw failure text. During bug regression, only `product_bug` becomes `retest-failed`; technical blockers preserve the previous bug status. Do not write results back to Excel unless both `writeBack: true` and `confirmWriteBack: true` are explicit.

## Host-Agent And Bridge

Codex plugin mode normally uses `host-agent`. Treat `needs_agent_execution` and `waiting-for-agent` as actionable work, not a missing AgentBridge. Read the task prompt/context, write only requested outputs, then call `bc_submit_agent_output`.

Subprocess modes may use Claude or Codex. Check bridge readiness with `bc_status` or `brain-creator-doctor` before confirmed execution. If unavailable, report the blocker immediately instead of waiting for a long timeout.

Generator writes Playwright tests, Playwright executes them, and Healer performs bounded repairs. Business mismatches create BugReports. Auth, environment, locator, network, and missing-evidence blockers create Gaps.

Treat `bc_status.readiness` as a three-state signal: `ready`, `action-required`, or `blocked`. Pending AgentTasks, unfinished suites, open BugReports, and open Gaps are `action-required`; Bridge or manual auth blockers are `blocked`. When suite progress includes an `activeTask`, continue that task before relying on an older failed case in `remainingCaseNos`.

After the bounded Healer attempt, rely on the persisted ExecutionDiagnosis verdict. Create a BugReport only for `product_bug`; generated test syntax, parser, index, locator, missing-element, data, auth, environment, network, execution, and unknown failures remain typed Gaps. Review the diagnosis instead of reclassifying raw stderr.

Historical diagnosis `legacyAudit` is read-only and bounded. Use the status summary first and request `bc_review target=execution-diagnosis` only when candidate details are needed. Present `confirm_bug`, `review_bug_as_gap`, `confirm_gap`, and `needs_evidence` as suggestions. Never close a Bug or create/resolve a Gap from an audit candidate without explicit user confirmation and a dedicated migration action.

For one approved candidate, preview `bc_prepare action=review-legacy-diagnosis confirm=false` with its system, asset type, asset ID, and decision. Show the exact `changes`, then repeat with `confirm=true` and a human `confirmationNote`. Never batch approvals. `confirm_bug` and `confirm_gap` preserve status; `review_bug_as_gap` closes only the selected Bug and creates a linked typed Gap; `needs_evidence` records a review without migration.

When the user rejects the recommendation, use `diagnosisDecision=override_classification` with a consistent `correctedFailureType` and `correctedVerdict`, preview it, and obtain confirmation again. Preserve proposed and confirmed labels. Report `humanAdjudicationEval.observedAccuracy` with its sample size; only report `reportableAccuracy` after the configured minimum, which defaults to 20 active adjudications. Exclude `needs_evidence` and rolled-back reviews, and never promote a historical Gap directly to a product Bug.

If a confirmed migration was wrong, preview `bc_prepare action=rollback-legacy-diagnosis` with its `diagnosisReviewId`. Show the exact changes and require a new human `confirmationNote` before `confirm=true`. Rollback must remove only the diagnosis and migration Gap created by that review, restore the prior Bug status, retain a `rolled-back` audit record, and make the source asset reviewable again.

Requirement and Document Suites share `bc_review target=run-ledger`. Use `knowledgeProjectId` for Requirement Suite timelines and `systemId` for Excel/Markdown Document Suite timelines. Routine status stays bounded; request a full ledger only for progress diagnosis or audit.

Use `observationMode=summary` for normal `bc_run` calls. Use `step-by-step` only when the user asks to watch detailed execution. MCP Progress Notifications are best-effort; always treat the ordered Run Ledger as the recovery source. Report the current case, step, page, elapsed time, wait reason, and `possiblyStalled` warning from `bc_status`. A stalled warning is not a failed assertion. Point the user to the incrementally updated offline Suite report for assurance, screenshots, traces, Bugs, and Gaps.

`observationMode` controls progress detail. When the user explicitly asks to watch the live browser, pass `browserMode=observe` to both preview and confirmed `bc_run`; otherwise keep the default `headless`. Do not switch a running Suite's browser mode. If observe mode reports no interactive desktop, explain the capability blocker instead of silently falling back. A visible browser is an observation aid, not execution evidence.

Brain Creator-generated files belong under `.brain-creator/artifacts/<system>/<requirement>-v<revision>/<suite-run>/`; do not write new specs or tests to root `specs/` or `tests/generated/`. Use `brain-creator artifacts migrate` as a dry-run before asking the user to confirm historical migration. Rollback and retention always require explicit `--confirm`; never clean an active or latest run. Use `brain-creator export --suite <id>` for a complete, secret-scanned Suite archive.

## System

- Use `bc_list_systems` only in full-profile discovery or debugging.
- Prefer `bc_configure target=system` for creation and `bc_status` for selection.
- Refresh System Brain after page modeling or training changes. Repeated refreshes must be idempotent and isolated to the selected `systemId`.
- Compile with `systemId` so navigation and actions bind PageModel, LocatorPoint, and ProbeResult evidence instead of semantic guesses.
- Never mix knowledge or assets across systems.
- The natural-language phrase `Use Brain Creator to connect this system` is a valid entrypoint.

## Auth

- Prefer `bc_configure target=auth`; `bc_create_auth` remains an internal compatibility tool.
- Runtime configuration uses `bc_configure target=runtime operation=update|reload-config`. Environment variables have highest priority; never put secrets directly in the runtime file. Reload is blocked during active runs and failed preflight keeps the previous configuration.
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

Execution trust is evidence-driven. Do not pass a caller-provided `strong`
label to promote a scenario: completed evidence must include structured
Reporter output, source-backed assertion contracts, source-backed steps, and
complete required coverage. The first strong run uses `browserMode=observe`;
headless first runs remain held at `bound`. Requirement, System Brain, or data
hash changes reset prior trust, and failed or incomplete evidence quarantines
the scenario. Use the offline execution report and `bc_status` to explain the
current step, data references, evidence strength, diagnosis, and next action
in plain language. A green Playwright process is never equivalent to complete
requirement conformance.

For L3 evaluation, use `npm run verify:l3-eval` from a source checkout. Treat
the sanitized HR, order approval, image state-machine, cross-role,
multi-requirement, and synthetic long-run samples as control evidence only.
The command must report real-system regression and historical Bug replay as
`not-measured` until deployment evidence is supplied; never describe the
synthetic result as full autonomy or production readiness.
