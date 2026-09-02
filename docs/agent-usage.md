# Brain Creator Agent Usage Guide

Brain Creator is used through one sentence in Claude Code or Codex. Users describe the testing goal; the Agent chooses the Facade MCP tools and keeps approval boundaries visible.

## Recommended First Request

```text
Use Brain Creator to analyze this requirement document, generate traceable test design and data, and wait for my approval.
```

```text
用 Brain Creator 分析这个飞书需求链接，沉淀知识并生成测试意图，等我确认。
```

The recommended path starts from requirements. The older “connect a business system first” path remains available when the user only wants operational maintenance or document-suite execution.

## Installation Modes

- **source checkout mode**: contribute to Brain Creator from this repository.
- **MCP CLI connection mode**: install `brain-creator` in a business project, run `brain-creator init`, then verify it with `brain-creator doctor`. Existing standalone executables remain available under `brain-creator help legacy` for compatibility.
- **repo-local plugin installation mode**: register this repository or the installed npm package as a Codex plugin marketplace.

Full setup details are in `docs/mcp-installation.md`.

## Requirement-First Flow

### 1. Create Knowledge Context

The Agent calls `bc_configure target=knowledge-project`. A real system is not required yet.

### 2. Ingest The Requirement

The Agent calls `bc_prepare action=ingest-requirement` for Markdown, TXT, DOCX, PDF, HTTP(S), Obsidian, or Feishu.

For Feishu, Brain Creator uses direct OpenAPI when environment credentials are configured. Otherwise the host Agent reads the document with its lark capability and submits a normalized `RequirementContentPackage`.

Source ingestion preserves an ordered block AST for Markdown, HTML, and DOCX: headings keep their levels, tables keep headers and rows, images keep their reference, and every block receives a stable source anchor. The `.larkenterprise.com` Feishu domain is accepted alongside the standard Feishu and Lark domains. If `provider` is omitted, `generate-analysis` uses the host-agent Harness; explicitly requesting builtin for a structured or visual source is preview-only and cannot approve or execute it.

If the source contains images, call `bc_prepare action=analyze-attachments` with the returned `requirementSourceId` before generating test design. Brain Creator downloads each attachment to a controlled local path. When the response is `needs-host-vision`, inspect every `recognitionRequests[].localPath` with the host multimodal capability and submit the schema-valid result through `submit-attachment-analysis`. Present the draft to the user, then call `confirm-attachment-analysis confirm=true` only after explicit confirmation. Discovery alone is not a failure: a Gap is allowed only after the recorded download or recognition retries are exhausted.

Run requirement understanding with `bc_prepare action=generate-analysis provider=host-agent`. The response advances through Document Mapper, Clause Analyst, Business Modeler, and an isolated Coverage Critic. Execute each returned prompt and repeat the same action with `taskId` plus the JSON `analysisPackage`. The Critic sees source evidence and structured stage output, not the designer conversation. After completion, call `generate-test-design` with the same provider. One structured retry is allowed; a second failure is persisted as a recoverable Gap. A Host Skill may seed mapping and clauses, but it never skips modeling or Critic review.

After confirmation, run `generate-test-design` again. The design fingerprint includes confirmed attachment analyses, so an earlier draft is rebuilt with WorkflowModel/StateMachineModel clauses, transition tests, negative state tests, Actor Journeys, and dimension coverage. Do not approve a baseline while `unconfirmed-attachment` or `missing-process-coverage` is blocked.

### 3. Analyze And Design

The Agent calls `bc_prepare action=generate-test-design` and presents:

- requirement modules, actors, fields, rules, workflows, states, permissions, and integrations;
- source references and confidence;
- open questions and risks;
- test techniques and coverage;
- TestIntents and TestDataProfiles;
- parsing, clarification, or connector Gaps.

Builtin policies work without external Skills. When `RequirementAnalysis.skill` or `TestCaseDesign.skill` is available, the Agent may use it as an enhancement, but the output still passes Brain Creator schema, Eval, source-trace, and approval gates.

### 4. Approve The Baseline

The Agent presents every Requirement Eval action. Clarifications and missing branches require an explicit `confirmationNote`; direct contradictions require a source revision. For a first system, the default next step is to bind the system and verified roles, create an OnboardingPlan, and ask for one approval that covers both the Requirement baseline and bounded exploration. `approve-baseline confirm=true` remains the compatibility path when no system onboarding is required.

