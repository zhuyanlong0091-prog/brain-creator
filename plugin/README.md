# Brain Creator Plugin Draft

This folder defines the intended plugin installation contract for Brain Creator.

Current status:

- The supported install path is MCP connection with the `brain-creator-mcp` CLI.
- The future install path is a `/plugin` style package that registers this manifest, the Brain Creator Skill, and the MCP server automatically.
- After installation, run `brain-creator-doctor` before using `Use Skill("brain-creator")`.

The plugin must provide:

- `brain-creator-mcp` as the MCP server command.
- `brain-creator-doctor` as the preflight command.
- `skills/brain-creator/SKILL.md` as the main agent entrypoint.
- Default Claude bridge environment variables for Planner, Generator, and Healer dispatch.
