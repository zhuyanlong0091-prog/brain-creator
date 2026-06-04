# Brain Creator

Brain Creator is an agent-native testing brain for **Claude Code / Codex**. It is a local business-logic library plus MCP toolset that helps an agent connect a business system, understand business language, generate reviewed test plans, run Playwright test generation, heal failures, and track reusable testing assets.

**No Web UI:** the product entrypoint is the agent conversation. In Claude Code, start with `Skill("brain-creator")`; in Codex, ask for the Brain Creator workflow and let the agent use the configured MCP tools.

## What You Can Do

- Connect multiple business systems with isolated auth, glossary, rules, cases, artifacts, and gaps.
- Configure token, cookie, password, or script auth without echoing secrets back into later responses.
- Add business terms and rules so generated tests match the system's domain language.
- Generate a draft test plan first, review it in natural language, then approve it before code generation.
- Run the planner -> generator -> healer chain and inspect generated Markdown specs and Playwright tests.
- Review gaps when evidence is missing or a generated chain cannot be repaired safely.

## Fast Start

Install dependencies and verify the local baseline:

```bash
npm install
npm test
npx tsc --noEmit
```

Start the Brain Creator MCP server:

```bash
npm run mcp
```

Configure the Claude subprocess bridge when running real Planner / Generator / Healer flows locally:

```bash
BRAIN_CREATOR_AGENT_COMMAND=claude
BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'
BRAIN_CREATOR_AGENT_TIMEOUT_MS=120000
```

On Windows PowerShell, set the same values with `$env:` before launching the MCP client.

## Agent Entry

Use a one-sentence request in Claude Code or Codex:

```text
Use Skill("brain-creator"). Connect the local order system, add a rule that order total must be visible, generate a test plan, wait for my approval, then run the chain.
```

The agent should load the Brain Creator skill, select the matching MCP tools, create or reuse a business system, configure auth if needed, generate a draft plan, ask for approval, run `bc_run_chain`, and summarize artifacts and gaps.

For a full user-facing guide, see [docs/agent-usage.md](docs/agent-usage.md).

## Verification

Core checks:

```bash
npm test
npx tsc --noEmit
```

Live agent checks:

```bash
npm run verify:live-claude-chain
npm run verify:live-agent-artifacts
npm run verify:live-mcp-workflow
npm run verify:live-claude-skill-workflow
```

`npm run verify:live-claude-skill-workflow` verifies the real Claude Code session entrypoint: `Skill("brain-creator")` is loaded, Brain Creator MCP tools are selected, `bc_run_chain` succeeds, and artifacts are summarized.

## Important Paths

- `.claude/skills/brain-creator/SKILL.md` - Claude Code project skill entrypoint.
- `skills/brain-creator/SKILL.md` - portable Brain Creator skill definition.
- `src/mcp/` - MCP server, tool schemas, and handlers.
- `src/agent/` - prompt building, seed generation, case formatting, orchestration, quality checks, live smoke parsing.
- `src/domain/` - business systems, auth, glossary, rules, cases, runs, gaps, and repository persistence.
- `docs/v2-quickstart.md` - tool-level setup and API-style workflow.
- `docs/agent-usage.md` - end-user agent workflow.

## Current Limits

- Brain Creator v2 is local-first and uses JSON persistence.
- The normal interface is Claude Code / Codex, not a browser UI.
- The Playwright CLI currently supplies Claude agent definitions; Brain Creator calls them through a Claude subprocess bridge.
- PostgreSQL, CI live-smoke execution, LLM quality review, and parallel agent execution are future enhancements.