Seven golden samples cover ordinary clauses, complex Markdown rule tables, cross-module workflows, permission matrices, contradictions, and missing branches. Historical quality can be reviewed with `bc_review target=requirement-eval-accuracy`; technical failures remain inconclusive instead of reducing the requirement score.

### 4.1 Review Business Scenarios And Assurance

After test design, Brain Creator also creates a domain-neutral `BusinessScenario` portfolio. Review it with `bc_review target=business-scenario`; the summary groups main flows, branches, state transitions, invalid transitions, cross-role journeys, exceptions, data, and integration scenarios. Use `bc_prepare action=assess-scenarios` after binding a system to evaluate each scenario against the current System Brain, TestDataProfile, and requirement-backed oracle.

Assurance is a gate, not a confidence label. A scenario without a unique system binding, usable data plan, or source-backed oracle remains blocked or needs review. Use `bc_review target=scenario-assurance` to inspect the binding, data readiness, oracle strength, reasons, and evidence. A strong observed run can be recorded with `bc_prepare action=record-scenario-run`; the first unchanged strong run reaches `verified`, and three unchanged strong runs are required for `trusted`. Scenario generation, a single green Playwright run, or an LLM confidence score never promotes a scenario automatically.

Mutation results can be submitted through `bc_prepare action=evaluate-mutations`. The evaluator counts caught and survived mutations separately from blocked mutations, so blocked coverage cannot be mistaken for defect detection. This PR E slice evaluates recorded mutation outcomes; mutation generation and historical Bug replay remain follow-up capabilities.

### 5. Bind And Explore System Brain

The Agent uses `bc_configure target=system` and `bc_configure target=system-binding`, then configures auth. Protected password, recovery, CAPTCHA, or 2FA uses `bc_create_auth_checkpoint` and workspace-local storage state.

The Agent first calls `bc_prepare action=explore-system`. Brain Creator performs a bounded Playwright breadth-first exploration: it visits only HTTP(S) links inside the selected system allowlist and enforces page, depth, and wall-time budgets. `interactionMode` defaults to `off`. The Agent may propose `interactionMode=safe` only when the user needs tab, disclosure, or native-select state evidence; the call remains bounded by `maxInteractionsPerPage` and never submits forms. A verified AuthProfile may provide a workspace-local `storageStatePath`. Login pages, CAPTCHA, 2FA, invalid scopes, or empty evidence block the run and create a Gap; authentication blockers also create a resumable checkpoint.

The exploration creates versioned PageModels, LocatorPoints, ProbeResults, navigation edges, and safe interaction state transitions, then refreshes `systems/<system-id>/brain.md`. Safe probes reject write-like labels and unstable selectors, block non-read HTTP methods and dangerous URLs, restore the page after each probe, and preserve blocked requests as evidence. The Agent must disclose that a misdesigned GET endpoint can still carry residual side-effect risk. For complex menus, data entry, or business workflows, the host Agent supplements evidence through `bc_prepare action=record-page-evidence` and `record-training-evidence`.

For a conditional state that must be explored, the host may include an approved `explorationScenario` with a role, prerequisite state, reusable `dataRefs`, active current-system `testDataLeaseIds`, and non-secret `selectorValues`. Brain Creator validates the leases before opening a browser, then records the scenario id with each observed transition and System Brain state. If a requested option is unavailable, the probe is blocked rather than choosing a different value. `dataRefs` identify reusable data; they do not create or persist credentials, and data preparation remains a separate test-data step.

After a refresh, reconcile the approved RequirementSet with the candidate System Brain snapshot using `bc_prepare action=reconcile-system-brain`. Review the resulting `SemanticBinding` records with `bc_review target=semantic-binding`; `exact`, `alias`, `step-expansion`, and `conditional` matches are evidence-backed candidates, not silent approvals. Conflicts and missing observations remain visible. If a behavioral ChangeSet marks TestIntents or ExecutableCases stale, confirm the new snapshot first, then call `bc_prepare action=recompile-stale-cases` to rebuild only the affected intents.

### 6. Compile Executable Cases

