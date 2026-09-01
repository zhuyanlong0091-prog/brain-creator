# Brain Creator Core Concepts

Understand how Brain Creator separates requirement intent, system evidence, executable testing, and failure diagnosis.

## The Product Model

Brain Creator is not a generic browser macro recorder and not a Web UI. It is a testing-domain layer used by an Agent host such as Claude Code or Codex.

```text
Source -> Requirement Brain -> Test Design -> Approval
       -> System Brain -> Case Compiler -> Test Data
       -> Execution Plan -> Playwright -> Evidence
       -> Bug or Gap -> Review and knowledge feedback
```

The Agent handles conversation and host capabilities. Brain Creator supplies persistent domain models, deterministic gates, execution orchestration, and evidence contracts.

## Five Brains And The Harness

The five Brains are logical boundaries inside one package, not five services:

- `Requirement Brain`: expected behavior, source clauses, rules, workflows, and coverage.
- `System Brain`: observed pages, locators, navigation, state transitions, and API evidence.
- `Testcase Brain`: reviewable intents and evidence-bound executable cases.
- `Testdata Brain`: business entities, reusable data recipes, leases, dependencies, and cleanup.
- `Testexecution Brain`: execution plans, assertions, evidence, diagnosis, and regression history.

The shared semantic spine connects these boundaries. For example, requirement terms such as `新增` and observed terms such as `新建` can resolve to the same `action:create` concept. A value such as `employee:testperson001` is a business entity reference that can be produced by one case and consumed by a later edit case.

Schema 20 establishes the persistent vocabulary for L3 work: `BusinessObjectModel`, `DecisionTableModel`, `SemanticBinding`, `BusinessScenario`, `ScenarioAssuranceContract`, `ScenarioTrustRecord`, and `OnboardingPlan`. OnboardingPlan joins a reviewed Requirement baseline to requirement-directed, bounded system exploration under one approval. Test design now produces a domain-neutral scenario portfolio; Assurance blocks scenarios without a unique system binding, usable data, and a source-backed oracle. A scenario becomes `verified` after one strong observed run and `trusted` only after three unchanged strong runs. Legacy executable cases are never migrated directly to `verified` or `trusted`.

The built-in action alias policy is domain-neutral and auditable. It can normalize terms such as `新增`, `新建`, and `create`, but a text alias alone does not prove that two business operations are equivalent. Conditional and multi-step bindings require system evidence and later assurance gates.

The Harness Runtime controls the lifecycle around every Agent task: context preparation, approval, provider waiting, execution, Eval, retry/healing budget, and terminal state. Agent output does not write domain assets until it passes the relevant structured gate. Host-agent continuations resume the same persisted Brain task instead of creating a second hidden lifecycle. Context budgets and path boundaries are enforced before provider output is accepted. The current implementation exposes task state and events through `bc_status`; low-level orchestration remains compatible while it is gradually moved behind this lifecycle.

### Unified Harness Output And Gates

Planner, Generator, and Healer use versioned structured outputs. Scenarios, steps, assertions, and repairs must carry source references; Generator and Healer stay inside their declared file boundary, and Healer cannot remove assertions. A non-`pass` Planner Eval stops downstream test-asset writes. A business assertion failure in an execution chain still flows through Reporter and Bug/Gap diagnosis.

## Requirement Brain

Requirement Brain answers: **What should the business system do, and where did that expectation come from?**

It contains:

- `KnowledgeProject`: a requirement knowledge boundary independent of a runtime system.
- `RequirementSource`: a local file, Feishu document, Web page, or host-submitted content package.
- `RequirementSet`: one version of the requirement and its impact scope.
- `KnowledgeNode` and `KnowledgeEdge`: modules, actors, objects, fields, rules, workflows, states, permissions, integrations, data constraints, terms, and requirement clauses.
- `TestIntent`: a reviewable testing objective linked to source clauses.
- `TestDataProfile`: the data strategy needed to exercise an intent.

Host-assisted analysis is a four-task Harness: Document Mapper, Clause Analyst, Business Modeler, and isolated Coverage Critic. The first three stages turn text, tables, and confirmed visual evidence into source-backed clauses, business objects, workflows, states, decision tables, and invariants. The Critic receives those structures and source evidence but not the designer conversation. A valid structure is not automatically a valid baseline: blocked Critic output cannot write Requirement domain assets, and a second schema failure becomes a recoverable Gap.

Generated knowledge starts as draft. Confirmed knowledge must remain traceable to source references. Contradictions cannot be approved away; the source or baseline must be revised.

## System Brain

System Brain answers: **How does the selected real system currently behave?**

It derives a system-isolated view from:

- `PageModel` and screenshots;
- `LocatorPoint` and locator confidence;
- `ProbeResult` and browser diagnostics;
- `SystemExploration` and observed navigation edges;
- `TrainingSession` and `ActionStep` evidence;
- `ApiFlow` evidence;
- bounded safe interaction state transitions.

Requirement expectations and observed behavior are separate layers. A mismatch is retained as a conflict until execution evidence determines whether it is a product Bug, an outdated requirement, or an unresolved Gap.

### Snapshots And Diff

Each refreshed System Brain can produce a candidate snapshot. Snapshot asset identity is based on route, semantic role, and normalized meaning rather than random PageModel IDs. Use `bc_review` with `target=system-brain` and `view=history` or `view=diff` to inspect versions.

Locator selector changes are recorded as `locator-changed` and can be auto-accepted when the semantic target is stable. Workflow, state-transition, and API behavior changes are recorded as `behavior-changed`, require review, and mark affected compilation for re-evaluation. A missing asset is never treated as deletion from one observation; it is a reviewable removal candidate.

