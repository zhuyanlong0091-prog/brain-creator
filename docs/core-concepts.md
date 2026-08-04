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

## Requirement Brain

Requirement Brain answers: **What should the business system do, and where did that expectation come from?**

It contains:

- `KnowledgeProject`: a requirement knowledge boundary independent of a runtime system.
- `RequirementSource`: a local file, Feishu document, Web page, or host-submitted content package.
- `RequirementSet`: one version of the requirement and its impact scope.
- `KnowledgeNode` and `KnowledgeEdge`: modules, actors, objects, fields, rules, workflows, states, permissions, integrations, data constraints, terms, and requirement clauses.
- `TestIntent`: a reviewable testing objective linked to source clauses.
- `TestDataProfile`: the data strategy needed to exercise an intent.

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

## Case Compiler

The compiler converts an approved `TestIntent` into an `ExecutableCase` for one bound `systemId`.

It may add an implicit navigation or state action only when the evidence supports one unique, high-confidence path. Ambiguous routes, missing values, missing locators, and unreachable pages block compilation and create a Gap.

This rule prevents an Agent from silently inventing the kind of hidden action a human tester might infer from context.

## Test Data

`TestDataProfile` describes what data is needed. `TestDataPlan` orders dependencies and chooses among fixed, generated, unique, existing-reference, runtime-captured, and secret-reference strategies.

`TestDataLease` records what was reused or created, its evidence, and its cleanup state. Reuse is the default. Creating data requires explicit authorization and a cleanup policy.

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
