# Brain Creator Plugin MCP Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brain Creator usable from Claude Code/Codex as an installable MCP capability instead of requiring users to manually point MCP at the source repository.

**Architecture:** Split the work into two delivery slices. First, add a packaged CLI entrypoint so `brain-creator-mcp` can run outside the source checkout while storing assets in the caller workspace. Second, add plugin-style installation assets, doctor checks, and documentation so users can connect Brain Creator through MCP/plugin workflows with clear preflight feedback.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Vitest, Claude Code project settings, GitHub PR workflow.

---

## Current Problem

Brain Creator currently starts MCP through the source repository:

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "cwd": "F:\\Projects\\Test_Execution"
}
```

That means every Claude Code/Codex user must know where the Brain Creator repository lives, install dependencies there, and keep MCP config tied to that path. This is acceptable for development, but not acceptable for product usage.

## Target User Experience

After this plan, a user should be able to use Brain Creator in a business project with one of these shapes:

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

or, before a published package exists:

```json
{
  "mcpServers": {
    "brain-creator": {
      "command": "npx",
      "args": ["brain-creator-mcp"],
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

## File Map

- Modify `package.json`: add build scripts, CLI bin entries, and keep development MCP command available.
- Modify `tsconfig.json`: ensure compiled files are emitted to `dist` with executable-compatible imports.
- Create `src/cli/brainCreatorMcp.ts`: production CLI entrypoint for MCP server startup.
- Create `src/cli/doctor.ts`: preflight checker for Node, workspace, Claude command, bridge env, and Playwright agent definitions.
- Modify `src/mcp/server.ts`: allow explicit workspace/data path configuration without assuming repository cwd.
- Modify `src/mcp/handlers.ts`: centralize workspace/data path resolution.
- Create `src/shared/workspace.ts`: resolve `BRAIN_CREATOR_WORKSPACE`, caller cwd, and `.brain-creator/local-assets.json`.
- Create `src/cli/doctor.test.ts`: tests for preflight success and actionable failures.
- Modify `src/mcp/configuration.test.ts`: lock CLI-style MCP config expectations.
- Create `docs/mcp-installation.md`: user-facing Claude Code/Codex MCP connection guide.
- Modify `README.md`: describe three modes: development from source, MCP connection, future plugin installation.
- Create `plugin/manifest.json`: draft plugin manifest for future `/plugin` installation packaging.
- Create `plugin/README.md`: explain current plugin packaging status and install contract.

---

## Phase 1: CLI-Based MCP Decoupling

### Task 1: Add Workspace Resolution

**Files:**
- Create: `src/shared/workspace.ts`
- Test: `src/shared/workspace.test.ts`

- [ ] Write failing tests for workspace resolution:
  - when `BRAIN_CREATOR_WORKSPACE` is set, use that path
  - when it is unset, use `process.cwd()`
  - default data file is `<workspace>/.brain-creator/local-assets.json`
  - explicit `BRAIN_CREATOR_DATA_FILE` overrides default

- [ ] Implement `resolveBrainCreatorWorkspace()` and `resolveBrainCreatorDataFile()`.

- [ ] Run:

```powershell
npm test -- src/shared/workspace.test.ts
```

Expected: all workspace tests pass.

- [ ] Commit:

```powershell
git add src/shared/workspace.ts src/shared/workspace.test.ts
git commit -m "feat: resolve brain creator workspace"
```

### Task 2: Wire Workspace Into MCP Context

**Files:**
- Modify: `src/mcp/handlers.ts`
- Test: `src/mcp/handlers.test.ts`

- [ ] Write failing test proving `createBrainCreatorMcpContext()` uses `BRAIN_CREATOR_WORKSPACE` for `workDir`.

- [ ] Write failing test proving `BRAIN_CREATOR_DATA_FILE` changes the repository file path.

- [ ] Update `createBrainCreatorMcpContext()` to call workspace helpers when explicit inputs are not provided.

- [ ] Run:

```powershell
npm test -- src/mcp/handlers.test.ts
```

Expected: existing tests plus new workspace tests pass.

- [ ] Commit:

```powershell
git add src/mcp/handlers.ts src/mcp/handlers.test.ts
git commit -m "feat: make mcp context workspace-aware"
```

### Task 3: Add Production MCP CLI Entrypoint

**Files:**
- Create: `src/cli/brainCreatorMcp.ts`
- Modify: `src/mcp/server.ts`
- Modify: `package.json`
- Test: `src/mcp/configuration.test.ts`

- [ ] Write failing test that `package.json` exposes:

```json
{
  "bin": {
    "brain-creator-mcp": "dist/cli/brainCreatorMcp.js"
  }
}
```

- [ ] Add `src/cli/brainCreatorMcp.ts` that imports and starts the MCP server.

- [ ] Keep source development command as `dev:mcp`.

- [ ] Add production build/start scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "mcp": "node dist/cli/brainCreatorMcp.js",
    "dev:mcp": "node --loader ts-node/esm src/mcp/server.ts"
  }
}
```

- [ ] Run:

```powershell
npm test -- src/mcp/configuration.test.ts
npm run build
```

Expected: config tests pass and `dist/cli/brainCreatorMcp.js` exists.

- [ ] Commit:

```powershell
git add package.json package-lock.json src/cli/brainCreatorMcp.ts src/mcp/server.ts src/mcp/configuration.test.ts
git commit -m "feat: add brain creator mcp cli"
```

### Task 4: Verify CLI Can Start Outside Source Assumption

**Files:**
- Create: `src/cli/brainCreatorMcp.test.ts`
- Modify: `package.json` if needed

- [ ] Write a smoke test that starts the built CLI with a temporary `BRAIN_CREATOR_WORKSPACE`.

- [ ] Assert the process starts without requiring `cwd` to be the repository root.

- [ ] Run:

```powershell
npm test -- src/cli/brainCreatorMcp.test.ts
npm run build
```

Expected: CLI smoke test passes.

- [ ] Commit:

```powershell
git add src/cli/brainCreatorMcp.test.ts package.json package-lock.json
git commit -m "test: verify mcp cli startup"
```

---

## Phase 2: Preflight And Installation UX

### Task 5: Add Doctor Command

**Files:**
- Create: `src/cli/doctor.ts`
- Create: `src/cli/doctor.test.ts`
- Modify: `package.json`

- [ ] Write failing tests for `brain-creator-doctor`:
  - reports workspace path
  - reports data file path
  - reports whether `claude` command is available
  - reports whether bridge env is configured
  - reports whether Playwright agent definitions exist

- [ ] Add bin entry:

```json
{
  "bin": {
    "brain-creator-mcp": "dist/cli/brainCreatorMcp.js",
    "brain-creator-doctor": "dist/cli/doctor.js"
  }
}
```

- [ ] Implement doctor output with actionable remediation text.

- [ ] Run:

```powershell
npm test -- src/cli/doctor.test.ts
npm run build
```

Expected: doctor tests pass and command builds.

- [ ] Commit:

```powershell
git add src/cli/doctor.ts src/cli/doctor.test.ts package.json package-lock.json
git commit -m "feat: add brain creator doctor"
```

### Task 6: Update MCP Config To CLI Shape

**Files:**
- Modify: `.mcp.json`
- Modify: `.claude/settings.json`
- Modify: `src/mcp/configuration.test.ts`

- [ ] Write failing config test expecting Brain Creator to use CLI-style startup rather than `npm run mcp` from source.

- [ ] Update `.mcp.json`:

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

- [ ] Update `.claude/settings.json` with the same env contract.

- [ ] Run:

```powershell
npm test -- src/mcp/configuration.test.ts
```

Expected: config tests pass.

- [ ] Commit:

```powershell
git add .mcp.json .claude/settings.json src/mcp/configuration.test.ts
git commit -m "chore: use cli mcp startup config"
```

### Task 7: Add Plugin Manifest Draft

**Files:**
- Create: `plugin/manifest.json`
- Create: `plugin/README.md`
- Test: `src/mcp/configuration.test.ts`

- [ ] Write failing test that plugin manifest includes:
  - plugin name `brain-creator`
  - MCP server command
  - Brain Creator skill entrypoint
  - bridge env contract
  - doctor command

- [ ] Add `plugin/manifest.json` as a draft contract, not yet a marketplace package.

- [ ] Add `plugin/README.md` explaining:
  - current install path is MCP connection
  - future path is `/plugin` installation
  - users should run `brain-creator-doctor` after installation

- [ ] Run:

```powershell
npm test -- src/mcp/configuration.test.ts
```

Expected: plugin manifest contract test passes.

- [ ] Commit:

```powershell
git add plugin/manifest.json plugin/README.md src/mcp/configuration.test.ts
git commit -m "docs: add brain creator plugin manifest draft"
```

### Task 8: Document User Installation Paths

**Files:**
- Create: `docs/mcp-installation.md`
- Modify: `README.md`
- Modify: `docs/agent-usage.md`
- Test: `docs/agent-usage.test.ts`

- [ ] Write failing documentation test that README and agent guide include:
  - source development mode
  - MCP CLI connection mode
  - future plugin installation mode
  - doctor command
  - `Use Skill("brain-creator")` entrypoint

- [ ] Add `docs/mcp-installation.md` with copyable Claude Code/Codex config.

- [ ] Update bilingual README with a short install section in Chinese and English.

- [ ] Update `docs/agent-usage.md` to explain when to use source checkout vs installed MCP.

- [ ] Run:

```powershell
npm test -- docs/agent-usage.test.ts
```

Expected: documentation tests pass.

- [ ] Commit:

```powershell
git add README.md docs/agent-usage.md docs/mcp-installation.md docs/agent-usage.test.ts
git commit -m "docs: explain mcp installation paths"
```

---

## Phase 3: End-To-End Verification And Release

### Task 9: Add Fresh Directory Verification

**Files:**
- Create: `scripts/verifyInstalledMcpSmoke.ts`
- Modify: `package.json`

- [ ] Add script:

```json
{
  "scripts": {
    "verify:installed-mcp": "node --loader ts-node/esm scripts/verifyInstalledMcpSmoke.ts"
  }
}
```

- [ ] Smoke should:
  - create a temporary business workspace
  - point `BRAIN_CREATOR_WORKSPACE` to it
  - start Brain Creator MCP CLI
  - call a lightweight MCP flow or verify server startup
  - confirm assets are written under the temporary workspace, not the source repository

- [ ] Run:

```powershell
npm run build
npm run verify:installed-mcp
```

Expected: smoke passes and no new data is written to the source repo `.brain-creator` directory.

- [ ] Commit:

```powershell
git add scripts/verifyInstalledMcpSmoke.ts package.json package-lock.json
git commit -m "test: add installed mcp smoke"
```

### Task 10: Final Verification And PR

**Files:**
- No new implementation files unless verification exposes defects.

- [ ] Run full verification:

```powershell
npm test
npm run build
npx tsc --noEmit
npm run verify:installed-mcp
```

- [ ] If Claude bridge is available, also run:

```powershell
npm run verify:live-claude-skill-workflow
```

- [ ] Confirm `git status --short` contains only intentional changes.

- [ ] Push branch and create a draft PR with:
  - what changed
  - why source-directory coupling was removed
  - how to configure Claude Code/Codex
  - verification results
  - known remaining plugin publishing limits

---

## Risks And Controls

- **Risk:** CLI startup works in development but fails on Windows global installs.
  - **Control:** test `.cmd`/PowerShell behavior and use Node-compatible bin entries.

- **Risk:** Generated assets land in the Brain Creator source repository instead of the caller project.
  - **Control:** require `BRAIN_CREATOR_WORKSPACE` tests and installed smoke verification.

- **Risk:** Existing local assets become hard to find.
  - **Control:** keep backward-compatible default when running from repository; document `BRAIN_CREATOR_DATA_FILE`.

- **Risk:** Users think plugin installation is complete before package publishing exists.
  - **Control:** call `plugin/manifest.json` a draft until a real plugin packaging path is verified.

- **Risk:** Claude bridge still fails after MCP starts.
  - **Control:** `brain-creator-doctor` must report bridge readiness before plan/chain execution.

## Completion Criteria

- `brain-creator-mcp` can run without requiring MCP config to point at the source repository.
- Brain Creator stores runtime data in the caller workspace by default.
- Claude Code/Codex MCP config can be copied into any business project.
- `brain-creator-doctor` gives clear preflight status before the user starts the Brain Creator workflow.
- Documentation explains source, MCP, and future plugin usage paths.
- Full test/build verification passes.
