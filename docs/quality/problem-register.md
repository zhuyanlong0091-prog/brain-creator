# Brain Creator execution quality problem register

This sanitized register is derived from a real end-to-end execution review. The source material remains outside this repository because it contains environment-specific evidence. The original summary said 34 problems; the numbered inventory contains **41 problems**: A1-G4.

Status meanings:

- `resolved`: implemented and covered by an automated acceptance check.
- `partial`: a useful control exists, but the original risk is not fully closed.
- `open`: planned work has not reached its acceptance condition.
- `deferred`: intentionally outside the current release objective.

| ID | Sanitized problem | Status | Target | Acceptance condition / check |
|---|---|---|---|---|
| A1 | Facade could not verify authentication | resolved | PR A | `bc_configure auth verify` performs browser-state verification and stores evidence; `controlPlane.test.ts` |
| A2 | Case compilation accepted only one TestIntent | resolved | PR A | Requirement, intent-list, and module batch selection are idempotent; `service.test.ts`, `controlPlane.test.ts` |
| A3 | Operators changed runtime state by editing the store | partial | PR A/PR E | Auth, page binding, Gap, and reload controls exist; navigation/state corrections still need BrowserSurface controls |
| A4 | State changes required MCP restarts | partial | PR A/PR B | Store reload is in-process and blocked during active runs; sharded repository must remove whole-store reload pressure |
| A5 | Generated output had no ownership hierarchy | resolved | PR B | Every artifact has system, requirement, suite, hash, source, and manifest ownership; artifact manifest and shard ownership tests |
| A6 | Gaps had no usable lifecycle | resolved | PR A | Resolve, dismiss, and reopen require a note and evidence references; `service.test.ts`, `controlPlane.test.ts` |
| A7 | Errors described state but not recovery | partial | PR A/PR C | Facade and execution auth errors now return stable codes, bilingual messages, nextAction, retryable, and UUID trace; broader Harness error catalog remains |
| A8 | Upgrade and migration had no safe path | resolved | PR B | Schema 16 migration creates a timestamped backup; schema 17 validation, doctor checks, index rebuild, and Suite export are covered |
| B1 | SPA exploration missed navigation transitions | partial | PR E | Link navigation and observed safe-interaction URL changes now create queued targets; popup and full remount recovery remain |
| B2 | Shared labels produced ambiguous page selection | resolved | PR A/PR E | Confirmed page binding exists; candidate score breakdown and matched evidence are returned for ambiguity diagnostics |
| B3 | Shadow DOM actions were not reliably reachable | resolved | PR E | Open Shadow DOM, Wujie-like open containers, and same-origin iframe candidates now carry surface-scoped evidence, safe actions, state changes, and System Brain transitions; closed or cross-origin surfaces remain observational |
| B4 | SPA remount invalidated the active Page | partial | PR E | Safe exploration now reacquires a closed/invalid active page before continuing, retries a stale safe target once, and covers a real SPA root-remount fixture; popup-close and cross-surface recovery remain |
| B5 | Initial-state exploration missed conditional actions | partial | PR E | ExplorationScenario discovers state- and data-dependent controls |
| C1 | Short-lived login state expired during suites | partial | PR D | Fresh-context preflight detects expiry and creates AuthCheckpoint; provider-specific automatic refresh remains |
| C2 | Generated seed omitted a supported auth reference | resolved | PR D | Verified Token/Cookie profiles materialize protected storageState before execution; seed and execution-boundary integration tests cover the path |
| C3 | Test credentials appeared in generated files | partial | PR D/PR E | Token/cookie values are removed from generated seeds; Bridge/Host Agent logs, submissions, and Suite export redact or block known values plus high-confidence credential patterns; subprocess and full artifact lifecycle scan remains |
| C4 | Authentication overhead limited suite throughput | partial | PR D | Verified storageState is cached for a bounded TTL, each test keeps an isolated context, and Playwright defaults to `--workers=1`; controlled parallelism remains gated by data isolation |
| D1 | Unread attachments were misclassified as model limitations | resolved | PR F | Source ledger inventories attachments as `unread` with an explicit no-OCR/vision reason |
| D2 | Requirements omitted concrete UI paths | partial | PR E/PR F | Missing paths are supplied by confirmed System Brain evidence or remain explicit Gap items |
| D3 | Source fields could not be reconciled to analysis | resolved | PR F | Source ledger reconciles blocks, requirements, nodes, intents, cases, evidence, and attachments |
| D4 | Eval classification lacked explainable provenance | partial | PR F | Every class stores source passage, reason, policy version, and confirmer |
| D5 | Passing cases lacked replayable trace evidence | partial | PR C/PR D | Default structured Playwright runs request `--trace=on`; missing trace paths now generate evidence warnings and downgrade assurance, while legacy/custom-runner coverage remains |
| D6 | Calls lacked operator identity and unique trace IDs | resolved | PR C/PR E | UUID trace IDs and Ledger fields are populated; requirement-suite Facade accepts operator/provider/sessionId, stability runs inherit them, and state events retain currentStep |
| D7 | Assertions and runtime evidence were disconnected | partial | PR C/PR E | Structured Reporter joins assertion, step screenshot, and step-level console/network runtime attachments; ambiguous top-level traces are no longer copied to every step, while legacy/custom-runner coverage remains |
| D8 | Screenshots had no business meaning | partial | PR C | Seed exposes `bc.step()` and generated files are checked after comments are removed; full step metadata remains |
| E1 | Weak checks were reported as full validation | resolved | PR C | AssertionContract and assuranceLevel prevent reporter-less or partially mapped passes from being strong validation; Requirement Eval separately reports execution passes, strong verification, and limited/unassured passes |
| E2 | Unexecuted TestIntents had no explanation | resolved | PR F | Coverage ledger classifies every intent as strong, limited, failed, blocked, not-selected, or superseded |
| E3 | Field checks displaced workflow coverage | partial | PR F | TestIntent/ExecutableCase/ExecutionEvidence expose required, verified, and missing field/workflow/state/permission/integration dimensions; full golden business-flow evidence remains |
| E4 | Multi-role journeys were not executed | partial | PR F | Actor Journey resolves system-scoped AuthProfiles, generated tests require explicit role usage, and role transitions are recorded in Ledger; real multi-role workflow stability remains |
| E5 | A single green run implied stability | partial | PR F | `bc_run mode=requirement-suite repeatCount` creates isolated linked suite iterations and coverage now reports `insufficient-sample`, `stable`, `unstable`, or `blocked`; real-system thresholds and long-run scheduling remain |
| E6 | Created test data was not reliably cleaned | resolved | existing | TestData leases and cleanup states are covered by provider and suite tests |
| E7 | Host-reported success lacked tool verification | partial | existing/PR C | Tool-side Playwright execution and structured Reporter are used when available; compatibility fallback still records non-strong results without reporter evidence |
| F1 | Generated baselines were fragile across upgrades | resolved | PR A/PR B | Compile keys supersede stale cases; portable artifact manifests record hashes and missing evidence |
| F2 | Runtime depended on one workstation | partial | PR D | Browser/auth portability and CI smoke coverage remain |
| F3 | One JSON file grew without partitioning | resolved | PR B | Schema 17 sharded repository, atomic writes, migration backup, missing-shard detection, and index rebuild are covered |
| F4 | Local assets had no collaboration model | deferred | post-2.2 | Revisit only when remote multi-writer collaboration is required |
| F5 | Multiple requirements could contaminate assets | partial | PR A/PR B | System-owned shards now isolate page/evidence/knowledge observations and indexes carry requirement ownership; complete same-system multi-requirement Eval and report reconciliation remain |
| G1 | Facade responses consumed excessive context | partial | PR A/PR C | `responseMode=summary` and explicit paging now cover CompileRun plus requirement, TestIntent, ExecutableCase, ExecutionPlan, SuiteRun, Ledger, exploration, and evidence reviews; status/diagnosis and nested suite payloads still need bounded summary contracts |
| G2 | Documentation and runtime behavior diverged | partial | every PR | Package Skill, English docs, and Chinese docs must be checked in the same PR |
| G3 | Internal concepts dominated the user experience | deferred | post-2.2 | Natural-language role-oriented review remains a later UX pass |
| G4 | Error and time presentation was not localized | partial | PR A/PR C | New errors are bilingual and static reports are searchable; locale-aware timestamps and the complete catalog remain |

## Stage totals

| Status | Count |
|---|---:|
| resolved | 16 |
| partial | 23 |
| open | 0 |
| deferred | 2 |
| total | 41 |

This register closes only through its stated acceptance checks. A passing feature test does not close broader evidence, security, or reliability work assigned to a later PR.
