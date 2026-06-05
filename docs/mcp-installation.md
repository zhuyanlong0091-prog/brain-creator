# Brain Creator MCP Installation

Brain Creator can be used from Claude Code or Codex without starting from a Web UI. The recommended product path is MCP CLI connection mode.

## source checkout mode

Use this mode when developing Brain Creator itself.

```bash
git clone https://github.com/zhuyanlong0091-prog/brain-creator-mvp.git
cd brain-creator-mvp
npm install
npm test
npm run dev:mcp
```

This mode still depends on the source checkout and is mainly for contributors.

## MCP CLI connection mode

Use this mode when connecting Brain Creator to a business project.

Build or install Brain Creator so these commands are available:

```bash
brain-creator-mcp
brain-creator-doctor
brain-creator-install-assets
```

Install the Brain Creator Skill and Playwright agent definitions into the business project:

```bash
brain-creator-install-assets
```

Create or update the business project's MCP config:

```bash
brain-creator-write-mcp-config
```

The command preserves existing MCP servers in `.mcp.json` and adds the `brain-creator` server.

Then configure Claude Code or Codex MCP in the business project:

```json
{
  "mcpServers": {
    "brain-creator": {
      "command": "brain-creator-mcp",
      "env": {
        "BRAIN_CREATOR_WORKSPACE": ".",
        "BRAIN_CREATOR_AGENT_COMMAND": "claude",
        "BRAIN_CREATOR_AGENT_ARGS": "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

Run the preflight before the first Brain Creator workflow:

```bash
brain-creator-doctor
```

Validate local package installation from this repository:

```bash
npm run verify:package-contents
npm run verify:package-install
```

After MCP is connected, start in Claude Code or Codex with:

```text
Use Skill("brain-creator"). Connect this business system, generate a test plan, wait for my approval, then run the chain.
```

## future plugin installation mode

The future plugin installation mode should register the Brain Creator Skill, MCP server, bridge environment, and doctor command automatically. The draft contract is in `plugin/manifest.json`.

Until that package is published and verified, use MCP CLI connection mode.
