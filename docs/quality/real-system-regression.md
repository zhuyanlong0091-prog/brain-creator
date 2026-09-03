# Real-system regression samples

This repository contains a sanitized, deterministic regression sample for the
remaining execution-quality partials. It uses a local HTTP system fixture, so
it never commits a production URL, account, password, token, business record,
or screenshot.

## What the sample proves

Run the focused sample with:

```bash
npx vitest run src/quality/realSystemRegression.test.ts
```

The sample covers:

- cross-page navigation from a module entry to a form page;
- SPA `pushState` and a form that remounts after a conditional selection;
- real Chromium authentication preflight with an expired storage state,
  host refresh, and post-refresh browser verification;
- authentication refresh evidence recorded in the requirement-suite Run
  Ledger with the role and AuthProfile reference;
- test-data lookup-or-create, created-data lease, terminal execution evidence,
  cleanup task, and released lease;
- two role declarations, two requirement-scoped case names, and three isolated
  stability iterations;
- a negative stability assertion proving that one limited-assurance iteration
  downgrades the group from `stable` to `unstable`.

## Environment

The test uses the first available browser in this order:

1. `BRAIN_CREATOR_TEST_BROWSER_PATH`;
2. the installed Google Chrome or Microsoft Edge path on Windows;
3. Playwright's managed Chromium installation on other hosts.

Install the managed browser when the host has no system browser:

```bash
npx playwright install chromium
```

If the browser download is blocked, set `BRAIN_CREATOR_TEST_BROWSER_PATH` to a
trusted local Chromium-based browser executable. The test fixture remains
local-only.

## Relationship to the problem register

The sample strengthens the evidence for B1/B4 (cross-page and remount
recovery), C1 (refresh and re-verification), B5/E6 (test-data lifecycle), E4/E5
(multi-role and repeat stability), and F5 (same-system multi-requirement
execution). These items remain `partial` where the register requires broader
production conditions such as cross-origin surface recovery, provider-specific
refresh implementations, full requirement reconciliation, or scheduled
long-running runs.

The fixture is an acceptance sample, not a claim that every real system has
the same DOM, authentication provider, data API, or workflow semantics.

For the broader L3 delivery gate, run `npm run verify:l3-eval`. That command
also evaluates sanitized HR, order approval, image state-machine, cross-role,
multi-requirement, and synthetic long-run samples. It intentionally keeps
real-system regression and historical Bug replay as `not-measured` until
deployment evidence is supplied.
