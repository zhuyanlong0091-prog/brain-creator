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
| A5 | Generated output had no ownership hierarchy | open | PR B | Every artifact has system, requirement, suite, hash, source, and manifest ownership |
| A6 | Gaps had no usable lifecycle | resolved | PR A | Resolve, dismiss, and reopen require a note and evidence references; `service.test.ts`, `controlPlane.test.ts` |
| A7 | Errors described state but not recovery | partial | PR A/PR C | Stable code, bilingual message, nextAction, retryable, and UUID trace are present; expand catalog with Harness errors |
| A8 | Upgrade and migration had no safe path | partial | PR B | Export, migration backup, doctor validation, and rollback are required before closure |
| B1 | SPA exploration missed navigation transitions | open | PR E | URL-changing interactions create navigation edges and queued targets |
| B2 | Shared labels produced ambiguous page selection | partial | PR A/PR E | Confirmed page binding exists; candidate evidence and BrowserSurface scoring remain |
| B3 | Shadow DOM actions were not reliably reachable | open | PR E | Open Shadow DOM and microfrontend surfaces pass interaction fixtures |
| B4 | SPA remount invalidated the active Page | open | PR E | Active page is reacquired after remount, popup, or close events |
| B5 | Initial-state exploration missed conditional actions | partial | PR E | ExplorationScenario discovers state- and data-dependent controls |
| C1 | Short-lived login state expired during suites | open | PR D | Fresh-context preflight refreshes supported auth or creates AuthCheckpoint |
| C2 | Generated seed omitted a supported auth reference | partial | PR D | Tests consume protected storageState only and never embed login logic or credentials |
| C3 | Test credentials appeared in generated files | open | PR D | Secret scan passes for specs, tests, logs, reports, and exports |
| C4 | Authentication overhead limited suite throughput | open | PR D | Verified storageState is reused across isolated contexts; concurrency stays gated by data isolation |
| D1 | Unread attachments were misclassified as model limitations | open | PR F | Assets are inventoried and marked unread until an OCR/vision adapter returns evidence |
| D2 | Requirements omitted concrete UI paths | partial | PR E/PR F | Missing paths are supplied by confirmed System Brain evidence or remain explicit Gap items |
| D3 | Source fields could not be reconciled to analysis | open | PR F | Source-field ledger reconciles source, node, intent, case, and result counts |
| D4 | Eval classification lacked explainable provenance | partial | PR F | Every class stores source passage, reason, policy version, and confirmer |
| D5 | Passing cases lacked replayable trace evidence | open | PR C | Trace is retained for every case and linked from the report manifest |
| D6 | Calls lacked operator identity and unique trace IDs | partial | PR A/PR C | UUID trace IDs exist; Ledger still needs operator, provider, session, and current step |
| D7 | Assertions and runtime evidence were disconnected | open | PR C | Reporter joins assertion, console, network, screenshot, and trace evidence by step |
| D8 | Screenshots had no business meaning | open | PR C | `bc.step()` produces semantic names and step metadata |
| E1 | Weak checks were reported as full validation | open | PR C | AssertionContract and assuranceLevel separate strong, limited, and none |
| E2 | Unexecuted TestIntents had no explanation | open | PR F | 100% of TestIntents are classified by execution or non-execution reason |
| E3 | Field checks displaced workflow coverage | open | PR F | Golden Eval includes workflow and state-transition coverage |
| E4 | Multi-role journeys were not executed | open | PR F | Actor Journey switches AuthProfiles and records role transitions in Ledger |
| E5 | A single green run implied stability | open | PR F | Critical journeys report repeated-run stability statistics |
| E6 | Created test data was not reliably cleaned | resolved | existing | TestData leases and cleanup states are covered by provider and suite tests |
| E7 | Host-reported success lacked tool verification | resolved | existing/PR C | Tool-side Playwright execution exists; structured Reporter replaces remaining stdout inference |
| F1 | Generated baselines were fragile across upgrades | partial | PR A/PR B | Compile keys supersede stale cases; portable artifact manifests remain |
| F2 | Runtime depended on one workstation | partial | PR D | Browser/auth portability and CI smoke coverage remain |
| F3 | One JSON file grew without partitioning | open | PR B | Schema 17 sharded repository passes 30 MB migration and recovery tests |
| F4 | Local assets had no collaboration model | deferred | post-2.2 | Revisit only when remote multi-writer collaboration is required |
| F5 | Multiple requirements could contaminate assets | partial | PR A/PR B | Compile ownership and supersession exist; sharded indexes and multi-requirement Eval remain |
| G1 | Facade responses consumed excessive context | partial | PR A | `responseMode=summary` and paged CompileRun review exist; expand to all large facade results |
| G2 | Documentation and runtime behavior diverged | partial | every PR | Package Skill, English docs, and Chinese docs must be checked in the same PR |
| G3 | Internal concepts dominated the user experience | deferred | post-2.2 | Natural-language role-oriented review remains a later UX pass |
| G4 | Error and time presentation was not localized | partial | PR A/PR C | New errors are bilingual; locale-aware timestamps and the complete catalog remain |

## Stage totals

| Status | Count |
|---|---:|
| resolved | 5 |
| partial | 16 |
| open | 18 |
| deferred | 2 |
| total | 41 |

This register closes only through its stated acceptance checks. A passing feature test does not close broader evidence, security, or reliability work assigned to a later PR.
