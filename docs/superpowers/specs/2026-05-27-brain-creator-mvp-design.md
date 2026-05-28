# Brain Creator MVP Design

## Product Direction

Brain Creator is an engineering control console for turning real web application evidence into executable test assets. The MVP focuses on one closed loop: configure access, discover a page model, record a training session, generate a constrained natural-language case, surface any missing evidence as gaps, and verify the flow in a real browser.

## Users And Job

The first users are QA engineers and automation engineers who need to move from exploratory browser work to repeatable automation without losing evidence. Their immediate job is not to manage a full enterprise asset platform. It is to prove that a real page can be modeled, trained, and converted into a traceable case.

## MVP Scope

The MVP includes:

- Workbench dashboard with workflow status and shortcuts.
- Auth profile management with redacted secrets.
- Page model discovery from a URL and auth profile.
- Locator point extraction using stable locator rules.
- Training session capture with action steps and API flow placeholders.
- Generated cases that must bind to existing page model assets.
- Gap creation when required evidence is missing.
- Asset search across page models, locators, sessions, API flows, generated cases, and gaps.

Deferred from MVP:

- Full i18n glossary governance.
- Real LLM provider integration.
- PostgreSQL and Redis deployment hardening.
- External target-system browser recording.
- Automatic PR creation without a configured Git remote.

## Architecture

The first implementation uses a Next.js application with focused TypeScript domain modules. The domain layer is written so the later PostgreSQL, Redis/BullMQ, Playwright Worker, and object storage implementation can replace the in-memory adapter without changing UI behavior.

```text
Browser UI
  -> Next.js API routes
    -> BrainCreatorService
      -> InMemoryBrainCreatorRepository
      -> locator/generation/security helpers
```

This keeps the MVP shippable while preserving the interfaces needed for the planned production architecture.

## Data Flow

1. User creates an auth profile. Secrets are stored redacted in responses.
2. User starts page discovery with a URL and auth profile.
3. The service creates a page model, locator points, probe result, and gap if evidence is incomplete.
4. User creates and completes a training session.
5. Completion stores action steps and an API flow.
6. User submits a natural-language requirement.
7. Case generation binds steps to existing locator points. If no binding is possible, a gap is created.
8. Asset search returns a unified list for the workbench and asset page.

## Phase 2: API-Backed Local Loop

The second MVP phase turns the workbench from a visual demo into a usable local flow. The UI now owns the operating inputs and calls the existing local API routes directly:

1. Create and verify an auth profile.
2. Discover a page model and locator points from DOM text.
3. Create and complete a training session.
4. Save an API Flow placeholder from the completed training session.
5. Generate a constrained natural-language case.
6. Surface blocked generation as a Gap instead of inventing missing steps.
7. Search local assets.
8. Resolve the active Gap.

This phase intentionally keeps the in-memory repository and rule-based generation. PostgreSQL, Redis, Playwright Worker, external target pages, and real LLM providers remain deferred so the local product loop can be verified end to end first.

The user-facing acceptance standard is simple: a non-technical user can open the local app, fill the workbench fields, click the workflow buttons in order, and see real API results, logs, statuses, assets, and resolved gaps on the page.

## Error Handling

API responses use a consistent shape:

```json
{
  "success": true,
  "data": {},
  "errors": [],
  "traceId": "local-trace"
}
```

Validation failures return `success: false` and do not mutate the repository.

## Testing

Implementation follows TDD. Domain tests cover redaction, task state transitions, locator extraction, gap behavior, generated-case binding, and asset search. API tests cover required routes. Browser QA covers the local MVP flow with console and network checks.

## Spec Review

- No placeholder requirements remain.
- MVP scope is intentionally smaller than the final architecture.
- The production stack is represented by stable interfaces rather than full infrastructure.
- Git remote and external target credentials are explicit release blockers.
