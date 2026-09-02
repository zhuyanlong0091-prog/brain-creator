# Testcase And Testdata Brain

The Testcase Brain turns reviewed business intent into an executable case. The Testdata Brain makes the data used by that case explicit, reusable, and auditable. They are connected by stable semantic entity references rather than by the order in which a suite happens to run.

## Compilation Order

Brain Creator compiles a case through this sequence:

```text
BusinessScenario
  -> requirement workflow or state path
  -> System Brain navigation and action binding
  -> business entity dependency graph
  -> TestDataPlan
  -> assertion oracle
  -> ExecutableCase
```

Every executable step keeps source references. A derived step is allowed only when the corresponding workflow or System Brain evidence provides one unambiguous path. Missing or ambiguous evidence remains a review state; it is not converted into a guessed action.

## Entity References

Use a stable reference for a business entity, for example `employee:testperson001`:

```text
Create employee       produces: employee:testperson001
Edit employee         consumes: employee:testperson001
Approve employee      consumes: employee:testperson001
```

The reference is not a secret and is not a replacement for the value entered into a field. It identifies the same business entity across cases. The compiled case records it in `entityReferenceRequirements`, the data plan, relevant operations, and step bindings.

The dependency graph enforces four outcomes:

- One producer: the consumer is ordered after the producer and the edge is recorded.
- No producer: the case is `needs-data`.
- Multiple producers: the case is `ambiguous`; Brain Creator does not choose one.
- A dependency cycle: the case is `blocked` and requires a data design change.

Stale and superseded executable cases are never treated as current producers. A previous run or an old compiled artifact cannot silently satisfy a new case dependency.

Review the graph through the existing Facade:

```text
bc_review target=case-dependency systemId=<system-id> responseMode=summary
```

The result contains nodes, edges, dependency order, unresolved reasons, and source references. Use `responseMode=full` only when inspecting a specific audit.

## Testdata Provider Lifecycle

System-specific adapters implement the existing provider contract:

```text
lookup -> create -> transition -> verify -> cleanup
```

The provider receives the semantic entity reference and the selected `systemId`. Testdata Brain records the returned reference, evidence, lease, and cleanup state. Reuse is preferred. Creation requires explicit authorization and a cleanup policy. Provider failures remain typed data or environment Gaps instead of becoming product Bugs.

The built-in provider is only a deterministic fixture, not a universal adapter for arbitrary business systems. A real integration must supply system-specific lookup, CRUD, workflow transition, and cleanup behavior, or the host Agent must perform the approved operation and submit evidence through the Facade.

## Scenario Data Plans

Each `BusinessScenario` receives a data plan before case compilation. The plan records selected profiles, stable entity references, profile dependencies, and one of three readiness states:

- `ready`: existing entities or deterministic field values are available;
- `creatable`: an approved create operation and cleanup policy are required;
- `blocked`: a profile, entity reference, dependency, or cleanup policy is missing.

When assessed for a target system, the plan carries that system context and is never reused for another system. Review it through `bc_review target=testdata`. Entity lifecycle events record lookup, create, transition, verify, cleanup, and host-agent observation, including the provider and source references.

## Assertion Contracts

Assertions are compiled separately from action text. Each assertion must have:

- a requirement or approved source reference;
- an oracle type such as value, state, visibility, workflow, network, or side effect;
- an evidence requirement describing what must be captured;
- a strength of `strong` or `limited`.

Playwright success alone is not a business assertion. A case without a source-backed oracle is blocked or limited and cannot silently become a trusted regression.

## Practical Review Checklist

Before execution, review:

1. The dependency graph has no unresolved missing, ambiguous, or cyclic references.
2. Every created entity has a lookup or creation decision and a cleanup policy.
3. Every consumed entity points to an explicit producer or an approved external reference.
4. Every assertion identifies what proves the expected business outcome.
5. The compiled case is bound to the selected System Brain and does not use stale artifacts.

This design keeps test cases reusable across business systems while keeping system-specific data operations inside adapters and keeping requirement expectations separate from observed behavior.
