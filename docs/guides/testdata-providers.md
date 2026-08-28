# Testdata Providers

Brain Creator keeps test data planning and system operations separate. The Testdata Brain owns entity identity, dependencies, leases, source evidence, and cleanup state; a system-specific provider performs the actual lookup, creation, transition, verification, and cleanup.

## Provider Contract

An embedded integration can pass a provider when creating the MCP context:

```ts
const provider: TestDataProvider = {
  name: "orders-system",
  supports: (input) => input.systemId === "system-orders",
  lookup: async (input) => lookupOrder(input),
  create: async (input) => createOrder(input),
  transition: async (input) => transitionOrder(input),
  verify: async (input) => verifyOrder(input),
  cleanup: async (input) => deleteOrRestoreOrder(input)
};
```

Each method returns a stable reference, optional non-secret values, a typed lifecycle status, and source evidence. The provider must scope every operation to the requested `systemId`; cross-system references are rejected by Testdata Brain.

## Lifecycle

1. Brain Creator plans dependencies and prefers lookup/reuse.
2. The provider looks up or creates an entity only when the approved data plan allows it.
3. Transitions such as `submitted` or `approved` update the same entity reference.
4. Verification records evidence without replacing the requirement expectation.
5. Created data receives a lease and must be cleaned up with `delete-created` or `restore`.
6. Cleanup marks the entity released; the Suite/control plane records a typed Gap when cleanup fails.

The built-in provider is only a deterministic fixture. For a real system, implement the contract in its adapter or let the Host Agent perform the operation and submit the resulting reference and evidence. The CI/Suite control plane owns cleanup failure classification and Gap creation. Credentials never belong in provider results, generated tests, or reports.

## CI Runner

Use the consolidated CLI from cron, GitHub Actions, Jenkins, or another scheduler:

```bash
npx brain-creator runner run --owner ci --project knowledge-orders --lease-ms 300000 --json
```

Exit code `0` means no due run or completion, `1` means failed/blocked/partial, and `2` means a resumable wait. The lease is persisted in the repository so a second scheduler cannot claim an active run.

The repository includes a copyable [GitHub Actions example](../examples/github-actions/brain-creator-runner.yml). Configure a non-interactive Agent provider and its secrets in the target test repository before enabling the scheduled trigger; the example is documentation only and is not enabled by Brain Creator itself.
