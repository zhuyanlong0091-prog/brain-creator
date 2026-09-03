# Brain Creator 2.2.0 Release Candidate

This page records the L3 host-mode evaluation boundary for the 2.2.0 candidate. It is an evaluation note, not a release announcement.

## What Is Measured

The source checkout includes `npm run verify:l3-eval`. Its deterministic, sanitized corpus covers:

- HR business rules and approval flow.
- Order approval, rejection, and finance handoff.
- Image-derived workflow and state-machine coverage.
- Cross-role journeys and AuthProfile mapping.
- Same-system multi-requirement reconciliation.
- Structured execution evidence.
- A 20-iteration synthetic Runner stability sample.

The command reports each dimension as `measured` or `not-measured`, includes sample counts and thresholds. Use `npm run verify:l3-eval:json` for JSON output, or invoke `node --loader ts-node/esm scripts/l3Eval.ts --json --output <path>` to save it.

## Release Boundary

The report remains blocked until a deployment supplies real-system regression evidence and a reviewed historical Bug replay corpus. Synthetic samples prove that the controls are wired and deterministic; they do not prove arbitrary business correctness or production stability.

Use `npm run verify:l3-eval:strict` as a release gate. Do not commit the generated report, credentials, browser state, screenshots, traces, or target-system data.

## Required Follow-Up

1. Run the approved L3 flow against an explicitly configured test system.
2. Import a sanitized historical Bug corpus and record replay outcomes.
3. Compare the external evidence with this baseline using an `EvaluationTrial`.
4. Only after the real-system gates pass should the package version be prepared for release.
