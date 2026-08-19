# Brain Creator execution quality problem register

This sanitized register is derived from a real end-to-end execution review. The source material remains outside this repository because it contains environment-specific evidence. The original summary said 34 problems; the numbered inventory contains **41 problems**: A1-G4.

Status meanings:

- `resolved`: implemented and covered by an automated acceptance check.
- `partial`: a useful control exists, but the original risk is not fully closed.
- `open`: planned work has not reached its acceptance condition.
- `deferred`: intentionally outside the current release objective.

The focused regression sample for the remaining execution-quality partials is
documented in [Real-system regression samples](real-system-regression.md) and
implemented by `src/quality/realSystemRegression.test.ts`. It strengthens the
evidence for B1/B4, C1, B5/E6, E4/E5, and F5 without pretending that the wider
production acceptance conditions are closed.

| ID | Sanitized problem | Status | Target | Acceptance condition / check |
|---|---|---|---|---|
| A1 | Facade could not verify authentication | resolved | PR A | `bc_configure auth verify` performs browser-state verification and stores evidence; `controlPlane.test.ts` |
| A2 | Case compilation accepted only one TestIntent | resolved | PR A | Requirement, intent-list, and module batch selection are idempotent; `service.test.ts`, `controlPlane.test.ts` |
| A3 | Operators changed runtime state by editing the store | partial | PR A/PR E | Auth, page binding, Gap, and reload controls exist; navigation/state corrections still need BrowserSurface controls |
| A4 | State changes required MCP restarts | partial | PR A/PR B | Store reload is in-process and blocked during active runs; sharded repository must remove whole-store reload pressure |
| A5 | Generated output had no ownership hierarchy | resolved | PR B | Every artifact has system, requirement, suite, hash, source, and manifest ownership; artifact manifest and shard ownership tests |
| A6 | Gaps had no usable lifecycle | resolved | PR A | Resolve, dismiss, and reopen require a note and evidence references; `service.test.ts`, `controlPlane.test.ts` |
| A7 | Errors described state but not recovery | partial | PR A/PR C | Facade and execution auth errors now return stable codes, bilingual messages, nextAction, retryable, and UUID trace; Reporter-missing, Bridge-timeout, Bridge-unavailable, store-lock, workspace-path, and execution-budget failures now have stable recovery codes; broader Harness error catalog remains |
| A8 | Upgrade and migration had no safe path | resolved | PR B | Schema 16 migration creates a timestamped backup; schema 17 validation, doctor checks, index rebuild, and Suite export are covered |
| B1 | SPA exploration missed navigation transitions | partial | PR E | Link navigation and observed safe-interaction URL changes now create queued targets and System Brain navigation edges; state-only changes are explicitly classified as `state` transitions, while full remount and cross-surface recovery remain |
| B2 | Shared labels produced ambiguous page selection | resolved | PR A/PR E | Confirmed page binding exists; candidate score breakdown and matched evidence are returned for ambiguity diagnostics |
| B3 | Shadow DOM actions were not reliably reachable | resolved | PR E | Open Shadow DOM, Wujie-like open containers, and same-origin iframe candidates now carry surface-scoped evidence, safe actions, state changes, and System Brain transitions; same-URL iframe candidates now also carry a stable frame ordinal; closed or cross-origin surfaces remain observational |
| B4 | SPA remount invalidated the active Page | partial | PR E | Safe exploration now reacquires a closed/invalid active page at the last known allowlisted URL before continuing, retries a stale safe target once, and shares one BrowserSurface child-frame ordinal contract before allowlist filtering; it filters disallowed iframe state/locators, scopes Shadow DOM/Wujie actions by a stable host selector chain, treats Popup as a scoped interactive surface with allowlist checks and state transitions, isolates closed Popup evidence without dropping the main page, disambiguates same-URL iframe targets after recovery, records structured recovery trigger/method/attempt evidence, and fails closed when a surface disappears instead of falling back to a main-document selector; full cross-surface recovery remains |
| B5 | Initial-state exploration missed conditional actions | partial | PR E/PR F | ExplorationScenario now carries role, prerequisite state, reusable data references, and approved selector values into safe exploration; active current-system TestDataLease references are validated before opening a browser and state-dependent controls are persisted into System Brain; `bc_prepare action=prepare-test-data automatic=true confirm=true` and `bc_run mode=requirement-suite automaticTestData=true` resolve deterministic generated/unique values locally without a target-system write, while lookup/create/cleanup still require system evidence or Host Agent execution |
| C1 | Short-lived login state expired during suites | partial | PR D | Fresh-context preflight now accepts one host-provided AuthStateRefresher attempt, re-verifies the refreshed protected storageState, and returns suite-level `authState.authRefresh` provider/attempt evidence; otherwise it creates AuthCheckpoint; provider-specific refresh implementations remain |
| C2 | Generated seed omitted a supported auth reference | resolved | PR D | Verified Token/Cookie profiles materialize protected storageState before execution; seed and execution-boundary integration tests cover the path |
| C3 | Test credentials appeared in generated files | partial | PR D/PR E | Token/cookie values are removed from generated seeds; Agent bridge output, tool and Host Agent Playwright stdout/stderr, structured reporter files, Run Ledger, Bug/Gap text, artifact manifests, Host Agent logs, submissions, and Suite export redact or block known values plus high-confidence credential patterns (including JSON fields such as `{"token":"..."}`); materialized storageState is kept under protected auth directories, submitted Host Agent output paths are constrained to the Brain Creator workspace, and owned artifact directories scan unlisted files; subprocess and external-workspace lifecycle scan remains |
| C4 | Authentication overhead limited suite throughput | partial | PR D | Verified storageState is cached for a bounded TTL, each test keeps an isolated context, and Playwright defaults to `--workers=1`; controlled parallelism remains gated by data isolation |
| D1 | Unread attachments were misclassified as model limitations | resolved | PR A/PR B | Attempted-first attachment handling now feeds confirmed visual edges into persisted WorkflowModel/StateMachineModel assets, transition TestIntents, and Requirement Eval coverage; unconfirmed critical process evidence blocks approval without creating a premature Gap |
| D1a | Attachment registration | resolved | PR A | Markdown, DOCX media, PDF, HTTP images, and Feishu image/file blocks are registered with stable lifecycle metadata |
| D1b | Attachment download | resolved | PR A | Controlled local materialization uses size/hash checks, same-origin HTTP policy, archive extraction, and Feishu file tokens with retries |
| D1c | Visual recognition | resolved | PR A | Host multimodal requests expose controlled local paths and schema requirements; adapter recognition retries once before failure |
| D1d | Structured confirmation | resolved | PR A | Table, flowchart, state-machine, wireframe, text-image, and other results persist as draft AttachmentAnalysis and require explicit confirmation |
| D1e | Gap timing | resolved | PR A | Discovery and parser warnings do not create attachment Gaps; only exhausted download/recognition or unrecoverable auth failures do |
| D2 | Requirements omitted concrete UI paths | partial | PR C/PR D | Five-stage compilation now creates evidence-scoped ExplorationTasks for missing or ambiguous paths and resumes after evidence arrives; the next phase must execute approved stateful exploration plans before unresolved tasks become final Gaps |
| D3 | Source fields could not be reconciled to analysis | resolved | PR F | Source ledger reconciles blocks, requirements, nodes, intents, cases, evidence, and attachments |
| D4 | Eval classification lacked explainable provenance | partial | PR F | Every class stores source passage, reason, policy version, and confirmer; Eval action confirmations now persist `confirmedBy` in the repository and confirmation document, while historical host classifications still need a complete confirmer backfill |
| D5 | Passing cases lacked replayable trace evidence | partial | PR C/PR D/PR E | Default structured Playwright runs request `--trace=on`; strict mode also blocks missing or empty generated test files before the Runner, JSON reporter files are persisted in redacted form, missing reporter output now fails closed, missing trace paths generate evidence warnings and downgrade assurance, and Healer changes are checked before retry; legacy/custom-runner coverage remains |
| D6 | Calls lacked operator identity and unique trace IDs | resolved | PR C/PR E | UUID trace IDs and Ledger fields are populated; requirement-suite Facade accepts operator/provider/sessionId, stability runs inherit them, and state events retain currentStep |
| D7 | Assertions and runtime evidence were disconnected | partial | PR C/PR E | Structured Reporter joins assertion, step screenshot, and step-level console/network runtime attachments; Suite reports now expose step details and per-case console/network counts; ambiguous top-level traces are no longer copied to every step, and Healer cannot remove required assertions or `bc.step` instrumentation; legacy/custom-runner coverage remains |
| D8 | Screenshots had no business meaning | partial | PR C | Evidence now carries target semantic, input value, page model, locator point, data profile and source references into the static report with secret redaction; Suite reports expose step-level expected/actual values and screenshot links; structured Reporter actual values now bind to assertion steps by `stepId` with single-assertion compatibility, and local screenshot/trace artifacts are clickable from offline reports; richer visual annotations remain |
| E1 | Weak checks were reported as full validation | resolved | PR C/PR E | AssertionContract and assuranceLevel prevent reporter-less or partially mapped passes from being strong validation; Requirement Eval separately reports execution passes, strong verification, and limited/unassured passes; execution diagnosis only promotes an assertion mismatch to product Bug when strong Reporter evidence is present |
| E2 | Unexecuted TestIntents had no explanation | resolved | PR F | Coverage ledger classifies every intent as strong, limited, failed, blocked, not-selected, or superseded; archived static Suite reports render the classification, reason, and requirement references |
| E3 | Field checks displaced workflow coverage | partial | PR B/PR F | Requirement design now persists five-dimension coverage, generates visual workflow/state transitions, negative state paths, and cross-role Actor Journeys, and blocks missing process coverage; real-system execution evidence for the full golden business flow remains |
| E4 | Multi-role journeys were not executed | partial | PR F | Actor Journey resolves system-scoped AuthProfiles, generated tests require explicit role usage, and `runAsRole()` now writes runtime JSONL role plus AuthProfile events that the executor verifies for declared roles, profile mapping, unknown roles, and declared order before passing; stability summaries also require the declared role sequence in strong evidence, while real-system cross-role workflow stability remains |
| E5 | A single green run implied stability | partial | PR F | `bc_run mode=requirement-suite repeatCount` creates isolated linked suite iterations; coverage and `bc_status` now report target, completed iterations, runtime-passed counts and strong-evidence-passed counts, return `insufficient-sample` for a single completed iteration, and refuse `stable` when a completed iteration lacks complete strong evidence; real-system thresholds and long-run scheduling remain |
| E6 | Created test data was not reliably cleaned | resolved | existing | TestData leases and cleanup states are covered by provider and suite tests |
| E7 | Host-reported success lacked tool verification | partial | existing/PR C/PR E | Tool-side Playwright execution and structured Reporter are required in strict mode; missing Reporter output fails closed, Healer mutation checks prevent assertion removal, and compatibility fallback records non-strong results without reporter evidence and cannot auto-promote assertion failures to product Bug; full host-agent enforcement remains |
| F1 | Generated baselines were fragile across upgrades | resolved | PR A/PR B | Compile keys supersede stale cases; portable artifact manifests record hashes and missing evidence |
| F2 | Runtime depended on one workstation | partial | PR D | Installed package smoke now selects the host CLI and CI covers Node 20/22, build, docs, package contents, and install; real browser/auth portability remains |
| F3 | One JSON file grew without partitioning | resolved | PR B | Schema 17 sharded repository, atomic writes, migration backup, missing-shard detection, and index rebuild are covered |
| F4 | Local assets had no collaboration model | deferred | post-2.2 | Revisit only when remote multi-writer collaboration is required |
| F5 | Multiple requirements could contaminate assets | partial | PR A/PR B/PR C | System-owned shards now isolate page/evidence/knowledge observations and indexes carry requirement ownership; execution ContextPack retrieval filters both `systemId` and `requirementSetId`; mixed requirement suites now use an explicit `multi-requirement` artifact segment, preserve all requirement revision IDs in the manifest/source refs, and list them in the static report; complete same-system multi-requirement Eval/report reconciliation remains |
| G1 | Facade responses consumed excessive context | partial | PR A/PR C | `responseMode=summary` and explicit paging now cover CompileRun plus requirement, TestIntent, ExecutableCase, ExecutionPlan, SuiteRun, Ledger, exploration, and evidence reviews; status exposes bounded active-suite progress/next-case summaries, requirement-suite-run review now returns bounded run/case/status totals, and diagnosis review has bounded metrics/evidence references; broader nested suite payloads still need additional domain-specific summary contracts |
| G2 | Documentation and runtime behavior diverged | partial | every PR | Package Skill, English docs, and Chinese docs must be checked in the same PR |
| G3 | Internal concepts dominated the user experience | deferred | post-2.2 | Natural-language role-oriented review remains a later UX pass |
| G4 | Error and time presentation was not localized | partial | PR A/PR C | New errors are bilingual and static reports are searchable; static suite reports now format created/updated timestamps using the owning system locale with an `en-US` fallback and render readable Chinese chrome without rewriting evidence/bug text, while common runtime failures expose bilingual recovery messages; the complete error catalog remains |

