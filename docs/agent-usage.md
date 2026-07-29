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
- **MCP CLI connection mode**: install `brain-creator` in a business project and run `brain-creator-install-assets`, `brain-creator-write-mcp-config`, and `brain-creator-doctor`.
- **repo-local plugin installation mode**: register this repository or the installed npm package as a Codex plugin marketplace.

Full setup details are in `docs/mcp-installation.md`.

## Requirement-First Flow

### 1. Create Knowledge Context

The Agent calls `bc_configure target=knowledge-project`. A real system is not required yet.

### 2. Ingest The Requirement

The Agent calls `bc_prepare action=ingest-requirement` for Markdown, TXT, DOCX, PDF, HTTP(S), Obsidian, or Feishu.

For Feishu, Brain Creator uses direct OpenAPI when environment credentials are configured. Otherwise the host Agent reads the document with its lark capability and submits a normalized `RequirementContentPackage`.

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

The Agent presents every Requirement Eval action. Clarifications and missing branches require an explicit `confirmationNote`; direct contradictions require a source revision. It then calls `bc_prepare action=approve-baseline confirm=true` only after the Eval gate passes.

Seven golden samples cover ordinary clauses, complex Markdown rule tables, cross-module workflows, permission matrices, contradictions, and missing branches. Historical quality can be reviewed with `bc_review target=requirement-eval-accuracy`; technical failures remain inconclusive instead of reducing the requirement score.

### 5. Bind And Explore System Brain

The Agent uses `bc_configure target=system` and `bc_configure target=system-binding`, then configures auth. Protected password, recovery, CAPTCHA, or 2FA uses `bc_create_auth_checkpoint` and workspace-local storage state.

The Agent first calls `bc_prepare action=explore-system`. Brain Creator performs a bounded Playwright breadth-first exploration: it visits only HTTP(S) links inside the selected system allowlist and enforces page, depth, and wall-time budgets. `interactionMode` defaults to `off`. The Agent may propose `interactionMode=safe` only when the user needs tab, disclosure, or native-select state evidence; the call remains bounded by `maxInteractionsPerPage` and never submits forms. A verified AuthProfile may provide a workspace-local `storageStatePath`. Login pages, CAPTCHA, 2FA, invalid scopes, or empty evidence block the run and create a Gap; authentication blockers also create a resumable checkpoint.

The exploration creates versioned PageModels, LocatorPoints, ProbeResults, navigation edges, and safe interaction state transitions, then refreshes `systems/<system-id>/brain.md`. Safe probes reject write-like labels and unstable selectors, block non-read HTTP methods and dangerous URLs, restore the page after each probe, and preserve blocked requests as evidence. The Agent must disclose that a misdesigned GET endpoint can still carry residual side-effect risk. For complex menus, data entry, or business workflows, the host Agent supplements evidence through `bc_prepare action=record-page-evidence` and `record-training-evidence`.

### 6. Compile Executable Cases

The Agent calls `bc_prepare action=compile-cases` with `systemId`. Brain Creator binds steps to real PageModel, LocatorPoint, and ProbeResult evidence. It may add an implicit action only when confirmed workflow knowledge provides one unique path. Multiple plausible paths or missing page/locator evidence create a Gap.

### 7. Preview And Execute

The Agent previews `bc_run mode=requirement-suite confirm=false`. After explicit approval it runs `bc_run mode=requirement-suite confirm=true`.

The Generator writes a Playwright test, Playwright executes it, and the Healer performs bounded repairs. Business mismatches create BugReports. Auth, environment, network, locator, or missing evidence creates Gaps.

### 8. Review Evidence

The Agent uses `bc_review` to show requirements, knowledge, coverage, Requirement Eval history, System Brain, system exploration runs, TestIntents, ExecutableCases, evidence, bugs, and Gaps. Approved expected knowledge remains separate from observed system knowledge.

## User Entrypoints

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
