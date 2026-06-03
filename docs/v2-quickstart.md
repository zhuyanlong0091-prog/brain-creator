# Brain Creator v2 Quickstart

Brain Creator v2 is a local testing-domain logic library plus MCP toolset. Claude Code or another MCP client provides the conversation layer; Brain Creator stores business systems, auth profiles, rules, structured test cases, agent runs, chain runs, and gaps.

## Setup

Install dependencies:

```bash
npm install
```

Verify the local baseline:

```bash
npm test
npx tsc --noEmit
```

Start the Brain Creator MCP server:

```bash
npm run mcp
```

Claude Code integration is declared in:

- `.claude/settings.json` for the Brain Creator MCP server.
- `.mcp.json` for Brain Creator and Playwright Test MCP servers.
- `skills/bc-*` for tool-oriented Brain Creator workflows.

Playwright agent prompts and agent definitions are generated under `.claude/agents` and `.claude/prompts`.

Planner, Generator, and Healer execution is routed through an explicit `AgentBridge`.
When no bridge is configured, Brain Creator returns a clear failure:

```text
Claude subagent bridge required
```

For local MCP usage, configure a Claude subprocess bridge:

```bash
BRAIN_CREATOR_AGENT_COMMAND=claude
BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

The bridge sends a subagent prompt over stdin and records stdout/stderr into `AgentRun` logs. Tests use a real Node subprocess fixture for this contract; production usage should point the command to Claude Code or a wrapper that can dispatch `#playwright-test-planner`, `#playwright-test-generator`, and `#playwright-test-healer`.

## Core Flow

### 1. Create A Business System

Use `bc_create_system` to create the reusable system context.

Required inputs:

- `name`
- `environment`
- `baseUrl`
- `defaultLocale`
- `urlAllowlist`

Use `bc_list_systems` and `bc_system_overview` to inspect existing systems and onboarding state.

### 2. Configure Auth

Use `bc_create_auth` with the selected system id as `projectId`.

Supported login methods:

- `password`
- `cookie`
- `token`
- `script`

Use `bc_list_auth` to inspect the current system's auth profiles. Returned auth profiles redact secrets.

Use `bc_verify_auth` after creating a profile.

Use `bc_generate_seed` with `systemId` and optional `authProfileId` to write the local Playwright seed fixture. The tool returns only metadata such as `seedPath`, `loginMethod`, and `secretKeys`. Local generated seed files may contain secrets and should not be copied into chat or committed if they contain real credentials.

### 3. Add Glossary Terms

Use `bc_add_term` to seed important business language before planning.

Required inputs:

- `projectId`
- `key`
- `zhCN`
- `enUS`
- `aliases`
- `pageScope`

After `bc_generate_plan`, review returned `newTerms`. Use `bc_batch_confirm_terms` with the draft `caseId` to add confirmed candidates to the system glossary and remove ignored candidates from the draft case.

Use `bc_list_terms` to inspect the current glossary for a system.

Use `bc_update_term` to correct a term and `bc_delete_term` to remove terms that should not become reusable system knowledge.

### 4. Add Business Rules

Use `bc_add_rule` before planning tests.

Rules should be deterministic and concrete. For example:

```text
必须校验订单金额
```

Use `severity: "block"` for required coverage and `severity: "warn"` for advisory checks. Use `bc_list_rules` to review current rules.

Use `bc_delete_rule` with `systemId` and `ruleId` only when the user confirms a rule should no longer gate that system's generated cases. Rules cannot be deleted across systems.

### 5. Generate A Draft Plan

Use `bc_generate_plan` with:

- `systemId`
- `requirement`

The planner flow builds context, writes a prompt, writes a seed file, invokes the planner, parses the generated spec into structured scenarios, checks business rules, extracts new term candidates, records an AgentRun, and creates a draft TestCase.

Review the returned scenarios, new terms, and rule check result with the user.

### 6. Update The Draft Plan

Use `bc_update_plan` with `caseId` and replacement `scenarios` when the user wants to adjust the structured draft before approval.

Only draft test cases can be updated. After approval, the test case becomes the execution contract for Generator and Healer.

### 7. Approve The Plan

Use `bc_approve_plan` only after the user confirms the test intent.

The approved TestCase is the boundary between planning and code generation.

### 8. Run A Single Agent

Use `bc_run_agent` with `systemId`, `agent`, `inputSummary`, `args`, and `outputPaths` when debugging Planner, Generator, or Healer independently.

This records an AgentRun for traceability. It is a diagnostic entry point and does not replace `bc_run_chain` for approved test execution.

Use `bc_list_agent_runs` with the selected `systemId` to review Planner, Generator, and Healer run history.

