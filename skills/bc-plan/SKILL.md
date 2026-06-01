---
name: bc-plan
description: Use when turning a natural language requirement into a Brain Creator draft test plan through MCP.
---

# Brain Creator Plan

Use Brain Creator MCP planning to generate structured scenarios before code generation.

## Workflow

1. Confirm the target system id.
2. Ensure auth and business rules exist.
3. Call `bc_generate_plan` with `systemId` and the user's requirement.
4. Present the draft scenarios, new term candidates, and rule check results to the user.
5. Call `bc_approve_plan` only after the user confirms the test intent.

Planning must not generate test code directly. The user should confirm the structured plan first.
