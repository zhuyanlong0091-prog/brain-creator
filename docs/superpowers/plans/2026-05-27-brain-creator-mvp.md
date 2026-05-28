# Brain Creator MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working local Brain Creator MVP with dashboard, APIs, domain logic, tests, and browser-verifiable flow.

**Architecture:** Next.js app with a focused TypeScript domain service and in-memory repository. The MVP keeps repository and service boundaries stable so PostgreSQL, Redis, Playwright Worker, and object storage can replace local adapters later.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Testing Library, Playwright.

---

### Task 1: Project Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `next.config.js`
- Create: `app/layout.tsx`
- Create: `app/globals.css`

- [ ] Step 1: Write minimal package and config files.
- [ ] Step 2: Install dependencies.
- [ ] Step 3: Run `npm test -- --run`; expected: no tests found or pass once tests exist.

### Task 2: Domain Model And Repository

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/repository.ts`
- Create: `src/domain/service.ts`
- Test: `src/domain/service.test.ts`

- [ ] Step 1: Write failing tests for auth redaction, page discovery, generated-case gap behavior, and asset search.
- [ ] Step 2: Run `npm test -- src/domain/service.test.ts --run`; expected: fail because domain files are missing.
- [ ] Step 3: Implement minimal types, repository, and service.
- [ ] Step 4: Run the same test; expected: pass.

### Task 3: API Routes

**Files:**
- Create: `src/api/response.ts`
- Create: `src/api/singleton.ts`
- Create: `app/api/auth-profiles/route.ts`
- Create: `app/api/auth-profiles/[id]/verify/route.ts`
- Create: `app/api/page-models/discover/route.ts`
- Create: `app/api/page-models/[id]/route.ts`
- Create: `app/api/training-sessions/route.ts`
- Create: `app/api/training-sessions/[id]/complete/route.ts`
- Create: `app/api/generated-cases/route.ts`
- Create: `app/api/assets/search/route.ts`
- Create: `app/api/gaps/[id]/resolve/route.ts`
- Test: `src/api/routes.test.ts`

- [ ] Step 1: Write failing API tests for route contracts.
- [ ] Step 2: Run `npm test -- src/api/routes.test.ts --run`; expected: fail because routes are missing.
- [ ] Step 3: Implement route handlers using the singleton service.
- [ ] Step 4: Run API tests; expected: pass.

### Task 4: Workbench UI

**Files:**
- Create: `app/page.tsx`
- Create: `src/ui/BrainCreatorWorkbench.tsx`
- Test: `src/ui/BrainCreatorWorkbench.test.tsx`

- [ ] Step 1: Write failing UI test for rendering workflow cards and core action panels.
- [ ] Step 2: Run `npm test -- src/ui/BrainCreatorWorkbench.test.tsx --run`; expected: fail because component is missing.
- [ ] Step 3: Implement workbench UI with forms and asset panels.
- [ ] Step 4: Run UI test; expected: pass.

### Task 5: Verification And QA

**Files:**
- Create: `tests/e2e/brain-creator.spec.ts`
- Modify: `package.json`

- [ ] Step 1: Add Playwright smoke test for local MVP flow.
- [ ] Step 2: Run unit and API tests with `npm test -- --run`.
- [ ] Step 3: Run build with `npm run build`.
- [ ] Step 4: Run browser QA with `npm run test:e2e`.

---

### Task 6: API-Backed Workbench Loop

**Files:**
- Create: `src/ui/apiClient.ts`
- Test: `src/ui/apiClient.test.ts`
- Modify: `src/ui/BrainCreatorWorkbench.tsx`
- Test: `src/ui/BrainCreatorWorkbench.test.tsx`
- Modify: `tests/e2e/brain-creator.spec.ts`

- [x] Step 1: Write failing API client tests for successful envelopes, failed envelopes, and network errors.
- [x] Step 2: Implement the UI API client so components do not duplicate fetch handling.
- [x] Step 3: Write failing workbench tests for step-by-step API execution and the one-click local loop.
- [x] Step 4: Refactor the workbench so forms, buttons, logs, statuses, and result cards use real API responses.
- [x] Step 5: Use local return values inside the one-click loop so downstream steps do not depend on delayed React state.
- [x] Step 6: Expand browser QA to cover auth creation, verification, page modeling, training, completion, case generation, asset search, and gap resolution.

### Task 7: Phase 2 Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-brain-creator-mvp-design.md`
- Modify: `docs/superpowers/plans/2026-05-27-brain-creator-mvp.md`

- [x] Step 1: Run `npm test`; expected: all unit, API, and UI tests pass.
- [x] Step 2: Run `npm run build`; expected: production build succeeds.
- [x] Step 3: Run `npm run test:e2e`; expected: Chromium completes the local loop with no console errors.
- [x] Step 4: Review git diff and commit the local branch. Do not push or create PR until a Git remote exists.
