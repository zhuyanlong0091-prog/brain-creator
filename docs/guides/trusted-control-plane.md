# Trusted control plane

Use the Brain Creator Facade to change runtime state. Do not edit `.brain-creator/store/`, `.brain-creator/local-assets.json`, generated tests, or installed package files to unblock a workflow.

## Keep Agent responses bounded

Facade tools accept `responseMode`:

- `summary`: returns status, a human-readable summary, the recommended next action, and bounded asset references.
- `full`: preserves the existing detailed response for compatibility and audits.

The Brain Creator Skill uses `summary` by default. Request `full` only when you need to inspect a specific asset or diagnose a workflow.

Execution evidence is strict by default for real Playwright runs. Callers may set
`evidenceMode: "strict"` explicitly; `evidenceMode: "compatibility"` is only
accepted with an injected test runner and cannot downgrade a real process. A run
without structured Reporter evidence is not an auditable strong pass.

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

Each batch creates a `CompileRun` with `ready`, `needsExploration`, `needsData`, `blocked`, `ambiguous`, `skipped`, and `reused` counts. Compilation is keyed by TestIntent, system, requirement hash, and current System Brain evidence. Repeating an unchanged request reuses the case. Changed evidence creates a new case and marks the old case `superseded`.

After refreshing System Brain, use `bc_prepare action=reconcile-system-brain` to compare approved Requirement semantics with the selected system's observed evidence. Review the resulting bindings with `bc_review target=semantic-binding`; alias, multi-step expansion, and conditional matches remain auditable candidates, while conflicts and missing observations stay unresolved. When a behavioral ChangeSet marks intents or cases stale, confirm the new snapshot and call `bc_prepare action=recompile-stale-cases` to recompile only the affected intents.

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

## Resolve compilation exploration

Missing or ambiguous System Brain evidence creates an `ExplorationTask`. It is not a final Gap. Review the task through its CompileRun or `bc_status`, collect the requested page, navigation, state, or locator evidence, then preview and confirm the outcome:

```json
{
  "action": "resolve-exploration-task",
  "explorationTaskId": "explorationTask_xxx",
  "explorationOutcome": "resolved",
  "evidenceRefs": ["page-model:page_xxx", "locator-point:locator_xxx"],
  "confirm": true
}
```

A resolved task automatically recompiles its TestIntent. A failed task requires a failure reason and creates a `system-brain-exploration` Gap. Cancellation records the decision without fabricating a blocker.

## Authorize stateful exploration

For first-time system onboarding, use `bc_prepare action=create-onboarding-plan` after Requirement Eval passes, the system is bound, and every declared role has verified auth. Brain Creator derives concrete questions from confirmed workflows, state machines, decision tables, and TestIntents, then creates the bounded ExplorationPlan behind the OnboardingPlan.

Preview `approve-onboarding-plan`, present the requirement summary, unresolved questions, coverage matrix, roles, routes, writes, duration, and cleanup policy, then repeat it with `confirm=true`, `confirmedBy`, and `confirmationNote`. The default `approvalStage=exploration` authorizes bounded evidence collection; it does not claim that the requirement is ready for execution. After exploration refreshes the coverage matrix, use `approvalStage=execution` for the strict gate: every coverage item must be covered, every allowed action must have requirement and system evidence, and unresolved questions must be empty. A given requirement version and target system has exactly one OnboardingPlan: repeated creation requests return the existing plan, while each draft refresh increments its revision history. Start exploration with `start-onboarding-plan`; `bc_status` and `bc_review target=onboarding-plan` recover the active plan. Existing separate baseline and ExplorationPlan approvals remain compatible for follow-up work.

Read-only exploration cannot discover controls that appear only after create, submit, approval, rejection, or close transitions. For later evidence gaps, create an `ExplorationPlan` from one or more pending ExplorationTasks. The plan must name the authenticated roles, allowlisted routes, authorized actions, write budget, duration, and cleanup policy.

Use `bc_prepare action=create-exploration-plan`, preview `approve-exploration-plan`, and confirm it once with a human note and confirmer. Brain Creator rejects production environments, unverified cross-system roles, out-of-scope URLs, destructive actions, and over-budget results. `start-exploration-plan` returns a bounded host-Agent work package; unresolved data returns `needs-data` first.

After browser execution, submit action-level source references plus PageModel, SystemExploration, or TrainingSession evidence with `submit-exploration-result`. Created test data must be released for `delete` or `close` cleanup policies. Missing cleanup blocks the plan and creates a high-severity Gap. A successful result refreshes System Brain, resolves every linked ExplorationTask, and resumes compilation automatically. Review the audit trail with `bc_review target=exploration-plan`. Use `cancel-exploration-plan` when the user declines the proposed writes.

## Resolve a Gap safely

Use `resolve-gap`, `dismiss-gap`, or `reopen-gap`. First preview with `confirm=false`; then repeat with `confirm=true`, a non-empty `confirmationNote`, and `evidenceRefs`.

- `resolve-gap`: evidence shows the missing prerequisite is now satisfied.
- `dismiss-gap`: the user explicitly accepts the item as out of scope.
- `reopen-gap`: new evidence makes a resolved or dismissed Gap actionable again.

Every transition is appended to the Gap lifecycle. It does not erase prior review history.

## Prepare deterministic test data

When a compiled case contains a deterministic `generated` or `unique` data profile,
the Facade can resolve that value without opening the target system:

```json
{
  "action": "prepare-test-data",
  "knowledgeProjectId": "knowledge-project-id",
  "systemId": "system-id",
  "executableCaseId": "executable-case-id",
  "confirm": true,
  "automatic": true
}
```

This mode only materializes a value already derived from the approved data plan.
The executable case data plan must already be confirmed. It does not create a
business record, claim lookup evidence, or bypass cleanup.
Existing-record lookup, record creation, approval, and cleanup continue through a
preview plus an auditable Host Agent task.

## Reload without restarting MCP

Use `bc_configure target=runtime operation=reload-store` after an external restore operation. Brain Creator refuses the reload while a Suite or Agent task is active. Runtime Bridge and connector settings can be updated without restarting MCP:

```text
bc_configure target=runtime operation=update bridgeProvider=codex bridgeCommand=codex
bc_configure target=runtime operation=reload-config
```

The runtime file stores only executable settings and `env:`/`file:` references. Environment variables have highest priority. Brain Creator validates and preflights a candidate before persisting or activating it, then rebuilds the built-in OAuth/CAS/SAML Provider Registry and configured Feishu reader; a failed reload keeps the previous configuration. This command is a controlled recovery/configuration path, not permission to edit the store or runtime file manually.

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
