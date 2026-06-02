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

Planner, Generator, and Healer execution is intentionally routed through an explicit `AgentBridge`.
When no bridge is configured, Brain Creator returns a clear failure:

```text
Claude subagent bridge required
```

Local tests can provide a mock command bridge, but production MCP usage should run these steps through Claude subagents rather than a direct Playwright CLI command.

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

### 9. Run The Chain

Use `bc_run_chain` with the approved `caseId`.

The chain serializes scenarios to a Markdown spec, calls the generator, runs Playwright tests, and invokes the healer when tests fail. If healing is exhausted, the ChainRun contains an open `healer-skip` Gap.

### 10. Review Cases And Gaps

Use `bc_list_chain_runs` with the selected `systemId` to review generator/test/healer execution history.

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
8. `bc_generate_plan`
9. `bc_batch_confirm_terms`
10. `bc_update_plan`
11. `bc_approve_plan`
12. `bc_run_agent`
13. `bc_run_chain`
14. `bc_list_chain_runs`
15. `bc_list_terms`
16. `bc_update_term`
17. `bc_delete_term`
18. `bc_list_cases`
19. `bc_list_gaps`
20. `bc_search_assets`

Run it with:

```bash
npm test -- src/mcp/localFlow.test.ts
```

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
- `bc_generate_plan` and `bc_run_chain` are tested with mockable AgentBridge implementations; full Claude Code subagent validation is still a follow-up.
- The current Playwright CLI does not expose `playwright agent`; `npx playwright init-agents` generates Claude agent definitions and prompts, so real Planner/Generator/Healer execution needs the Claude subagent bridge rather than the placeholder CLI command.
- The Healer loop is bounded and creates a Gap when it cannot fix a failing generated test.
- No Web UI is included in v2.
- PostgreSQL, CI integration, LLM quality review, and multi-agent parallelism are out of scope for this phase.
