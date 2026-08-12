# Storage and evidence

Brain Creator uses a local file repository. The default runtime store is `.brain-creator/store/`, a schema 17 sharded directory. The older `.brain-creator/local-assets.json` file remains a migration source and compatibility format; it is not the default write target for a new MCP context.

## Migration

On first startup, Brain Creator checks for `local-assets.json` when the schema 17 manifest is absent. It validates the JSON, creates a timestamped `local-assets.json.backup-*` file, writes the sharded store through temporary files and atomic renames, and then validates the new manifest. A failed migration does not delete the legacy source.

The main paths are:

```text
.brain-creator/store/
  manifest.json
  collections/<asset-collection>.json
  systems/<system-id>/system.json
  systems/<system-id>/assets.json
  knowledge/<knowledge-project-id>/requirements/<requirement-id>.json
  runs/<suite-run-id>/ledger.jsonl
  indexes/asset-index.json
```

Set `BRAIN_CREATOR_STORE_DIR` to use another shard directory. `BRAIN_CREATOR_DATA_FILE` remains useful as the legacy migration source. Do not edit either file or directory by hand while Brain Creator is running; use the Facade control plane.

## Doctor checks

Run:

```bash
npx brain-creator doctor
```

The report checks the manifest format and version, index presence, legacy files, and unfinished temporary or lock files. A warning means the store needs review but does not automatically invalidate a run. A failure means the manifest cannot be trusted and the store should be recovered from its backup before execution.

When the index is missing and no Suite or Agent task is active, rebuild it through the runtime control plane:

```json
{
  "target": "runtime",
  "operation": "rebuild-index"
}
```

## Evidence manifests

Completed document Suite runs write a manifest under:

```text
.brain-creator/artifacts/<system>/<requirement>/<suite-run>/manifest.json
```

Each present artifact records a workspace-relative path, byte count, SHA-256 hash, and source references. Missing evidence is recorded explicitly. Artifact paths outside the workspace are rejected.

## Export

Export a completed document Suite as a portable ZIP:

```bash
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip

## Structured execution evidence

Execution evidence now distinguishes process success from requirement assurance. Each evidence record may contain:

- `assertionContracts`: typed expectations with requirement references and required evidence.
- `reporterResult`: normalized Playwright JSON Reporter output.
- `assuranceLevel`: `strong`, `limited`, or `none`.
- `reporterPath`: the normalized reporter artifact when the runner returned structured JSON.

The static HTML report is written beside the Markdown evidence report. A process that exits with code 0 but has no structured reporter mapping remains `none`; it must not be presented as strong requirement validation. The report is an offline artifact, not a new Brain Creator UI entrypoint.

## Authentication secret handling

New auth ciphertext uses a random local key at `.brain-creator/secret.key`. Set `BRAIN_CREATOR_SECRET_KEY` for an externally managed key, or `BRAIN_CREATOR_SECRET_KEY_FILE` for a managed key file path. The environment variable has priority. Existing `enc:v1` values are decrypted and re-encrypted as `enc:v2` when the profile is read. Generated token/cookie seeds reference `BRAIN_CREATOR_AUTH_TOKEN` or `BRAIN_CREATOR_AUTH_COOKIE`; they never contain the credential value.
```

The archive contains `manifest.json` and available evidence files. It does not include the repository, secret material, browser storage state, or unrelated workspace files. Missing evidence is listed in the manifest instead of silently omitted.
