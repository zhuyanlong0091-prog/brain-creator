# Brain Creator Codex Plugin

This is the repo-local Codex `/plugin` package for Brain Creator.

It registers:

- Brain Creator Skill files in `skills/`.
- The `brain-creator` MCP server through `.mcp.json`.
- Starter prompts for connecting a business system, generating a reviewed test plan, and running `brain-creator-doctor`.

Validate before sharing:

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
```

The plugin expects these commands to be available on PATH:

```bash
brain-creator-mcp
brain-creator-doctor
brain-creator-install-assets
brain-creator-write-mcp-config
```
