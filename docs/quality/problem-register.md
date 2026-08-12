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
| A7 | Errors described state but not recovery | partial | PR A/PR C | Stable code, bilingual message, nextAction, retryable, and UUID trace are present; expand catalog with Harness errors |
| A8 | Upgrade and migration had no safe path | resolved | PR B | Schema 16 migration creates a timestamped backup; schema 17 validation, doctor checks, index rebuild, and Suite export are covered |
| B1 | SPA exploration missed navigation transitions | partial | PR E | Link navigation and observed safe-interaction URL changes now create queued targets; popup and full remount recovery remain |
| B2 | Shared labels produced ambiguous page selection | partial | PR A/PR E | Confirmed page binding exists; candidate evidence and BrowserSurface scoring remain |
| B3 | Shadow DOM actions were not reliably reachable | partial | PR E | Open Shadow DOM, iframe, and Wujie-like surfaces are recorded as System Brain evidence; surface-scoped actions still need fixtures |
| B4 | SPA remount invalidated the active Page | open | PR E | Active page is reacquired after remount, popup, or close events |
| B5 | Initial-state exploration missed conditional actions | partial | PR E | ExplorationScenario discovers state- and data-dependent controls |
| C1 | Short-lived login state expired during suites | open | PR D | Fresh-context preflight refreshes supported auth or creates AuthCheckpoint |
| C2 | Generated seed omitted a supported auth reference | partial | PR D | Tests reference protected storageState or runtime auth environment variables; automatic token/cookie storageState conversion remains |
| C3 | Test credentials appeared in generated files | partial | PR D | Token/cookie values are removed from generated seeds and legacy ciphertext migrates; full artifact/export secret scan remains |
| C4 | Authentication overhead limited suite throughput | open | PR D | Verified storageState is reused across isolated contexts; concurrency stays gated by data isolation |
| D1 | Unread attachments were misclassified as model limitations | open | PR F | Assets are inventoried and marked unread until an OCR/vision adapter returns evidence |
| D2 | Requirements omitted concrete UI paths | partial | PR E/PR F | Missing paths are supplied by confirmed System Brain evidence or remain explicit Gap items |
| D3 | Source fields could not be reconciled to analysis | open | PR F | Source-field ledger reconciles source, node, intent, case, and result counts |
| D4 | Eval classification lacked explainable provenance | partial | PR F | Every class stores source passage, reason, policy version, and confirmer |
| D5 | Passing cases lacked replayable trace evidence | partial | PR C/PR D | Structured Reporter and static reports retain replayable artifact references; always-on trace capture remains PR D |
| D6 | Calls lacked operator identity and unique trace IDs | partial | PR A/PR C | UUID trace IDs and Ledger fields exist; production call sites still need to populate operator, provider, session, and current step |
| D7 | Assertions and runtime evidence were disconnected | partial | PR C | Reporter joins assertion results and attachments; step-level console/network/trace correlation remains to be completed |
| D8 | Screenshots had no business meaning | partial | PR C | Seed exposes `bc.step()` and Generator is instructed to use it; generated-file enforcement and full step metadata remain |
| E1 | Weak checks were reported as full validation | resolved | PR C | AssertionContract and assuranceLevel prevent reporter-less or partially mapped passes from being strong validation |
| E2 | Unexecuted TestIntents had no explanation | open | PR F | 100% of TestIntents are classified by execution or non-execution reason |
| E3 | Field checks displaced workflow coverage | open | PR F | Golden Eval includes workflow and state-transition coverage |
| E4 | Multi-role journeys were not executed | open | PR F | Actor Journey switches AuthProfiles and records role transitions in Ledger |
| E5 | A single green run implied stability | open | PR F | Critical journeys report repeated-run stability statistics |
| E6 | Created test data was not reliably cleaned | resolved | existing | TestData leases and cleanup states are covered by provider and suite tests |
| E7 | Host-reported success lacked tool verification | partial | existing/PR C | Tool-side Playwright execution and structured Reporter are used when available; compatibility fallback still records non-strong results without reporter evidence |
| F1 | Generated baselines were fragile across upgrades | resolved | PR A/PR B | Compile keys supersede stale cases; portable artifact manifests record hashes and missing evidence |
| F2 | Runtime depended on one workstation | partial | PR D | Browser/auth portability and CI smoke coverage remain |
| F3 | One JSON file grew without partitioning | resolved | PR B | Schema 17 sharded repository, atomic writes, migration backup, missing-shard detection, and index rebuild are covered |
| F4 | Local assets had no collaboration model | deferred | post-2.2 | Revisit only when remote multi-writer collaboration is required |
| F5 | Multiple requirements could contaminate assets | partial | PR A/PR B | Compile ownership and supersession exist; sharded indexes and multi-requirement Eval remain |
| G1 | Facade responses consumed excessive context | partial | PR A | `responseMode=summary` and paged CompileRun review exist; expand to all large facade results |
| G2 | Documentation and runtime behavior diverged | partial | every PR | Package Skill, English docs, and Chinese docs must be checked in the same PR |
| G3 | Internal concepts dominated the user experience | deferred | post-2.2 | Natural-language role-oriented review remains a later UX pass |
| G4 | Error and time presentation was not localized | partial | PR A/PR C | New errors are bilingual and static reports are searchable; locale-aware timestamps and the complete catalog remain |

## Stage totals

| Status | Count |
|---|---:|
| resolved | 6 |
| partial | 19 |
| open | 16 |
| deferred | 2 |
| total | 41 |

This register closes only through its stated acceptance checks. A passing feature test does not close broader evidence, security, or reliability work assigned to a later PR.