The Agent calls `bc_prepare action=compile-cases` with a `requirementSetId`, explicit `testIntentIds`, or one compatible `testIntentId`, plus `systemId` and `responseMode=summary`. Brain Creator creates a bounded CompileRun and compiles unchanged inputs idempotently through requirement-path, System Brain, test-data, provenance, and final-case stages. Review details with `bc_review target=compile-run`, `limit`, and `offset`.

Brain Creator selects the target page from semantic and role-compatible evidence, computes shortest paths from observed graph entry pages, and binds steps to real PageModel, navigation-edge, LocatorPoint, state-transition, and ProbeResult evidence. Equally plausible pages or missing controls create an `ExplorationTask`, not an immediate Gap. Present candidates and evidence requests. After System Brain evidence is updated, preview and confirm `bc_prepare action=resolve-exploration-task`; the compiler resumes automatically. Use `confirm-page-binding` only when the user truly selected one page, and never choose silently.

After navigation planning, Brain Creator evaluates generic `SystemBrainStateTransition` evidence and returns `stateActions`/`statePlan`. A single relevant transition may enrich an existing click/select step or insert one observed step before its assertion, including the captured input value and LocatorPoint. Equal transitions, multiple reusable source steps, missing values, or missing locators become `ambiguous` or `needs-exploration`. Only an explicitly failed exploration creates a `system-brain-exploration` Gap. Business examples are validation fixtures only and must never become planner conditionals.

For the first requirement-directed exploration, call `create-onboarding-plan`, preview `approve-onboarding-plan`, and obtain one explicit approval for the baseline, roles, routes, actions, data policy, write/time budgets, and cleanup policy. Approval fails closed if the Requirement assets changed after preview; recreate the plan instead of approving stale scope. Run `start-onboarding-plan`; complete any returned test-data tasks before the host Agent executes the requirement-question work package. Submit exact action evidence plus `taskEvidence` for every returned question and requested evidence label through `submit-exploration-result`. Brain Creator validates every action and question against the linked ExplorationPlan, refreshes System Brain, resumes compilation, and synchronizes OnboardingPlan status. Review with `bc_review target=onboarding-plan`.

For later evidence that requires real writes or role transitions, do not misuse `interactionMode=safe`. Use the existing ExplorationPlan flow for the pending tasks. Review it with `bc_review target=exploration-plan`; cancel an unstarted plan when approval is declined.

### 7. Plan Test Data

Compilation returns `testDataPlan`/`dataPlan` for profiles linked to the current TestIntent only. The plan records dependency order, proposed values, lookup queries, reuse/create decisions, secret references, and cleanup policy. Generated candidates remain visible for suite confirmation.

For an `existing-reference`, manual preparation remains available through `bc_prepare action=prepare-test-data`. The normal Requirement Suite path dispatches the same auditable task automatically when that case becomes current. Reuse is the default. Pass `allowCreateTestData=true` to `bc_run` only when the user explicitly authorizes data creation for that Suite.

The host Agent performs the lookup or creation in the bound system, then calls `bc_prepare action=submit-test-data` with `taskId`, `taskStatus=succeeded`, `dataDecision`, `dataReference`, an optional non-secret `dataValue`, and non-empty `sourceRefs`. Created data is rejected unless the TestDataProfile has `delete-created` or `restore`. Failures use `taskStatus=failed`, `error`, and available evidence; Brain Creator creates a provider Gap instead of inventing data.

After terminal ExecutionEvidence, the Requirement Suite automatically releases reused leases or returns a cleanup task for created data. The next case cannot start until cleanup evidence is submitted. Cleanup failure is a `test-data-cleanup` Gap and must not be classified as a product Bug. Explicit Suite resume retries that cleanup task on the same case.

Duplicate fields, missing dependencies, and cycles require profile corrections and cannot be bypassed by submitting a value. Secret references are never copied into executable step values. `resolve-test-data` remains available only for compatibility and explicit manual resolution.

### 8. Prepare Execution

Call `bc_prepare action=prepare-execution confirm=false` with the knowledge project, system, ExecutableCase, and optional explicit AuthProfile. Present all Requirement, System, Auth, Path, State, Data, Gap, and Cleanup checks. On confirmation, call it again with `confirm=true`.

