# Reliability controls

Brain Creator now treats reliability as a control plane instead of a claim that a green run proves the whole requirement.

## Cross-surface recovery

System exploration records the requested surface (`document`, `iframe`, `popup`, `shadow-root`, or `wujie`) and reacquires that surface independently. A missing child surface is not replaced with the main document. Cross-origin or unregistered surfaces are blocked with evidence so the caller can create a Gap.

## Authentication refresh

Authentication refresh uses a provider registry and one common adapter contract. Token and cookie profiles can be re-materialized into a protected storage state by the built-in adapter. OAuth uses the standard refresh-token grant, CAS validates a configured service ticket, and SAML exchanges a host-captured SAMLResponse at a configured session endpoint. The host-agent adapter remains available for browser-specific or vendor-specific flows. Provider credentials and endpoints are supplied through the encrypted AuthProfile; no vendor secret is bundled in Brain Creator. Refresh attempts have a bounded timeout and never return raw secrets.

Use `bc_configure` with `target=auth` and `operation=preflight` to check provider readiness without refreshing credentials, then use `operation=refresh` to request a refresh explicitly. `bc_status` reports registered, configured, and unavailable refresh providers so a host can preflight an OAuth/CAS/SAML profile before a suite waits on it. A provider-specific adapter may implement deeper checks; a registered adapter without a preflight hook is reported as registered-only readiness, not as a successful login.

Requirement Suite execution applies the same readiness gate before creating an execution plan when the selected profile declares a refresh provider or uses token/cookie materialization. A missing or unavailable provider creates one open `requirement-suite-auth-preflight` Gap for the run and prevents the case from entering the Agent/Playwright chain. Manual script profiles without a declared refresh provider continue through the existing verified-browser-state path.

## Same-system requirement reconciliation

Requirement suites persist the expected requirement-set scope and reconcile executable cases before and during review. The result distinguishes:

- `complete`: every expected requirement set has current cases and no cross-system or duplicate compile-key reference.
- `partial`: a requirement set or executable case is missing.
- `conflicted`: a case belongs to another system or duplicate current compile keys exist.

The reconciliation is visible from `bc_review` with `target=requirement-suite-run`. It also reports missing TestIntents, missing executable cases, superseded revisions, and unbound cases for the same knowledge project.

## Long-cycle stability

Stability is evaluated with target and minimum sample counts, failure rate, consecutive failures, maximum duration, strong evidence, and blocked-run policy. The result includes threshold diagnostics, not only a verdict, so a report can distinguish insufficient sample from an exceeded failure, duration, evidence, or blocked-run threshold. A single green run remains `insufficient-sample`. When a minimum interval is configured, the next iteration is persisted with `nextRunAt` and is not started early.

Scheduled stability runs use an explicit claim/lease control plane. An external scheduler or host Agent can preview due work through `bc_status`, use `suiteAction=claim-next-scheduled` to claim work, or use `suiteAction=process-next-scheduled` to claim and process one due iteration with bounded one-at-a-time execution. It can renew the lease during a long run and release it with an error and backoff for retry. The status facade exposes bounded per-run `scheduledRuns` records with the run ID, project ownership, due state, iteration target, lease expiry, and last scheduler error, so a scheduler can enumerate concrete work before claiming it. An expired lease can be claimed by another owner, so a crashed process does not permanently strand the run. The scheduler remains externally triggered, which keeps the local MVP deterministic and avoids an unbounded background worker inside MCP.

## Execution visibility

Every Run Ledger entry receives a stable per-run sequence and projects to an `ExecutionProgressEvent`. Reporter-backed steps add step ID, title, assertion summary, screenshot, elapsed time, and trace identity. Protected values and URL query values are redacted before persistence.

`bc_run` and `bc_submit_agent_output` emit MCP Progress Notifications when the caller supplies a progress token. Notification delivery is best-effort and never changes the execution outcome; the durable Ledger remains authoritative. `bc_status` reports the current event and a `possiblyStalled` warning after the active event exceeds the configured threshold. Terminal events are never marked stalled. The static Suite report is rewritten after each completed case so an operator can inspect progress and evidence before the whole Suite ends.

Execution has an explicit `browserMode=headless|observe` contract. Headless remains the unattended default. Observe mode adds Playwright `--headed`, preserves one worker, is persisted on the Suite/Agent task, and is displayed by status and the static report. A desktop capability check fails closed when a window cannot be shown; there is no hidden fallback. Browser visibility improves operator confidence but never changes assertion assurance or replaces structured evidence.
