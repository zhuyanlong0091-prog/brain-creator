---
name: bc-assets
description: Use when searching Brain Creator systems, rules, cases, runs, gaps, and related test assets through MCP.
---

# Brain Creator Assets

Use Brain Creator MCP asset search to inspect what has already been created for a business system.

## Workflow

1. Call `bc_list_cases` with `systemId` when the user asks for test history.
2. Call `bc_list_agent_runs` with `systemId` when the user asks for Planner, Generator, or Healer run history.
3. Call `bc_list_chain_runs` with `systemId` when the user asks for generator/test/healer chain history.
4. Call `bc_list_gaps` with `projectId` and optional `status` when the user asks what is blocked.
5. Call `bc_resolve_gap` only after the user confirms a gap has been handled.
6. Call `bc_search_assets` with `projectId` and a short query for broad asset lookup.
7. Keep results scoped to the current system.

Asset search is for review and traceability. It is not a substitute for user approval of a generated plan.
