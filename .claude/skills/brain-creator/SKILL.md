---
name: brain-creator
description: Use when a user gives a one-sentence Brain Creator request in Claude Code or Codex and expects an agent-native testing workflow.
---

# Brain Creator

Use Brain Creator as an agent-native testing business brain through MCP tools. Claude Code or Codex is the user interface; Brain Creator supplies system context, auth handling, business language, planning, generated artifacts, chain execution, and gap tracking.

Do not create or prioritize a Web UI. If the user asks for an entrypoint, treat the entrypoint as this skill plus Brain Creator MCP tools.

## One-sentence Workflow

When the user gives a one-sentence request such as "connect this CRM and generate tests for order approval":

1. Call `bc_list_systems` and reuse the matching system, or call `bc_create_system` if the user supplied enough system details.
2. If auth is needed, call `bc_create_auth`, then `bc_verify_auth`, then `bc_generate_seed`; never echo secrets back to chat.
3. Capture known business language with `bc_add_term` and required checks with `bc_add_rule` when the user provides them.
4. Call `bc_generate_plan` with the selected `systemId` and the user's natural language requirement.
5. Present scenarios, new term candidates, and rule check results; call `bc_update_plan` only when the user asks for changes.
6. Call `bc_approve_plan` only after the user confirms the test intent.
7. Call `bc_run_chain` for the approved case, then report generated spec/test paths, ChainRun status, healer attempts, and gaps.
8. Call `bc_artifact_overview`, `bc_list_specs`, `bc_list_tests`, `bc_list_cases`, and `bc_list_gaps` when summarizing outcomes or continuing later.

## Guardrails

- Never skip plan approval before code generation.
- Never fabricate missing evidence; create or report gaps through `bc_list_gaps` and `bc_resolve_gap`.
- Never mix assets across systems. All planning, execution, search, and gap handling must use the selected system id.
- Use `bc_run_agent` only for diagnostics; the normal user workflow is `bc_generate_plan` to `bc_approve_plan` to `bc_run_chain`.
- Treat generated artifacts as local workspace assets. Use `bc_read_spec` and `bc_read_test` only for paths returned by Brain Creator list tools.
