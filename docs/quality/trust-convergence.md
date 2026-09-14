# Trust Convergence Delivery Register

This register tracks the six-package business-closure plan. Implementation, real business completion, and autonomy are separate measurements. Completing a unit test does not count as a real business run.

| Package | Status | Implemented in this working change | Remaining acceptance |
| --- | --- | --- | --- |
| A: Runtime and baseline | Partial | Process-pinned build identity; explicit Trial/Suite binding; frozen scenario scope; fixed-denominator metrics excluding synthetic results | Real Trial execution; all scheduling/control entrypoints; intervention and recovery instrumentation; controlled projection checkpoints |
| B: Evidence and conformance | Partial | Exact assertion IDs; step binding for strong assurance; file/hash/image/trace validation; Oracle comparison; synthetic and nonconforming trust guards | Full immutable semantic freeze, per-run ownership and historical re-evaluation; end-to-end package validation |
| C: Paths and data | Partial | Ambiguous/missing process references fail closed; approved baseline confirms draft process models; Provider result identity, status and expected values checked | Complete path solving; multi-case scenario aggregation; actual entity lifecycle and recovery |
| D: Continuity and recovery | Partial | Existing recovery plus unified `executionTasks` projection in `bc_status`, including current case/step, page, wait reason, related data/agent task and next action; write-action lifecycle now records planned/sent/confirmed/reconciled phases and blocks repeat sends after interruption; document suites now persist and incrementally rewrite a searchable offline HTML report | Browser/process interruption replay with automatic postcondition querying; real-system continuity |
| E: Real business evaluation | Open | No new real run claimed | Three authorized rounds, order fixture, second real system dependency |
| F: Delivery | Open | Usage guidance updated with current limits | Measured comparison, full acceptance and install validation |

Accepted packages: **0/6**. Real business completion and autonomous completion: **not measured in this change**. Blocked and unexecuted scenarios must remain in the denominator when a real Trial is established.

## Evidence Rules

- A file extension or path is not evidence. Image decoding and readable trace events are checked before strong results are accepted.
- A valid trace proves a readable artifact, not that the required business action happened. Business conformance requires a source-backed contract and bound actual values.
- Existing reports remain readable. Legacy results without these checks do not support new trust promotion.
- Chromium fixture tests validate the pipeline only; they are not evidence of production-system capability.
- The active checkout and real system data are not modified by this isolated development work. No npm release is authorized.

## 中文进度

当前为 A、B、C 三包部分实现，D 已补齐统一任务投影、写动作恢复和文档套件离线报告的第一版，验收完成 **0/6**。已补显式 Trial/Suite 绑定、固定场景分母、保守指标、流程/实体校验，以及 `bc_status` 的统一任务恢复视图。尚未建立本轮真实测量，缺少完整人工介入采集时自主率仍为“未测量”；浏览器/进程中断后的真实系统回放和自动后置状态查询仍未完成。本页不得用于宣称 L3 或真实业务通过率。

Trial metrics currently reuse the persisted artifact validation record. Review-time disk/hash revalidation and consistent Trial checks across scheduling/control branches remain open. Multiple cases for one scenario remain inconclusive until a complete aggregation contract exists; a final passing case cannot prove the entire scenario passed.

## 2026-09-14 Verification

- Focused recovery/report regression: **2 test files, 7 tests passed**.
- Full Vitest regression: **132 test files, 964 tests passed, 2 existing fixture failures**. The failures are `systemExplorer.test.ts` popup transition and its Windows cleanup/timeout behavior, plus the unrelated temporary-directory cleanup failure in `systemBrainSnapshot.test.ts`; they are outside this change.
- Vitest file-level parallelism is disabled in the repository test configuration because Windows can hold sharded-store files briefly during cleanup; this keeps the default `npm test` deterministic without changing product runtime behavior.
- TypeScript check, production build, and VitePress documentation build passed.
- Package contents, packed install, Codex plugin install, and Codex-native entry smoke passed.
- Repository hygiene passed for 322 tracked files.
- The release readiness check remains blocked only by local npm authentication; npm publish was not attempted.
- This verification is still synthetic/local. No real business Trial, three-round real-system measurement, or autonomous-completion claim is made.

## 2026-09-14 Document Suite Report

- Document suites persist `reportPath` on `CaseSuite` and expose it from `bc_run` and the active `bc_status` summary.
- Reports are written to `.brain-creator/artifacts/<system>/document-<source>/<suite>/report/suite-report.html` and include selected cases, pending/not-executed reasons, progress, BugReports, Gaps, related run IDs, and client-side search.
- The report is regenerated after suite creation, pending-action recovery, host-agent continuation, case completion, cancellation, and terminal suite transitions.
- A report is a Suite-level artifact; it is included in the Suite manifest without being mislabeled as per-case evidence.
- Fresh-context persistence coverage proves an unresolved sent action remains waiting and no new test case is dispatched. Browser/process interruption replay and automatic postcondition querying remain unmeasured.

## 2026-09-14 Unified Task Projection

- `bc_status` now exposes `executionTasks` for system- and knowledge-project-scoped views.
- The projection merges active requirement suites, document suites, pending agent tasks, test-data tasks and Brain tasks without duplicating child tasks already linked to a parent run.
- The active task includes the current case, step, page URL, role, entity reference, wait reason, stall warning, related task IDs and a deterministic next action.
- Ledger-only waiting is surfaced as `status=waiting` with the recovery action, while the legacy `summary.activeRun.executionRecovery` remains unchanged for compatibility.
- Knowledge-project views retain document suites through their system binding; linked AgentTask and TestDataTask records are checked against the parent system and project when those fields are present.
- A blocked parent takes precedence over stale pending children, authentication checkpoints have a distinct next action, and `relatedTaskIds` contains task IDs only; child-to-parent context is exposed separately.
- This projection is read-only; the write-action recovery contract is documented and verified in the following slice, while real-system continuity remains unmeasured.

## 2026-09-14 Write Action Recovery

- Run Ledger now accepts `action-planned`, `action-sent`, `action-confirmed`, `action-reconciliation-required`, and `action-reconciled` events with a stable `actionKey`.
- `sent` and `reconciliation-required` are exposed as `pendingAction` and force `reconcile-action`; a later Suite continuation cannot dispatch a new business action until the postcondition is reconciled.
- `bc_prepare action=record-execution-action` records the lifecycle for requirement or document suites. `bc_prepare action=reconcile-execution-action confirm=true` requires a postcondition and non-empty evidence references, then clears the pending action without replaying the side effect.
- Semantic, entity, postcondition, and evidence fields pass through the existing secret redaction path.
- This closes the in-process guard and audit contract. Browser/process interruption replay and automatic postcondition querying still require an end-to-end real-system test.
