# Brain Creator Agent Usage Guide

This guide is for using Brain Creator inside Claude Code or Codex. You do not need to start from a Web UI, memorize every MCP tool, or manually edit generated test files. The intended experience is:

```text
User one sentence -> Brain Creator skill -> MCP tools -> planner -> reviewed plan -> generator -> healer -> artifacts and gaps
```

## Mental Model

Brain Creator is the testing brain for an agent. Claude Code / Codex is the conversation interface. Brain Creator contributes:

- business system context
- encrypted auth profiles
- glossary terms and aliases
- business rules and quality gates
- draft test cases for human approval
- generated specs and Playwright test files
- agent run history, chain run history, and gaps

Start with a natural request such as `Use Brain Creator to connect this system`. The agent should load the Brain Creator skill internally and choose MCP tools for you; use `Skill("brain-creator")` only as an explicit troubleshooting fallback when automatic matching fails.

If you do not know what to ask next, say:

```text
Use Brain Creator to show /bc help shortcuts.
```

The agent should call `bc_command` with `/bc help` and return the Brain Creator shortcuts, filters, and recommended entrypoints without creating or changing any system assets.

When `/bc status` has no selected system, present the returned compact system picker or connection guidance. Do not expose the raw candidate-id list as an error.

## Installation Modes

Use source checkout mode when you are developing Brain Creator itself. In this mode, clone the repository, run `npm install`, then use `npm run dev:mcp`.

Use MCP CLI connection mode when you want to use Brain Creator from a business project. The recommended setup is project-local: run `npm install --save-dev brain-creator`, then `npx brain-creator-install-assets`, `npx brain-creator-write-mcp-config`, and `npx brain-creator-doctor` once in the business project. The generated MCP config connects the server with `npx brain-creator-mcp`, so the local package is used.

Use repo-local plugin installation mode when you want Brain Creator to appear through Codex `/plugin`. The repository provides `plugins/brain-creator/.codex-plugin/plugin.json`, `plugins/brain-creator/.mcp.json`, bundled Brain Creator skills, and `.agents/plugins/marketplace.json` for local marketplace discovery. This mode registers the Skill and MCP server metadata, while the executable commands still need to be available through a local package install or a future npm publish.

Full setup details are in `docs/mcp-installation.md`.

## Flow Checklist

The normal flow is: connect a business system, configure auth, add business language, add business rules, generate a draft plan, approve the plan, run the chain, then review artifacts and gaps.

## A Complete User Flow

### 1. Connect A Business System

Say something like:

```text
Use Brain Creator to connect the order admin system at https://orders.example.test for local QA. The default language is zh-CN and only that base URL is allowed.
```

Expected agent behavior:

- create or reuse a Brain Creator business system
- keep later assets scoped to that system
- summarize the system id, environment, base URL, and onboarding status

Behind the scenes, this uses tools such as `bc_create_system`, `bc_list_systems`, and `bc_system_overview`.

### 2. Configure Auth

Say:

```text
Configure token auth for the QA admin role. The token is Bearer <token>. Do not repeat the token back to me.
```

Expected agent behavior:

- create an encrypted auth profile
- verify it when possible
- generate a local seed file when the chain needs browser auth
- avoid echoing secrets into summaries

Behind the scenes, this uses `bc_create_auth`, `bc_verify_auth`, `bc_list_auth`, and `bc_generate_seed`.

### 3. Add Business Language

Say:

```text
Add glossary terms: 提交订单 means Submit order, 订单总额 means Order total, both scoped to /orders.
```

Expected agent behavior:

- save terms under the selected business system
- include aliases and page scope when provided
- use terms in future planning context

After planning, Brain Creator may also return new term candidates. The agent should ask which candidates to keep, then confirm them.

### 4. Add Business Rules

Say:

```text
Add a blocking rule: every checkout test must assert that Order total is visible.
```

Expected agent behavior:

- store the rule in the current system
- use it as a quality gate when generating draft plans
- report whether the draft plan covers the rule

Behind the scenes, this uses `bc_add_rule` and `bc_list_rules`.

### 5. Generate A Draft Plan

Say:

```text
Generate a test plan for submitting an order and checking the order total. Do not generate code until I approve the plan.
```

Expected agent behavior:

- build a planner context from system, auth, glossary, and rules
- generate structured scenarios
- show the draft plan in natural language
- show rule coverage and new glossary candidates
- wait for approval before code generation

Behind the scenes, this uses `bc_generate_plan`. This is the moment where the agent should help you review intent, not rush into code.

### 6. Approve Or Adjust The Plan

If the draft is right, say:

```text
Approve this plan and run it.
```

If it needs changes, say:

```text
Change the second scenario so it also verifies the payment status, then show me the updated plan.
```

Expected agent behavior:

- update draft scenarios when requested
- call approval only after you confirm the intent
- treat approval as the contract for generation

Behind the scenes, this uses `bc_update_plan` and `bc_approve_plan`.

### 7. Run The Chain