## Stage totals

| Status | Count |
|---|---:|
| resolved | 16 |
| partial | 23 |
| open | 0 |
| deferred | 2 |
| total | 41 |

This register closes only through its stated acceptance checks. A passing feature test does not close broader evidence, security, or reliability work assigned to a later PR.

## Latest recalibration after PR #124

The register was reviewed against the merged auth-provider preflight implementation. The
status totals remain unchanged because none of the remaining partial items has
met its full production acceptance condition:

- **C1 authentication refresh** now has explicit provider selection, provider
  preflight through `bc_configure target=auth operation=preflight`, built-in
  token/cookie protected-state refresh, host-agent refresh compatibility, and
  Requirement Suite execution gating, and fresh-context re-verification. `bc_status` now exposes registered,
  configured, and unavailable refresh providers. OAuth, CAS, and SAML
  production adapters are still partial; preflight only proves adapter
  readiness and does not replace real provider authentication. Manual script
  profiles without a declared refresh provider remain on the verified-browser-
  state path.
- **F5 same-system reconciliation** now persists requirement coverage snapshots,
  detects missing intents/cases, superseded revisions, unbound cases, and
  separates mixed-requirement artifact segments. Complete historical Eval and
  report reconciliation is still partial.
- **E5 long-cycle stability** now exposes concrete due `scheduledRuns`, lease
  ownership, recovery metadata, and a `claim-next-scheduled` Facade flow to
  external schedulers, while production scheduling, long-run thresholds, and
  operational alerting remain partial.
- **B1/B4 cross-surface recovery** has real-browser evidence for allowlist
  filtering and fail-closed cross-origin behavior. Full recovery across
  remounts, popups, iframes, and multiple origins remains partial.

The next slice should connect a real provider implementation and a deployment-
specific scheduler contract; it must continue to report missing provider or
scheduler capabilities as explicit readiness gaps.

## Current implementation slice

The provider and scheduling slice is now implemented on the working branch:

- OAuth, CAS, and SAML use a shared HTTP adapter contract and write only
  protected Playwright storage-state paths. Credentials and protocol endpoints
  remain AuthProfile configuration, not source-code defaults.
- Requirement Suite scheduling can process one due iteration through the
  `process-next-scheduled` Facade action with a lease, retry backoff, and
  bounded one-at-a-time execution.
- Stability evaluation now exposes threshold diagnostics for failure rate,
  consecutive failures, strong evidence, blocked runs, and maximum duration.

The remaining production boundary is operational: a real IdP/CAS/SAML tenant,
its allowed redirect/service URLs, and an external scheduler must be supplied
by the deployment. These adapters are not treated as proof of a successful
login until their returned storage state is verified against the target system.
