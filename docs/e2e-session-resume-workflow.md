# E2E: Session Resume → Bridge Preflight → Plan → Full Workflow

This document describes the real Claude Code / Codex E2E flow that starts with `bc_session_resume`, runs a bridge preflight, generates a plan, and executes the full workflow. It is the canonical path for new sessions connecting to an existing Brain Creator business system.

## Why This Path Matters

Before `bc_session_resume`, a new Claude Code session needed 6–7 independent MCP tool calls just to discover the current system state:

```text
bc_list_systems → bc_list_auth → bc_list_rules → bc_list_terms
→ bc_list_cases → bc_list_gaps → bc_list_chain_runs
```

`bc_session_resume` replaces all of them with **one call**. It returns:

- System profile
- Auth profiles + checkpoints
- Business rules
- Glossary terms
- Test case counts by status (draft / approved / passed / failed / cancelled)
- Recent agent runs and chain runs (last 5 each)
- Generated artifact counts (specs + tests)
- Open gaps
- **Bridge preflight status** (`{ ok: boolean, error?: string, checkedAt: string }`)
- **Recommended next action** (computed from the snapshot)

The bridge preflight checks Agent Bridge availability in ≤5 seconds. If the bridge is missing or unreachable, the session resume still succeeds — but `bridge.ok` is `false` and `nextAction` tells the user to configure the bridge before planning.

## Complete E2E Flow

### Step 0: User enters the session

The user opens a new Claude Code session and sends a one-sentence request:

```text
Use Brain Creator to continue testing the order-admin system. I want to generate a test for the refund flow and run it.
```

### Step 1: `bc_session_resume` — Full snapshot

The agent calls `bc_session_resume` with the selected `systemId`.

**What happens behind the scenes:**

1. Read system profile, auth profiles, auth checkpoints, rules, terms, cases, agent runs, chain runs, open gaps, specs, and tests — all in one pass.
2. Run `preflightAgentBridge` (5-second timeout):
   - Bridge configured → ping the Claude subprocess → `{ ok: true }`
   - Bridge not configured → `{ ok: false, error: "Agent bridge not configured..." }`
   - Bridge unreachable → `{ ok: false, error: "Agent bridge unreachable (5000ms timeout): ..." }`
3. Compute `nextAction` from the snapshot:
   - No auth → `complete_onboarding: 配置鉴权`
   - Bridge not ok → `configure_bridge: 设置 BRAIN_CREATOR_AGENT_COMMAND`
   - Open gaps → `resolve_gaps: 存在待处理的 Gap`
   - Failed cases → `review_failures: 存在失败用例`
   - Approved cases waiting → `run_chain: 已批准用例等待执行`
   - All ready → `generate_plan: 系统就绪，可以生成新测试计划`

**Expected agent behavior:**

Present a concise summary to the user:

```text
order-admin 系统快照：
- 环境：staging，基 URL：https://orders.example.test
- 鉴权：1 个 profile（qa-admin / token），bridge 可用
- 术语：3 个，业务规则：2 个
- 用例：1 个已批准待执行，0 个失败，2 个通过
- 产物：3 个 spec，3 个 test
- 开放 Gap：0 个
- 建议下一步：run_chain — 已批准用例等待执行
```

If `bridge.ok` is `false`, the agent should guide the user to configure the bridge before attempting `bc_generate_plan` or `bc_run_chain`.

### Step 2: `bc_generate_plan` — Bridge preflight + plan draft

The agent calls `bc_generate_plan` with the user's requirement.

**What happens behind the scenes:**

1. **Bridge preflight** (runs first, ≤5 seconds):
   - If `bridge.ok` is `false` → returns immediately with a structured error, **no 120-second timeout**.
   - Error message includes: "Agent bridge not configured. Set BRAIN_CREATOR_AGENT_COMMAND to enable Planner/Generator/Healer."
2. If bridge is healthy → build planner context from system, auth, rules, terms → invoke Planner subprocess → parse structured scenarios → run quality gate checks → extract candidate terms → create draft TestCase.

**Expected agent behavior:**

If bridge preflight fails, tell the user clearly:

```text
Planner 不可用：Agent bridge 未配置。

要启用测试计划生成，请设置环境变量：
  BRAIN_CREATOR_AGENT_COMMAND=claude
  BRAIN_CREATOR_AGENT_ARGS='["--print","--permission-mode","acceptEdits"]'

配置后重新运行即可。
```

If bridge is healthy, present the draft scenarios, rule check results, and new term candidates.

### Step 3: User reviews and approves

The user reviews the scenarios and says:

```text
Looks good. Approve and run it.
```

### Step 4: `bc_full_workflow` — One-click approve + execute

The agent calls `bc_full_workflow` with the `caseId`.

**What happens behind the scenes:**

1. `bc_approve_plan` — set case status to `approved`.
2. `bc_run_chain` — serialize spec → invoke Generator → run Playwright test → invoke Healer on failure (up to `maxHealAttempts` retries) → create Gap if healing exhausted.
3. Both steps include bridge preflight before invoking subprocesses.

**Expected agent behavior:**

Report the outcome:

