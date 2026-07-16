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

Use this mode when connecting Brain Creator to a business project. The recommended setup is a project-local install, so each business project controls its own Brain Creator version.

Install Brain Creator into the business project:

```bash
npm install --save-dev brain-creator
```

Install the Brain Creator Skill, Playwright agent definitions, and a portable Playwright config when the project does not already have one:

```bash
npx brain-creator-install-assets
```

Create or update the business project's MCP config:

```bash
npx brain-creator-write-mcp-config
```

The command preserves existing MCP servers in `.mcp.json` and adds the `brain-creator` server. By default, it writes an MCP command that uses the project-local package through `npx`.

New configs set `BRAIN_CREATOR_TOOL_PROFILE=facade`, so the Agent sees only the high-level preparation, status, configuration, execution, review, and host-task submission tools. Set the profile to `full` only for compatibility, audit, or debugging.

Install the Codex plugin from the installed package:

```bash
npx brain-creator-install-codex-plugin
```

The command registers the package root as a Codex marketplace source, installs `brain-creator@personal`, and writes the current workspace `.mcp.json` with `BRAIN_CREATOR_AGENT_PROVIDER=host-agent`. The plugin commands are equivalent to `codex plugin marketplace add node_modules/brain-creator` followed by `codex plugin add brain-creator@personal`; the MCP rewrite prevents Codex from accidentally selecting a local Claude subprocess.

If the target runtime is already known, choose it explicitly:

```bash
npx brain-creator-write-mcp-config --provider claude
npx brain-creator-write-mcp-config --provider codex
npx brain-creator-write-mcp-config --provider host-agent
```

Supported values are `auto`, `claude`, `codex`, `host-agent`, and `disabled`. Invalid provider names fail immediately.

Then configure Claude Code or Codex MCP in the business project:

```json
{
  "mcpServers": {
    "brain-creator": {
      "command": "npx",
      "args": ["brain-creator-mcp"],
      "env": {
        "BRAIN_CREATOR_WORKSPACE": ".",
        "BRAIN_CREATOR_TOOL_PROFILE": "facade",
        "BRAIN_CREATOR_AGENT_PROVIDER": "auto",
        "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

`BRAIN_CREATOR_AGENT_PROVIDER=auto` lets Brain Creator pick an available bridge. Use `claude` in Claude Code projects, `codex` in Codex subprocess projects, `host-agent` when the current Codex/Claude agent should execute prepared task packages, or `disabled` for preview-only workflows. For an explicit Codex subprocess bridge:

```json
{
  "BRAIN_CREATOR_AGENT_PROVIDER": "codex",
  "BRAIN_CREATOR_CODEX_COMMAND": "codex",
  "BRAIN_CREATOR_CODEX_ARGS": "[\"exec\",\"--json\",\"--ephemeral\",\"--sandbox\",\"workspace-write\",\"--ask-for-approval\",\"never\",\"-C\",\"{cwd}\",\"-\"]",
  "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
}
```

For a Codex plugin style workflow that should not start another subprocess, use host-agent mode:

```json
{
  "BRAIN_CREATOR_TOOL_PROFILE": "facade",
  "BRAIN_CREATOR_AGENT_PROVIDER": "host-agent",
  "BRAIN_CREATOR_AGENT_TIMEOUT_MS": "120000"
}
```

In host-agent mode, `bc_generate_plan`, approved chains, and confirmed document suites may return `needs_agent_execution`. The current Agent reads `input.prompt.md` and `input.context.json`, creates the requested Planner/Generator/Healer output, then calls `bc_submit_agent_output`. Generator and Healer outputs import `test` and `expect` from the task's `--seed` file so any storage-state authentication is preserved. Planner submission returns `plan_ready`; Generator submission runs Playwright; document suites return one task at a time until `completed`, `failed`, or `blocked`. Treat `waiting-for-agent` as work for the current Agent, not as a missing bridge.

Manual browser authentication uses workspace-local runtime evidence: save Playwright storage state under `.brain-creator/auth/<systemId>/storage-state.json`, reference it through an encrypted `storageStatePath` in a `script` AuthProfile, and prove it in a fresh read-only browser context before completing the auth checkpoint. `.brain-creator/` and `.playwright-cli/` must remain ignored and must not be copied into package artifacts.

Run the preflight before the first Brain Creator workflow:

```bash
npx brain-creator-doctor
```

Doctor prints the resolved provider, real browser availability, and recommended action, so users can tell whether Brain Creator will use a Claude subprocess, Codex subprocess, host-agent task handoff, or preview-only disabled mode before running a confirmed workflow. If neither a Playwright browser nor system Chrome/Edge is available, install Chromium or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` before running a suite.