After approval, the agent should run the generator/test/healer chain:

- generator writes a Playwright `.spec.ts`
- Playwright executes the generated test
- healer retries bounded repairs if the generated test fails
- unresolved failures become gaps instead of fake success

Behind the scenes, this uses `bc_run_chain`.

### 8. Review Artifacts And Gaps

Ask:

```text
Show me the generated artifacts, latest chain result, and any open gaps for this system.
```

Expected agent behavior:

- summarize latest spec and test artifacts
- provide paths to generated files
- show chain status and healer attempts
- list open gaps with reason, severity, and next action

Behind the scenes, this uses `bc_artifact_overview`, `bc_list_specs`, `bc_list_tests`, `bc_read_spec`, `bc_read_test`, `bc_list_chain_runs`, and `bc_list_gaps`.

### 9. Stop And Resume A Protected Login

If a login requires password, recovery, CAPTCHA, or 2FA, the agent should call `bc_create_auth_checkpoint` and wait while you complete the protected step manually. The checkpoint stores only the reason and resume instruction, never the secret value.

If you close the login page or stop the attempt, the agent should call `bc_cancel_plan`. Brain Creator records the test case as cancelled and creates a `user-interruption` Gap.

To continue later:

1. Complete or cancel the pending auth checkpoint.
2. Call `bc_resume_plan` to return the cancelled case to draft.
3. Review and approve the plan again before running the chain.

Use `bc_report_gap` for external preflight failures such as blocked network access, unreachable target pages, or missing evidence outside a chain run.

## Session Resume: The New-Session Entry Point

When the agent opens a new session for an existing Brain Creator system, the first call should be `bc_session_resume`. It returns a full snapshot in one call:

- System profile, auth profiles, checkpoints
- Business rules, glossary terms
- Test case counts by status
- Recent agent runs and chain runs (last 5 each)
- Generated artifact counts
- Open gaps
- **Bridge preflight status** (`{ ok, checkedAt }`) — tells the agent whether Planner/Generator/Healer are reachable
- **Recommended next action** — computed from the snapshot state

This replaces 6–7 independent queries and gives the agent everything it needs to present a status summary and take the next step.

For the full E2E flow documentation, see `docs/e2e-session-resume-workflow.md`.

## Recommended One-Sentence Prompts

Use these when you want the agent to drive the flow without tool-level instructions:

```text
Use Brain Creator to connect this CRM as a reusable business system, configure token auth, and prepare it for generating Playwright tests.
```

```text
Use Brain Creator for the selected order system, add a blocking business rule that every checkout test must assert Order total, then generate a draft plan for order submission and wait for my approval.
```

```text
Use Brain Creator to continue the approved case for the selected system, run the chain, and summarize generated artifacts and open gaps.
```

```text
Use Brain Creator to show the current system overview, latest generated specs/tests, chain history, and unresolved gaps.
```

### New session prompts (session resume path)

```text
Use Brain Creator to check the order-admin system status and tell me what to do next.
```

```text
Use Brain Creator to show /bc help shortcuts.
```

```text
Use Brain Creator to resume where I left off with the order-admin system. If the bridge isn't working, tell me how to fix it.
```

## What The Agent Should Not Do

- Do not create or prioritize a Web UI for v2.
- Do not mix assets across business systems.
- Do not generate code before plan approval.
- Do not claim success when `bc_run_chain` failed.
- Do not invent locators, auth state, or API evidence when Brain Creator reports a gap.
- Do not repeat secrets after auth creation.

## Operator Checklist

Before a real run:

- dependencies are installed with `npm install`
- Brain Creator MCP is configured for the agent client
- Claude bridge env vars are set when live Planner / Generator / Healer runs are needed
- the target system URL is inside the allowlist
- auth secrets are test credentials, not production credentials

After a run:

- check chain status
- read generated spec/test paths if needed
- resolve or keep gaps explicitly
- confirm new glossary candidates only if they are useful for the system

## Verification Commands

Use these commands when validating the local setup:

```bash
npm test
npx tsc --noEmit
npm run verify:live-claude-chain
npm run verify:live-agent-artifacts
npm run verify:live-mcp-workflow
npm run verify:live-claude-skill-workflow
npm run verify:live-session-resume-workflow
```

The strongest user-experience check is `npm run verify:live-claude-skill-workflow`: it launches a real Claude Code session, uses a natural Brain Creator request, calls Brain Creator MCP tools, reaches `bc_run_chain`, and reviews artifacts.

## Troubleshooting

If the agent says the Claude subagent bridge is missing, set:

```bash
BRAIN_CREATOR_AGENT_COMMAND=claude
BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

If the chain fails, ask the agent to show open gaps and latest chain runs. A failed chain with a clear gap is a valid Brain Creator outcome; it means the system refused to fabricate missing evidence.

If the agent starts discussing UI screens, redirect it:

```text
Brain Creator v2 is agent-native. Use Brain Creator and the MCP tools; do not design a Web UI.
```
