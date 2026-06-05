# Brain Creator Plugin Contract

This folder defines the npm-package plugin contract for Brain Creator. It is included in the npm package allowlist so package consumers can inspect the intended integration shape.

Current status:

- The supported install path is MCP connection with the `brain-creator-mcp` CLI.
- The repo-local Codex `/plugin` implementation now lives in `plugins/brain-creator`.
- `.agents/plugins/marketplace.json` registers that local plugin for Codex marketplace discovery.
- After installation, run `brain-creator-doctor` before using `Use Skill("brain-creator")`.

The plugin must provide:

- `brain-creator-mcp` as the MCP server command.
- `brain-creator-doctor` as the preflight command.
- `skills/brain-creator/SKILL.md` as the main agent entrypoint.
- Default Claude bridge environment variables for Planner, Generator, and Healer dispatch.
