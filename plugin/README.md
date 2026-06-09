# Brain Creator Plugin Contract

This folder defines the npm-package plugin contract for Brain Creator. It is included in the npm package allowlist so package consumers can inspect the intended integration shape.

Current status:

- The supported install path is MCP connection with the npm package, using `npx brain-creator-mcp` for project-local installs.
- The repo-local Codex `/plugin` implementation now lives in `plugins/brain-creator`.
- `.agents/plugins/marketplace.json` registers that local plugin for Codex marketplace discovery.
- After installation, run `npx brain-creator-doctor` before asking a natural request such as `Use Brain Creator to connect this system`.

The plugin must provide:

- `npx brain-creator-mcp` as the default project-local MCP server command.
- `npx brain-creator-doctor` as the preflight command.
- `skills/brain-creator/SKILL.md` as the main agent entrypoint.
- Default Claude bridge environment variables for Planner, Generator, and Healer dispatch.
