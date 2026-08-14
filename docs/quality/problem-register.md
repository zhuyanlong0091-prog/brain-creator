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
| B1 | SPA exploration missed navigation transitions | partial | PR E | Link navigation and observed safe-interaction URL changes now create queued targets; closed Popup evidence is isolated as a warning, while full remount and cross-surface recovery remain |
| B2 | Shared labels produced ambiguous page selection | resolved | PR A/PR E | Confirmed page binding exists; candidate score breakdown and matched evidence are returned for ambiguity diagnostics |
| B3 | Shadow DOM actions were not reliably reachable | resolved | PR E | Open Shadow DOM, Wujie-like open containers, and same-origin iframe candidates now carry surface-scoped evidence, safe actions, state changes, and System Brain transitions; same-URL iframe candidates now also carry a stable frame ordinal; closed or cross-origin surfaces remain observational |
| B4 | SPA remount invalidated the active Page | partial | PR E | Safe exploration now reacquires a closed/invalid active page before continuing, retries a stale safe target once, isolates closed Popup evidence without dropping the main page, disambiguates same-URL iframe targets after recovery, and fails closed when an iframe surface disappears instead of falling back to a main-document selector; full cross-surface recovery remains |
| B5 | Initial-state exploration missed conditional actions | partial | PR E/PR F | ExplorationScenario now carries role, prerequisite state, reusable data references, and approved selector values into safe exploration; active current-system TestDataLease references are validated before opening a browser and state-dependent controls are persisted into System Brain, while automatic test-data preparation remains a separate Phase F capability |
| C1 | Short-lived login state expired during suites | partial | PR D | Fresh-context preflight now accepts one host-provided AuthStateRefresher attempt, re-verifies the refreshed protected storageState, and otherwise creates AuthCheckpoint; provider-specific refresh implementations and suite-level refresh evidence remain |
| C2 | Generated seed omitted a supported auth reference | resolved | PR D | Verified Token/Cookie profiles materialize protected storageState before execution; seed and execution-boundary integration tests cover the path |
| C3 | Test credentials appeared in generated files | partial | PR D/PR E | Token/cookie values are removed from generated seeds; the shared Agent bridge boundary scans and redacts declared output paths; Bridge/Host Agent logs, submissions, and Suite export redact or block known values plus high-confidence credential patterns; subprocess and full artifact lifecycle scan remains |
| C4 | Authentication overhead limited suite throughput | partial | PR D | Verified storageState is cached for a bounded TTL, each test keeps an isolated context, and Playwright defaults to `--workers=1`; controlled parallelism remains gated by data isolation |
| D1 | Unread attachments were misclassified as model limitations | resolved | PR F | Source ledger inventories attachments as `unread` with an explicit no-OCR/vision reason |
| D2 | Requirements omitted concrete UI paths | partial | PR E/PR F | Missing paths are supplied by confirmed System Brain evidence or remain explicit Gap items |
| D3 | Source fields could not be reconciled to analysis | resolved | PR F | Source ledger reconciles blocks, requirements, nodes, intents, cases, evidence, and attachments |
| D4 | Eval classification lacked explainable provenance | partial | PR F | Every class stores source passage, reason, policy version, and confirmer |
| D5 | Passing cases lacked replayable trace evidence | partial | PR C/PR D | Default structured Playwright runs request `--trace=on`; missing trace paths now generate evidence warnings and downgrade assurance, while legacy/custom-runner coverage remains |
| D6 | Calls lacked operator identity and unique trace IDs | resolved | PR C/PR E | UUID trace IDs and Ledger fields are populated; requirement-suite Facade accepts operator/provider/sessionId, stability runs inherit them, and state events retain currentStep |
| D7 | Assertions and runtime evidence were disconnected | partial | PR C/PR E | Structured Reporter joins assertion, step screenshot, and step-level console/network runtime attachments; ambiguous top-level traces are no longer copied to every step, while legacy/custom-runner coverage remains |
| D8 | Screenshots had no business meaning | partial | PR C | Evidence now carries target semantic, input value, page model, locator point, data profile and source references into the static report with secret redaction; runtime actual-value capture and richer visual annotations remain |
| E1 | Weak checks were reported as full validation | resolved | PR C | AssertionContract and assuranceLevel prevent reporter-less or partially mapped passes from being strong validation; Requirement Eval separately reports execution passes, strong verification, and limited/unassured passes |
| E2 | Unexecuted TestIntents had no explanation | resolved | PR F | Coverage ledger classifies every intent as strong, limited, failed, blocked, not-selected, or superseded |
| E3 | Field checks displaced workflow coverage | partial | PR F | TestIntent/ExecutableCase/ExecutionEvidence expose required, verified, and missing field/workflow/state/permission/integration dimensions; full golden business-flow evidence remains |
| E4 | Multi-role journeys were not executed | partial | PR F | Actor Journey resolves system-scoped AuthProfiles, generated tests require explicit role usage, and `runAsRole()` now writes runtime JSONL role events that the executor verifies before passing; real-system cross-role workflow stability remains |
| E5 | A single green run implied stability | partial | PR F | `bc_run mode=requirement-suite repeatCount` creates isolated linked suite iterations; coverage and `bc_status` now report target, completed iterations, passed/failed/blocked counts and `insufficient-sample`/`stable`/`unstable`/`blocked` verdicts; real-system thresholds and long-run scheduling remain |
| E6 | Created test data was not reliably cleaned | resolved | existing | TestData leases and cleanup states are covered by provider and suite tests |
| E7 | Host-reported success lacked tool verification | partial | existing/PR C | Tool-side Playwright execution and structured Reporter are used when available; compatibility fallback still records non-strong results without reporter evidence |
| F1 | Generated baselines were fragile across upgrades | resolved | PR A/PR B | Compile keys supersede stale cases; portable artifact manifests record hashes and missing evidence |
| F2 | Runtime depended on one workstation | partial | PR D | Browser/auth portability and CI smoke coverage remain |
| F3 | One JSON file grew without partitioning | resolved | PR B | Schema 17 sharded repository, atomic writes, migration backup, missing-shard detection, and index rebuild are covered |
| F4 | Local assets had no collaboration model | deferred | post-2.2 | Revisit only when remote multi-writer collaboration is required |
| F5 | Multiple requirements could contaminate assets | partial | PR A/PR B | System-owned shards now isolate page/evidence/knowledge observations and indexes carry requirement ownership; complete same-system multi-requirement Eval and report reconciliation remain |
| G1 | Facade responses consumed excessive context | partial | PR A/PR C | `responseMode=summary` and explicit paging now cover CompileRun plus requirement, TestIntent, ExecutableCase, ExecutionPlan, SuiteRun, Ledger, exploration, and evidence reviews; status now exposes a bounded active-suite progress/next-case summary while full nested history remains available on demand; diagnosis and broader nested suite payloads still need bounded summary contracts |
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
