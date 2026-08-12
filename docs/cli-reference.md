# Brain Creator CLI Reference

Use the consolidated `brain-creator` command to install, inspect, diagnose, and start Brain Creator.

## Command Summary

| Command | Description | Example |
|---|---|---|
| `brain-creator init` | Install project assets and create or update MCP configuration | `npx brain-creator init --provider host-agent` |
| `brain-creator doctor` | Check provider, browser, connector, knowledge directory, and installed assets | `npx brain-creator doctor` |
| `brain-creator config` | Print the redacted effective MCP configuration | `npx brain-creator config --json` |
| `brain-creator config write` | Intentionally write MCP configuration | `npx brain-creator config write --provider codex` |
| `brain-creator plugin install` | Install the Codex plugin and host-agent configuration | `npx brain-creator plugin install` |
| `brain-creator export` | Export a completed Suite run with its evidence manifest | `npx brain-creator export --suite <id> --output exports/suite.zip` |
| `brain-creator mcp` | Start the MCP server over stdio | `npx brain-creator mcp` |
| `brain-creator help legacy` | List standalone compatibility executables | `npx brain-creator help legacy` |
| `brain-creator --version` | Print the installed version | `npx brain-creator --version` |
| `brain-creator --help` | Print top-level help | `npx brain-creator --help` |

Run commands from the business project unless the option says otherwise.

## `brain-creator init`

```text
brain-creator init [--provider <provider>] [--with-plugin] [--target <path>] [--global] [--force] [--json]
```

Installs the Brain Creator Skill, Playwright Agent definitions, and MCP configuration. Existing custom assets are skipped unless `--force` is used.

| Option | Description |
|---|---|
| `--provider <provider>` | Set `auto`, `claude`, `codex`, `host-agent`, or `disabled` |
| `--with-plugin` | Install the Codex plugin during initialization |
| `--target <path>` | Initialize another project directory |
| `--global` | Write a global-style configuration using the global executable |
| `--force` | Replace managed assets that would otherwise be skipped |
| `--json` | Return machine-readable output |

Recommended Codex project setup:

```bash
npx brain-creator init --provider host-agent --with-plugin
```

## `brain-creator doctor`

```text
brain-creator doctor [--json]
```

The command is read-only. It reports readiness and remediation for:

- Agent provider and bridge command;
- provider timeout and arguments;
- Playwright or local browser availability;
- Facade or full MCP tool profile;
- knowledge directory;
- Feishu connector configuration;
- installed project assets.

Use JSON output in CI or diagnostics:

```bash
npx brain-creator doctor --json
```

## `brain-creator config`

```text
brain-creator config [show] [--target <path>] [--json]
```

Shows the effective configuration with secrets redacted. It does not modify `.mcp.json`.

```bash
npx brain-creator config
npx brain-creator config --json
```

## `brain-creator config write`

```text
brain-creator config write [--provider <provider>] [--global] [--target <path>] [--json]
```

Writes an MCP configuration intentionally. Use this command when switching the Agent execution model.

```bash
npx brain-creator config write --provider claude
npx brain-creator config write --provider codex
npx brain-creator config write --provider host-agent
```

## `brain-creator plugin install`

```text
brain-creator plugin install [--target <path>] [--package-root <path>] [--json]
```

Registers the installed package as a Codex plugin marketplace, installs `brain-creator@personal`, and writes host-agent MCP configuration for the target project.

```bash
npx brain-creator plugin install
codex plugin list
```

## `brain-creator mcp`

Starts the MCP server over stdio. MCP hosts normally run this command from `.mcp.json`; do not start a second interactive copy unless you are debugging transport startup.

```bash
npx brain-creator mcp
```

## `brain-creator export`

```text
brain-creator export --suite <suite-run-id> [--target <path>] [--output <path>] [--json]
```

Exports a completed document Suite as a portable ZIP containing `manifest.json` and available evidence. Missing files are listed in the manifest. The repository, secrets, browser storage state, and unrelated workspace files are excluded.

## Compatibility Commands

Earlier package versions exposed standalone executables:

- `brain-creator-mcp`
- `brain-creator-doctor`
- `brain-creator-install-assets`
- `brain-creator-write-mcp-config`
- `brain-creator-install-codex-plugin`

They remain available for existing automation. New documentation and examples use the consolidated CLI.

## Environment Variables

| Variable | Purpose | Typical value |
|---|---|---|
| `BRAIN_CREATOR_WORKSPACE` | Runtime workspace root | `.` |
| `BRAIN_CREATOR_TOOL_PROFILE` | MCP surface | `facade` |
| `BRAIN_CREATOR_AGENT_PROVIDER` | Agent execution model | `host-agent` |
| `BRAIN_CREATOR_AGENT_TIMEOUT_MS` | Agent call timeout | `120000` |
| `BRAIN_CREATOR_KNOWLEDGE_DIR` | External knowledge root | `<absolute-knowledge-path>` |
| `BRAIN_CREATOR_STORE_DIR` | Schema 17 sharded runtime store | `<workspace>/.brain-creator/store` |
| `BRAIN_CREATOR_FEISHU_APP_ID` | Feishu OpenAPI app ID | environment secret reference |
| `BRAIN_CREATOR_FEISHU_APP_SECRET` | Feishu OpenAPI app secret | environment secret reference |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Explicit browser executable | local Chrome/Edge path |

Claude and Codex subprocess providers also support provider-specific command and argument variables. Use `brain-creator config write` to generate a valid starting configuration instead of composing them manually.

## Exit And Error Behavior

- Invalid commands print usage and return a non-zero exit code.
- `doctor` reports failed checks with remediation; `--json` preserves structured status.
- Configuration display redacts secret values.
- `mcp` writes protocol messages to stdio and operational diagnostics to stderr.

For symptom-based fixes, see [Troubleshooting](troubleshooting.md).