Brain Creator persists only a ready immutable ExecutionPlan. It freezes the case title, preconditions, bounded generator ContextPack, steps, data bindings, and optional auth reference. A blocked or needs-confirmation draft remains diagnostic and must not start Generator. Identical semantic inputs reuse the same snapshot hash and plan; timestamps alone do not create a new plan. Changed steps, requirement content, retrieved context, system binding, auth verification, data leases, or blockers make an existing plan stale. Secret values are never copied into the plan.

Use `bc_review target=execution-plan` for audit. `bc_run mode=requirement-suite` performs the same Preflight, so direct confirmation cannot bypass it.

### 9. Preview And Execute

The Agent previews `bc_run mode=requirement-suite confirm=false`. After explicit approval it runs `bc_run mode=requirement-suite confirm=true`. Confirmation independently checks every selected ExecutableCase. Requirement, System, Auth, Path, State, and non-data Gaps must pass before any side effect. Resolvable test-data Gaps are admitted into one ordered RequirementSuiteRun and handled when their case becomes current.

After the current case's data is ready, Brain Creator freezes its ExecutionPlan. The Generator, selected auth seed, and ExecutionEvidence consume that plan instead of rereading mutable ExecutableCase fields. Before initial chain execution and every `bc_submit_agent_output` continuation, Brain Creator recomputes the semantic hash. A stale or newly blocked plan is rejected before task submission.

Only one RequirementSuiteRun case may prepare data, wait for an Agent, execute, or clean up at a time. A Host Agent terminal submission performs cleanup before starting the next queued case. Business mismatches create BugReports and continue; data, cleanup, and other technical failures create Gaps and stop unless the user explicitly resumes with `resume=true` and `continueOnBlocked=true`. Data-phase resume retries the same phase rather than skipping the case. Repeating a confirmed run returns the current TestDataTask or AgentTask instead of creating a duplicate. Inspect progress with `bc_status` or `bc_review target=requirement-suite-run`.

Set `observationMode=summary` on `bc_run` for one bounded update per operation, or `observationMode=step-by-step` when the user explicitly wants detailed progress. If the MCP client supplies a progress token, Brain Creator emits best-effort MCP Progress Notifications. The ordered Run Ledger is authoritative even when notifications are unsupported or disconnected. `bc_status` exposes the current case, step, page, elapsed time, last update, wait reason, and `possiblyStalled`; a stalled warning is diagnostic and does not convert the case to failed. Each completed case incrementally rewrites the offline Suite HTML report.

`observationMode` controls progress-message detail; it does not open a browser window. When the user explicitly asks to watch the browser, pass `browserMode=observe` to the preview and confirmed `bc_run`. The selected mode is immutable for a running Suite and is reused by Host Agent continuations, Healer retries, document-suite continuation, and Bug regression. Observe mode requires an interactive desktop and fails with an actionable capability result in CI, Windows service sessions, or Linux without `DISPLAY/WAYLAND_DISPLAY`. Never present a visible window as proof of correctness; use Reporter evidence and assertions for the verdict.
For a controlled stability check, add `repeatCount` from 2 to 5 to the same `bc_run mode=requirement-suite` request. Brain Creator creates isolated linked SuiteRuns with separate evidence and ledger entries. Review `bc_review target=coverage` after all iterations; one green run is never treated as stability proof.

Brain Creator writes an offline `suite-report.html` under the system/requirement/run artifact directory and updates it after every completed case, including running Suites. The report summarizes current progress, every case, status, assurance level, actual result, artifact paths, BugReports, and Gaps, and supports client-side search. For large coverage ledgers, pass `limit` and `offset` to `bc_review target=coverage`; the response keeps complete counts and returns `itemPage.nextOffset` for the next page.

Use the existing `bc_run` facade for explicit Suite controls. Always preview with `confirm=false`, show the affected run/case, and wait for approval before `confirm=true`:

- `suiteAction=cancel` cancels unfinished cases and pending Agent/TestData tasks. It preserves completed results and does not create a Gap. Any created-data cleanup obligation remains due.
- `suiteAction=retry` targets a failed or blocked `executableCaseId`. It archives the previous plan/evidence/Bug/Gap references in `attempts`, then builds a fresh execution plan. Never retry a passed case.
- `suiteAction=skip` targets a blocked `executableCaseId`. It preserves the blocked attempt and advances the Suite, but is rejected while created test data still requires cleanup.

