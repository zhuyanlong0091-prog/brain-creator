# Trusted control plane

Use the Brain Creator Facade to change runtime state. Do not edit `.brain-creator/local-assets.json`, generated tests, or installed package files to unblock a workflow.

## Keep Agent responses bounded

Facade tools accept `responseMode`:

- `summary`: returns status, a human-readable summary, the recommended next action, and bounded asset references.
- `full`: preserves the existing detailed response for compatibility and audits.

The Brain Creator Skill uses `summary` by default. Request `full` only when you need to inspect a specific asset or diagnose a workflow.

## Verify authentication

Create a protected browser state first, then verify it through the Facade:

```json
{
  "target": "auth",
  "operation": "verify",
  "systemId": "system_xxx",
  "authProfileId": "auth_xxx",
  "responseMode": "summary"
}
```

Verification opens a fresh browser context against the system base URL. A status flag is not accepted as proof. A missing, expired, redirected, or unavailable browser state returns a stable error code and a next action.

Use `operation=archive` to archive an AuthProfile. Use `operation=create` or omit `operation` to preserve the existing creation flow.

## Compile a requirement in one run

Compile all approved TestIntents for one requirement:

```json
{
  "action": "compile-cases",
  "requirementSetId": "requirementSet_xxx",
  "systemId": "system_xxx",
  "modules": ["Orders"],
  "responseMode": "summary"
}
```

You can use `testIntentIds` for an explicit subset. The existing single `testIntentId` input remains compatible.

Each batch creates a `CompileRun` with `ready`, `blocked`, `ambiguous`, `skipped`, and `reused` counts. Compilation is keyed by TestIntent, system, requirement hash, and current System Brain evidence. Repeating an unchanged request reuses the case. Changed evidence creates a new case and marks the old case `superseded`.

Review bounded details with:

```json
{
  "target": "compile-run",
  "knowledgeProjectId": "knowledgeProject_xxx",
  "id": "compileRun_xxx",
  "limit": 25,
  "offset": 0
}
```

## Confirm ambiguous page evidence

When more than one page is plausible, present the candidates and obtain an explicit selection. Then record it:

```json
{
  "action": "confirm-page-binding",
  "testIntentId": "testIntent_xxx",
  "systemId": "system_xxx",
  "pageModelId": "page_xxx",
  "role": "buyer",
  "confirmationNote": "Confirmed from the approved order workflow.",
  "confirm": true
}
```

The decision is evidence, not a hard-coded product rule. It is scoped to the selected TestIntent and system.

## Resolve a Gap safely

Use `resolve-gap`, `dismiss-gap`, or `reopen-gap`. First preview with `confirm=false`; then repeat with `confirm=true`, a non-empty `confirmationNote`, and `evidenceRefs`.

- `resolve-gap`: evidence shows the missing prerequisite is now satisfied.
- `dismiss-gap`: the user explicitly accepts the item as out of scope.
- `reopen-gap`: new evidence makes a resolved or dismissed Gap actionable again.

Every transition is appended to the Gap lifecycle. It does not erase prior review history.

## Reload without restarting MCP

Use `bc_configure target=runtime operation=reload-store` after an external restore operation. Brain Creator refuses the reload while a Suite or Agent task is active. This command is a controlled recovery path, not permission to edit the store manually.

## Error contract

Failed calls preserve `success`, `data`, `errors`, and `traceId`, and add:

```json
{
  "error": {
    "code": "BC_AUTH_VERIFICATION_FAILED",
    "userMessage": {
      "enUS": "The saved browser login could not be verified.",
      "zhCN": "已保存的浏览器登录状态验证失败。"
    },
    "technicalMessage": "...",
    "nextAction": "complete-auth-checkpoint",
    "retryable": false
  }
}
```

Every response receives a new UUID `traceId`. Include it when reporting a failure.
