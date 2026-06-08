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

For project-local npm installs, run these commands with `npx`:

```bash
npx brain-creator-mcp
npx brain-creator-doctor
npx brain-creator-install-assets
npx brain-creator-write-mcp-config
```

For global npm installs, the same commands can be run without `npx`.
