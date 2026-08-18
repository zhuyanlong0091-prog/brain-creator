# Reliability controls

Brain Creator now treats reliability as a control plane instead of a claim that a green run proves the whole requirement.

## Cross-surface recovery

System exploration records the requested surface (`document`, `iframe`, `popup`, `shadow-root`, or `wujie`) and reacquires that surface independently. A missing child surface is not replaced with the main document. Cross-origin or unregistered surfaces are blocked with evidence so the caller can create a Gap.

## Authentication refresh

Authentication refresh uses a provider registry. Token and cookie profiles can be re-materialized into a protected storage state by the built-in adapter. The host-agent adapter preserves the existing Claude/Codex/host callback. OAuth, CAS, and SAML integrations are provider slots, not magic refreshes: when no adapter is registered Brain Creator returns `needs-user` and creates the normal AuthCheckpoint path. Refresh attempts have a bounded timeout and never return raw secrets.

Use `bc_configure` with `target=auth` and `operation=refresh` to request a refresh explicitly. `bc_status` reports registered, configured, and unavailable refresh providers so a host can preflight an OAuth/CAS/SAML profile before a suite waits on it.

## Same-system requirement reconciliation

Requirement suites persist the expected requirement-set scope and reconcile executable cases before and during review. The result distinguishes:

- `complete`: every expected requirement set has current cases and no cross-system or duplicate compile-key reference.
- `partial`: a requirement set or executable case is missing.
- `conflicted`: a case belongs to another system or duplicate current compile keys exist.

The reconciliation is visible from `bc_review` with `target=requirement-suite-run`. It also reports missing TestIntents, missing executable cases, superseded revisions, and unbound cases for the same knowledge project.

## Long-cycle stability

Stability is evaluated with target and minimum sample counts, failure rate, consecutive failures, maximum duration, strong evidence, and blocked-run policy. A single green run remains `insufficient-sample`. When a minimum interval is configured, the next iteration is persisted with `nextRunAt` and is not started early; the next explicit `bc_run`/resume call starts it after the time is due.

Scheduled stability runs use an explicit claim/lease control plane. An external scheduler or host Agent can preview due work through `bc_status`, or use `bc_run` with `suiteAction=claim-next-scheduled` to preview and claim the first due run in one Facade flow. It can renew the lease during a long run and release it with an error for retry. The status facade exposes bounded per-run `scheduledRuns` records with the run ID, project ownership, due state, iteration target, lease expiry, and last scheduler error, so a scheduler can enumerate concrete work before claiming it. An expired lease can be claimed by another owner, so a crashed process does not permanently strand the run. This is still durable scheduling metadata, not a background worker; production cron and distributed storage remain deployment-specific extensions.