### 9. Run The Chain

Use `bc_run_chain` with the approved `caseId`.

The chain serializes scenarios to a Markdown spec, calls the generator, runs Playwright tests, and invokes the healer when tests fail. If healing is exhausted, the ChainRun contains an open `healer-skip` Gap.

### 10. Review Cases And Gaps

Use `bc_list_chain_runs` with the selected `systemId` to review generator/test/healer execution history.

Use `bc_list_specs` and `bc_list_tests` with the selected `systemId` to review generated Markdown specs and Playwright test file paths.

Use `bc_read_spec` and `bc_read_test` with `systemId` and a listed artifact `path` to inspect generated content. Reads are limited to recorded artifacts inside the local workspace.

Use `bc_artifact_overview` with `systemId` when the user needs a non-path-oriented summary of generated artifact counts and latest content snippets.

Use `bc_list_cases` with the selected `systemId` to review draft, approved, passed, and failed test cases.

Use `bc_list_gaps` with `projectId` and optional `status` to review open or resolved gaps.

Use `bc_resolve_gap` with `projectId` and `gapId` after the user confirms the missing evidence or issue has been handled.

### 11. Search Assets

Use `bc_search_assets` with:

- `projectId`
- `query`

Search covers systems, auth profiles, business rules, test cases, agent runs, chain runs, gaps, glossary terms, and retained v1 assets.

## Local Verification Flow

The automated local smoke flow is covered by `src/mcp/localFlow.test.ts`:

1. `bc_create_system`
2. `bc_create_auth`
3. `bc_verify_auth`
4. `bc_list_auth`
5. `bc_generate_seed`
6. `bc_add_term`
7. `bc_add_rule`
8. `bc_delete_rule`
9. `bc_generate_plan`
10. `bc_batch_confirm_terms`
11. `bc_update_plan`
12. `bc_approve_plan`
13. `bc_run_agent`
14. `bc_list_agent_runs`
15. `bc_run_chain`
16. `bc_list_chain_runs`
17. `bc_list_specs`
18. `bc_list_tests`
19. `bc_read_spec`
20. `bc_read_test`
21. `bc_artifact_overview`
22. `bc_list_terms`
23. `bc_update_term`
24. `bc_delete_term`
25. `bc_list_cases`
26. `bc_list_gaps`
27. `bc_search_assets`

Run it with:

```bash
npm test -- src/mcp/localFlow.test.ts
```

To verify a live Claude subprocess bridge can dispatch all three Brain Creator agents, run:

```bash
npm run verify:live-claude-chain
```

This smoke command calls planner -> generator -> healer through the same Claude subprocess bridge used by `bc_run_agent`, without creating generated test files. On Windows npm installs, the bridge resolves `claude.cmd` from PATH and runs it through a shell so stdin is preserved.

To verify live Claude agent outputs can become runnable Brain Creator artifacts, run:

```bash
npm run verify:live-agent-artifacts
```

This artifact smoke writes a Planner spec artifact, writes and runs a Generator Playwright test, then repairs a controlled failing test through Healer and reruns it. Set `BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS=1` to keep the temporary evidence directory for manual inspection.

To verify a one-sentence Agent-native request can drive the Brain Creator MCP flow, run:

```bash
npm run verify:live-mcp-workflow
```

This smoke creates a live demo system from one-sentence intent, then calls `bc_generate_plan`, `bc_approve_plan`, and `bc_run_chain` with the real Claude bridge. It verifies recorded spec/test artifacts through Brain Creator asset tools.

## Generated Files

Playwright initialization creates:

- `.claude/agents/playwright-test-planner.md`
- `.claude/agents/playwright-test-generator.md`
- `.claude/agents/playwright-test-healer.md`
- `.claude/prompts/*`
- `tests/generated/seed.spec.ts`

Brain Creator runtime files are written under `.brain-creator/` by default. Planner context files are written under `specs/` and are ignored by git.

## Known Limits

- The current MVP is local-first and uses JSON persistence.
- `bc_generate_plan` and `bc_run_chain` are tested with mockable and subprocess AgentBridge implementations; `npm run verify:live-claude-chain` is the local live Claude bridge gate for planner -> generator -> healer dispatch.
- The current Playwright CLI does not expose `playwright agent`; `npx playwright init-agents` generates Claude agent definitions and prompts, so Planner/Generator/Healer execution should use the Claude subprocess bridge rather than a Playwright CLI placeholder.
- The Healer loop is bounded and creates a Gap when it cannot fix a failing generated test.
- No Web UI is included in v2.
- PostgreSQL, CI integration, LLM quality review, and multi-agent parallelism are out of scope for this phase.