Review `skipped`, `cancelled`, and `attempts` through `bc_status` or `bc_review target=requirement-suite-run`. Cancellation is intentional user control, retry is a new attempt, and skip is not a successful test result.

Use `bc_review target=run-ledger` with `knowledgeProjectId` for a Requirement Suite or `systemId` for an Excel/Markdown Document Suite, plus an optional Suite `id`, when the user asks what happened, where execution is waiting, or why it stopped. The timeline links TestDataTask, ExecutionPlan, AgentTask, ExecutionEvidence, ChainRun, BugReport, and Gap references without copying artifact contents into status context. `bc_status` returns only active summaries and the 20 most recent events to keep routine context bounded.

For a terminal Requirement Suite failure, read `bc_status.knowledge.executionDiagnoses` first and use `bc_review target=execution-diagnosis` when detail is needed. The diagnosis gate records the normalized failure class, controlled Healer budget, verdict, and evidence IDs. Only `product_bug` may create a BugReport; automation, locator, data, auth, environment, network, execution, and unknown verdicts remain Gaps. Do not infer a product defect from raw Playwright text after Brain Creator has classified it.

Document suites and bug regression use the same gate. For an Excel/Markdown flow without a KnowledgeProject, pass `systemId` to `bc_status` or `bc_review target=execution-diagnosis`. A document failure creates a BugReport only for `product_bug`. During regression, `passed` moves the existing bug to `retest-passed`, `product_bug` moves it to `retest-failed`, and a technical diagnosis restores the prior bug status while returning a blocked result and Gap. Host Agent regression tasks retain `regressionContext` across Generator and Healer submissions.

`legacyAudit` covers BugReports and Gaps that predate ExecutionDiagnosis. Status exposes only its summary; diagnosis review exposes a bounded candidate list with standardized reasons. Treat `confirm_bug`, `review_bug_as_gap`, `confirm_gap`, and `needs_evidence` as review suggestions, not commands. Never mutate a historical Bug or Gap from this output. Show the candidate to the user and obtain explicit confirmation before a later migration workflow is allowed to act.

After the user decides, call `bc_prepare action=review-legacy-diagnosis` for one asset. First use `confirm=false` with `systemId`, `diagnosisAssetType`, `diagnosisAssetId`, and `diagnosisDecision`. Show the returned `changes`. Only then repeat with `confirm=true` and a concise `confirmationNote`. `confirm_bug` and `confirm_gap` preserve source status; `review_bug_as_gap` closes the historical Bug and creates a typed Gap; `needs_evidence` records an inconclusive human label without migration. Never batch these confirmations or reuse approval across candidates.

If the user rejects the recommendation, set `diagnosisDecision=override_classification` and provide both `correctedFailureType` and `correctedVerdict`. They must form a valid pair. Preview and reconfirm the corrected migration exactly as for a normal decision. Read `humanAdjudicationEval`: `observedAccuracy` always carries its sample size, while `reportableAccuracy` remains null until the default 20 active adjudications are available. `needs_evidence` and rolled-back reviews are excluded. It is human-adjudicated diagnosis accuracy, not model accuracy.

To reverse an incorrect migration, call `bc_prepare action=rollback-legacy-diagnosis` with `diagnosisReviewId` and `confirm=false`. Present the exact changes, then repeat with `confirm=true` and a new human `confirmationNote`. Rollback may remove only the diagnosis and migration Gap owned by that review. It must retain the Review as `rolled-back`, restore the prior Bug status, and return the source asset to the audit candidate pool.

Failure classification is shared between Ledger and review filters: assertion, auth, locator, network, generated-automation, test-data, environment, execution, or unknown. Classification is diagnostic evidence, not permission to create a Bug. Product Bug creation still requires an expectation mismatch supported by execution evidence.

### 10. Review Evidence

The Agent uses `bc_review` to show requirements, knowledge, coverage, Requirement Eval history, System Brain, system exploration runs, TestIntents, ExecutableCases, ExecutionPlans, evidence, bugs, and Gaps. Approved expected knowledge remains separate from observed system knowledge. Coverage review reports required, verified, and missing dimensions for `field`, `workflow`, `state`, `permission`, and `integration`.

## User Entrypoints

