---
name: bc-run
description: Use when running an approved Brain Creator test case through generator, Playwright test, and healer MCP flow.
---

# Brain Creator Run

Use Brain Creator MCP run tools only after a test case is approved.

## Workflow

1. Confirm the test case has `status: "approved"`.
2. Call `bc_run_chain` with the approved `caseId`.
3. Report ChainRun status, generated spec path, generated test path, healer attempts, and any gaps.

Use `bc_run_agent` only when debugging a single Planner, Generator, or Healer run. It records an AgentRun but does not replace the approved-case execution flow.

If the chain fails after healing attempts, treat returned `healer-skip` gaps as work items rather than claiming the test is complete.