After a confirmed snapshot reports a behavioral change, TestIntents and ExecutableCases that reference that System Brain are marked `stale` with the ChangeSet, reason, and timestamp. `bc_prepare action=reconcile-system-brain` compares approved Requirement semantics with observed pages, workflows, state transitions, and integrations; `bc_review target=semantic-binding` exposes exact, alias, step-expansion, conditional, missing, and conflict outcomes. Resolving test data cannot make a stale case look ready; confirm the new snapshot first, then incrementally recompile affected intents with `bc_prepare action=recompile-stale-cases`. Use `bc_review target=system-brain view=diff` for the change and `bc_status` for stale counts and recovery details.

## Case Compiler

The compiler converts an approved `TestIntent` into an `ExecutableCase` for one bound `systemId`.

It may add an implicit navigation or state action only when the evidence supports one unique, high-confidence path. Ambiguous routes, missing values, missing locators, and unreachable pages produce a resumable `ExplorationTask`. The compiler records five stage verdicts and resumes after evidence is added. A final Gap is created only when exploration explicitly fails; unresolved test data uses `needs-data`.

This rule prevents an Agent from silently inventing the kind of hidden action a human tester might infer from context.

## Test Data

`TestDataProfile` describes what data is needed. `TestDataPlan` orders dependencies and chooses among fixed, generated, unique, existing-reference, runtime-captured, and secret-reference strategies.

`TestDataLease` records what was reused or created, its evidence, and its cleanup state. Reuse is the default. Creating data requires explicit authorization and a cleanup policy.

Testdata Brain also maintains a business-entity dependency graph. Entities can move through `lookup`, `create`, `transition`, `verify`, and `cleanup` Provider operations; a later case consumes the same entity reference instead of relying on execution order or copied strings. Review it with `bc_review target=testdata systemId=<system-id>`.

Secrets remain references. They must not be copied into prompts, generated tests, logs, reports, or package artifacts.

## Execution Plan

An `ExecutionPlan` is an immutable, hash-addressed snapshot of the approved requirement state, selected system, auth reference, navigation and state plans, test-data leases, open blockers, and bounded generator context.

Only a `ready` plan can enter Generator and Playwright. Semantic changes produce a new snapshot; timestamp-only changes do not.

## Bug And Gap

Use a `BugReport` only when evidence shows that actual business behavior does not match an approved expectation after controlled retry and diagnosis.

Use a `Gap` when Brain Creator cannot make a trustworthy conclusion. Common categories include:

- automation or generated-test failure;
- locator or missing-element evidence;
- test-data preparation or cleanup;
- authentication or human checkpoint;
- environment or network failure;
- connector or source parsing failure;
- ambiguous business workflow;
- missing requirement evidence.

Every blocked terminal state must remain explainable through a Gap or checkpoint.

Recovery state comes from the persisted Run Ledger rather than the host Agent's last message. `bc_status` can report the current case, step, page, sequence, wait reason, `possiblyStalled`, and next action even when the host does not support progress notifications.

## Facade And Internal Tools

Normal Agent use exposes a small Facade profile:

- `bc_status`: current readiness and recommended action.
- `bc_configure`: systems, auth, knowledge projects, terms, rules, and checkpoints.
- `bc_prepare`: requirement, System Brain, test-data, and execution preparation.
- `bc_run`: approved requirement suites, document suites, and regressions.
- `bc_review`: knowledge, runs, evidence, Bugs, and Gaps.
- host-agent task preparation and submission tools.

The full profile retains low-level tools for compatibility, testing, audit, and debugging. A denied or cancelled Facade action must not be retried through an equivalent internal tool.

## Agent Bridge

Planner, Generator, and Healer work can run in three ways:

- `claude`: Brain Creator launches a configured Claude subprocess.
- `codex`: Brain Creator launches a configured Codex subprocess.
- `host-agent`: the current Agent receives a task package and submits structured output back to Brain Creator.

`host-agent` avoids a nested Agent process and is the recommended project setup for Codex plugin workflows. `disabled` supports preview-only operation.

Run `brain-creator doctor` before a confirmed workflow to see which provider is active.

## Storage

Brain Creator is local-first. Runtime state and evidence default to `.brain-creator/`; generated requirement knowledge defaults to `.brain-creator/knowledge`.

The current sharded repository schema is 20. A schema 19 store is backed up before migration; if the writer lock prevents migration, Brain Creator retains the schema 19 snapshot instead of partially claiming the upgrade.

Run `npm run verify:autonomy-baseline` from a source checkout to print the deterministic L3 baseline. The report distinguishes measured controls from capabilities that are not measured yet; the scenario portfolio and synthetic mutation detection foundations are measured, while historical Bug replay and real-system mutation effectiveness remain open.

You can set `BRAIN_CREATOR_KNOWLEDGE_DIR` to an external Obsidian-compatible directory. Runtime data, auth state, prompts, traces, and generated tests must remain uncommitted.

## Safety Boundaries

- No execution before explicit approval.
- No cross-system evidence reuse.
- No raw secret persistence in user-facing assets.
- Bounded system exploration with allowlisted HTTP(S) URLs.
- Form submission and write-like safe probes are blocked during exploration.
- Deterministic retry and Healer budgets.
- Evidence-backed diagnosis before Bug creation.

## Next Steps

- Follow [Requirement to test](guides/requirement-to-test.md).
- Configure the runtime in [MCP installation](mcp-installation.md).
- Use [Troubleshooting](troubleshooting.md) when a gate blocks progress.