| User intent | Default Facade action |
|---|---|
| Preview ambiguous wording | `bc_intent_preview` |
| Show current readiness | `bc_status`; present `statusMarkdown` first |
| Create or bind a system | `bc_configure target=system` |
| Configure authentication | `bc_configure target=auth` |
| Pause for protected login | `bc_configure target=checkpoint` |
| Preview an existing case document | `bc_run mode=case-source-suite confirm=false` |
| Run a confirmed case document | `bc_run mode=case-source-suite confirm=true` |
| Regress open Bugs | `bc_run mode=bug-regression` |
| Review Bugs | `bc_review target="bug"`; present `reviewMarkdown` first |
| Review Gaps | `bc_review target="gap"`; present `reviewMarkdown` first |
| Record an external blocker | `bc_report_gap` |
| Show optional shortcuts | `/bc help` |

A denied or cancelled Facade action must not be retried through a lower-level equivalent.

Typical natural-language requests:

```text
Use Brain Creator to connect the order admin system and bind the approved order requirement.
```

```text
Add business rules for approval thresholds and regenerate the affected test design.
```

```text
Generate a draft plan, approve the plan only after I confirm, then run the chain.
```

```text
Show the latest artifacts and gaps, including requirement-versus-system conflicts.
```

Users do not need to name `bc_run_chain` or other internal tools. `/bc help` displays optional Brain Creator shortcuts for status and existing-suite maintenance.

## Existing Test Case Documents

For an `.xlsx` or executable `.md` document:

1. `bc_run mode=case-source-suite confirm=false` previews the source.
2. The Agent shows counts, modules, priorities, samples, bridge status, and risks.
3. The user confirms.
4. `bc_run mode=case-source-suite confirm=true` executes the selected cases.
5. `bc_review` returns SuiteRun, ChainRun, BugReport, Gap, and evidence paths.

Excel write-back remains disabled unless the user explicitly requests both write-back and confirmation.

## Host-Agent Execution

Codex plugin installations default to `host-agent`. A `needs_agent_execution` response is work for the current Agent:

1. Read `input.prompt.md` and `input.context.json`.
2. Create only the requested Planner, Generator, or Healer outputs.
3. Call `bc_submit_agent_output`.
4. Continue while another task package is returned.
5. Stop at `completed`, `failed`, or `blocked`.

`waiting-for-agent` is not a missing bridge. Subprocess mode can use Claude or Codex when explicitly configured.

## Session Resume: The New-Session Entry Point

For an existing runtime system, `bc_session_resume` or `bc_status` replaces 6-7 independent queries. It returns system, auth, checkpoints, rules, glossary, test case counts, recent runs, artifacts, open Gaps, Bridge preflight status, and recommended next action.

Example prompts:

```text
Use Brain Creator to check the order-admin system status and tell me what to do next.
```

```text
Use Brain Creator to resume where I left off and report any blocked requirement or suite.
```

The end-to-end reference is `docs/e2e-session-resume-workflow.md`.

## Legacy Compatibility

Fine-grained tools remain available in `BRAIN_CREATOR_TOOL_PROFILE=full`:

- `bc_create_auth`, `bc_generate_seed`, and `bc_create_auth_checkpoint`;
- term/rule tools;
- `bc_generate_plan`, `bc_approve_plan`, `bc_cancel_plan`, and `bc_resume_plan`;
- `bc_run_chain`, artifact readers, and `bc_report_gap`.

The Agent should still prefer Facades.

## Safety

- Never expose secrets or save them in requirements, plans, tests, Gaps, or reports.
- Never execute an unapproved requirement baseline.
- Never mix systems or knowledge projects.
- Never overwrite expected requirements with observed behavior.
- Never fabricate a locator, test result, or evidence path.
- Do not create a Web UI for this agent-native product.

## Verification Commands

```bash
npm test
npm run build
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run verify:host-agent-chain
npm run verify:host-agent-document-suite
npm run verify:live-session-resume-workflow
npm run verify:live-claude-skill-workflow
```

## Execution Trust And Recovery

Execution trust comes from completed structured Reporter evidence, source-backed
assertions and steps, complete coverage, and a passing diagnosis, never from a
caller-provided label. The first strong run uses `browserMode=observe`; a first
headless pass remains `bound`, and three unchanged strong runs are required for
`trusted`. Hash changes reset trust; failures and technical blockers stay
quarantined or blocked. Use `bc_status` and the offline report to explain the
current step, data, diagnosis, evidence strength, and next action.
