---
name: bc-rules
description: Use when adding or listing Brain Creator business rules used by MCP quality gates.
---

# Brain Creator Rules

Use Brain Creator MCP rules to capture business quality gates before planning tests.

## Workflow

1. Call `bc_add_rule` for requirements that must be checked in generated scenarios.
2. Use `severity: "block"` for required coverage.
3. Use `severity: "warn"` for advisory checks.
4. Call `bc_list_rules` before generating a plan.
5. Call `bc_delete_rule` only after the user confirms the rule no longer applies to the selected system.

QualityGate checks are deterministic in v2 MVP, so rules should use clear domain terms such as order amount or payment status.
