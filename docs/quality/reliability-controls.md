# Reliability controls

Brain Creator now treats reliability as a control plane instead of a claim that a green run proves the whole requirement.

## Cross-surface recovery

System exploration records the requested surface (`document`, `iframe`, `popup`, `shadow-root`, or `wujie`) and reacquires that surface independently. A missing child surface is not replaced with the main document. Cross-origin or unregistered surfaces are blocked with evidence so the caller can create a Gap.

## Authentication refresh

Authentication refresh uses a provider registry. The built-in host-agent adapter preserves the existing Claude/Codex/host callback. Token, cookie, OAuth, CAS, and SAML integrations are provider slots, not magic refreshes: when no adapter is registered Brain Creator returns `needs-user` and creates the normal AuthCheckpoint path. Refresh attempts have a bounded timeout and never return raw secrets.

Use `bc_configure` with `target=auth` and `operation=refresh` to request a refresh explicitly.

## Same-system requirement reconciliation

Requirement suites persist the expected requirement-set scope and reconcile executable cases before and during review. The result distinguishes:

- `complete`: every expected requirement set has current cases and no cross-system or duplicate compile-key reference.
- `partial`: a requirement set or executable case is missing.
- `conflicted`: a case belongs to another system or duplicate current compile keys exist.

The reconciliation is visible from `bc_review` with `target=requirement-suite-run`.

## Long-cycle stability

Stability is evaluated with target and minimum sample counts, failure rate, consecutive failures, maximum duration, strong evidence, and blocked-run policy. A single green run remains `insufficient-sample`. When a minimum interval is configured, the next iteration is persisted with `nextRunAt` and is not started early; the next explicit `bc_run`/resume call starts it after the time is due.

This is durable scheduling metadata, not a background worker. Production cron, distributed leases, and vendor-specific auth refresh remain deployment-specific extensions.