Doctor also reports the resolved knowledge directory, tool profile, and Feishu connector readiness. A partial Feishu credential configuration fails immediately.

Requirement knowledge defaults to `.brain-creator/knowledge`. To use an external Obsidian vault, set `BRAIN_CREATOR_KNOWLEDGE_DIR`. For direct Feishu Wiki/Doc reading, set both `BRAIN_CREATOR_FEISHU_APP_ID` and `BRAIN_CREATOR_FEISHU_APP_SECRET`; otherwise Brain Creator requests a host Agent content package.

If you prefer a global install, use:

```bash
npm install -g brain-creator
brain-creator-install-assets
brain-creator-write-mcp-config --global
brain-creator-install-codex-plugin
brain-creator-doctor
```

In global mode, `.mcp.json` uses `"command": "brain-creator-mcp"` instead of `npx`.

Validate local package installation from this repository:

```bash
npm run verify:package-contents
npm run verify:package-install
```

`verify:package-install` uses the packed artifact in a temporary business project. It starts the installed MCP server over stdio, calls `/bc help`, prepares a `host-agent` task, submits its output, and verifies the persisted AgentRun without changing the source repository data file.

After MCP is connected, start in Claude Code or Codex with:

```text
Use Brain Creator to analyze this requirement document or Feishu link, generate test design and data, and wait for my approval.
```

## repo-local plugin installation mode

The repo-local Codex plugin is available under `plugins/brain-creator` and is registered in `.agents/plugins/marketplace.json`.

It provides:

- `.codex-plugin/plugin.json` for Codex `/plugin` discovery.
- `.mcp.json` that registers the `brain-creator` MCP server with `npx brain-creator-mcp` and defaults to `BRAIN_CREATOR_AGENT_PROVIDER=host-agent`.
- `skills/` containing the Brain Creator workflow entrypoint and supporting skill guidance.
- Three Codex-compatible starter prompts: shortcut help plus status, system connection, and test-document preview.
- Remaining suite, bug/gap, and doctor workflows are discoverable through `/bc help`.

Read-only status, asset, and review tools declare MCP `readOnlyHint` annotations. Write operations still require host approval, and the Skill instructs the Agent not to retry a cancelled facade operation through lower-level tools.

Install the repo-local plugin from the repository root. The marketplace source is the repository root because Codex discovers `.agents/plugins/marketplace.json` under it:

```bash
cd /path/to/brain-creator-mvp
codex plugin marketplace add .
codex plugin add brain-creator@personal
codex plugin list
```

After installing Brain Creator from npm in a business project, use the installed package root as the marketplace source:

```bash
cd /path/to/business-project
npm install --save-dev brain-creator
npx brain-creator-install-codex-plugin
codex plugin list
```

Do not pass `plugins/`, `plugins/brain-creator`, or `.agents/plugins/marketplace.json` directly. They are useful implementation paths, but they are not the marketplace root accepted by `codex plugin marketplace add`.

To validate the local plugin:

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
```

To validate the full Codex-native entry path from this repository:

```bash
npm run verify:codex-native-entry
npm run verify:host-agent-document-suite
```

These local smokes check that the Codex plugin exposes `/bc help`, defaults to `host-agent`, doctor explains the handoff, an approved case can advance through `bc_submit_agent_output`, and a confirmed two-case document suite loads storage-state authentication before executing in order against a protected real local page with Chromium while persisting SuiteRun and ChainRun evidence. To check only the Codex plugin marketplace installation path:

```bash
npm run verify:codex-plugin-install
```

When installed from the repo-local marketplace, Brain Creator still expects the npm package to be installed in the business project:

```bash
npx brain-creator-mcp
npx brain-creator-doctor
npx brain-creator-install-assets
npx brain-creator-write-mcp-config
npx brain-creator-install-codex-plugin
```

If those commands are not available yet, use MCP CLI connection mode first, or install the package tarball produced by `npm pack`.