```text
✅ 全流程完成 (case_xxx)：
- Spec：specs/case_xxx.md
- Test：tests/generated/case_xxx.spec.ts
- ChainRun：succeeded，Healer 重试：0 次
- Gap：无
```

### Step 5: `bc_session_resume` — Confirm final state

The agent calls `bc_session_resume` again to confirm the updated state. The snapshot now shows:

- `cases.byStatus.passed` incremented
- `recentRuns.chainRuns[0]` shows the just-completed run
- `artifacts.specs` and `artifacts.tests` incremented
- `nextAction` updated (e.g., `generate_plan` for the next feature)

## Bridge Preflight: Detailed Behavior

The preflight runs in these tools:

| Tool | Preflight timing | Notes |
|---|---|---|
| `bc_session_resume` | Included in snapshot | Non-blocking: returns `bridge: { ok, error }` even if bridge is down |
| `bc_generate_plan` | First thing, before prompt building | Blocking: returns error immediately if bridge is not ok |
| `bc_run_chain` | First thing, before spec serialization | Blocking: returns error immediately |
| `bc_full_workflow` | First thing (inherits from `bc_run_chain`) | Blocking: returns error immediately |

### Preflight outcomes

| Bridge state | `bc_session_resume` | `bc_generate_plan` / `bc_run_chain` |
|---|---|---|
| Not configured (no `BRAIN_CREATOR_AGENT_COMMAND`) | `bridge: { ok: false, error: "Agent bridge not configured..." }` | Returns error immediately (≤5ms) |
| Configured but unreachable (process crash, wrong path) | `bridge: { ok: false, error: "Agent bridge unreachable (5000ms timeout)..." }` | Returns error after ≤5 seconds |
| Configured and healthy | `bridge: { ok: true }` | Proceeds to Planner / Generator / Healer |

### Why 5 seconds?

Before preflight, `bc_generate_plan` and `bc_run_chain` would wait for the full agent timeout (default 120 seconds) before reporting failure. The 5-second preflight catches missing or broken bridges early, giving the user a fast, actionable error instead of a silent 2-minute hang.

## Recommended One-Sentence Prompts

### New session, existing system

```text
Use Brain Creator to check the status of the order-admin system and show me what to do next.
```

The agent calls `bc_session_resume` → presents snapshot with `nextAction`.

### Generate plan with bridge check

```text
Use Brain Creator to generate a test plan for the order-admin refund flow. If the planner isn't available, tell me how to fix it.
```

The agent calls `bc_session_resume` → checks `bridge.ok` → calls `bc_generate_plan` if bridge is healthy, or guides the user to configure it.

### Full workflow in one sentence

```text
Use Brain Creator to generate a test for the order-admin checkout flow, approve it, and run it — all in one go.
```

The agent calls `bc_session_resume` → `bc_generate_plan` → presents draft → user confirms → `bc_full_workflow`.

### Continue after interruption

```text
Use Brain Creator to resume where I left off with the order-admin system.
```

The agent calls `bc_session_resume` → discovers any approved-but-not-run cases, open gaps, or cancelled plans → presents the recovery path.

## What The Agent Should Do At Each nextAction

| `nextAction` value | Agent behavior |
|---|---|
| `complete_onboarding` | Guide user to run `bc_create_auth` |
| `configure_bridge` | Show the env vars to set; do NOT attempt `bc_generate_plan` |
| `resolve_gaps` | Call `bc_list_gaps` and present each gap with severity and owner |
| `review_failures` | Call `bc_list_cases` filtered to failed, present chain history |
| `run_chain` | Call `bc_run_chain` (or `bc_full_workflow`) for the approved case |
| `generate_plan` | Call `bc_generate_plan` with the user's requirement |

## Operator Checklist

Before starting an E2E session:

- [ ] `npm install` completed in the project
- [ ] Brain Creator MCP server configured (`.mcp.json` or Claude Code settings)
- [ ] `BRAIN_CREATOR_AGENT_COMMAND` set (e.g., `claude`)
- [ ] `BRAIN_CREATOR_AGENT_ARGS` set (e.g., `["--print","--permission-mode","acceptEdits"]`)
- [ ] Target system exists in Brain Creator (`bc_list_systems` or `bc_session_resume`)
- [ ] Auth profile is configured and verified for the target system

## Verification

Run the automated E2E smoke test:

```bash
npm run verify:live-session-resume-workflow
```

This smoke test:

1. Creates a system and auth profile against a local fixture HTTP page.
2. Calls `bc_session_resume` — verifies bridge status, nextAction, and correct aggregation.
3. Calls `bc_generate_plan` — verifies bridge preflight and scenario generation.
4. Calls `bc_full_workflow` — verifies approve + chain execution succeeds.
5. Calls `bc_session_resume` again — verifies updated state reflects the completed run.

No real browser or external service is needed. Set `BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS=1` to keep the temporary evidence directory for manual inspection.

The strongest end-to-end check is still `npm run verify:live-claude-skill-workflow`, which launches a real Claude Code session and drives the full flow from natural language. The session-resume smoke test focuses on the code path: `bc_session_resume` → bridge preflight → `bc_generate_plan` → `bc_full_workflow`.
