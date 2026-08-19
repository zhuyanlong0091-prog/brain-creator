# Brain Creator Troubleshooting

Find the symptom first, run the smallest diagnostic, and apply the matching fix.

## Start With Doctor

Run from the business project:

```bash
npx brain-creator doctor
```

For a shareable report without secrets:

```bash
npx brain-creator doctor --json
```

`doctor` is read-only and redacts secret values.

## Find Your Symptom

| Symptom | Go to |
|---|---|
| `brain-creator` command not found | [CLI is not available](#cli-is-not-available) |
| Claude Code or Codex cannot see Brain Creator | [MCP tools are missing](#mcp-tools-are-missing) |
| Planner or Generator waits or times out | [Agent provider is unavailable](#agent-provider-is-unavailable) |
| Response says `needs_agent_execution` | [Host-agent task needs completion](#host-agent-task-needs-completion) |
| Browser is missing | [Playwright cannot start a browser](#playwright-cannot-start-a-browser) |
| Login, CAPTCHA, or 2FA blocks progress | [Authentication needs a checkpoint](#authentication-needs-a-checkpoint) |
| Feishu link cannot be read | [Feishu source cannot be loaded](#feishu-source-cannot-be-loaded) |
| Requirement baseline cannot be approved | [Requirement Eval blocks approval](#requirement-eval-blocks-approval) |
| Compilation needs exploration | [System evidence is incomplete](#system-evidence-is-incomplete) |
| A test failure looks like an automation problem | [Bug and Gap classification looks wrong](#bug-and-gap-classification-looks-wrong) |
| A new session does not know where to continue | [Session state needs recovery](#session-state-needs-recovery) |

## CLI Is Not Available

**Symptom**

```text
'brain-creator' is not recognized
```

**Cause**

The package is not installed in the current project, or a local binary was invoked without `npx`.

**Fix**

```bash
npm install --save-dev brain-creator
npx brain-creator --version
```

Use `npx brain-creator` for project-local installs. A global install is optional:

```bash
npm install -g brain-creator
brain-creator --version
```

## MCP Tools Are Missing

**Symptoms**

- The Agent says Brain Creator is unavailable.
- `/bc help` is not discovered.
- No Brain Creator MCP tools appear after installation.

**Fix**

```bash
npx brain-creator init --provider host-agent
npx brain-creator doctor
```

Then restart Claude Code or Codex. Confirm `.mcp.json` exists in the project and resolves `BRAIN_CREATOR_WORKSPACE` to the intended workspace.

For Codex plugin use:

```bash
npx brain-creator plugin install
codex plugin list
```

Do not register `plugins/brain-creator` directly as the marketplace root; use the installed package root through the consolidated command.

## Agent Provider Is Unavailable

**Symptoms**

- Bridge preflight fails.
- Planner, Generator, or Healer never starts.
- A subprocess reaches `BRAIN_CREATOR_AGENT_TIMEOUT_MS`.

**Diagnose**

```bash
npx brain-creator doctor
npx brain-creator config
```

**Fix**

- In a Codex plugin workflow, use `host-agent` to avoid launching a nested Codex or Claude process.
- In Claude Code subprocess workflows, select `claude` and ensure the configured command is on `PATH`.
- In Codex subprocess workflows, select `codex` and verify the CLI can run non-interactively.
- Use `disabled` only for preview-only workflows.

Rewrite the managed configuration intentionally:

```bash
npx brain-creator config write --provider host-agent
```

Restart the MCP host after the change.

## Host-Agent Task Needs Completion

**Symptom**

Brain Creator returns `needs_agent_execution` or a suite remains `waiting-for-agent`.

**Meaning**

This is not a missing bridge. In `host-agent` mode, the current Claude Code or Codex Agent must read the prepared task package, create the requested structured Planner, Generator, or Healer output, and submit it through the host-task Facade.

**Fix**

Ask:

```text
继续完成 Brain Creator 返回的 host-agent 任务，提交结果后恢复当前套件。
```

Do not switch to a low-level equivalent or create an unrelated script outside the task's allowed paths.

## Playwright Cannot Start A Browser

**Symptoms**

- Chromium executable is missing.
- System exploration or a suite fails before opening a page.

**Fix**

Install Playwright Chromium:

```bash
npx playwright install chromium
```

Or point Brain Creator to a supported local Chrome or Edge executable:

```text
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<absolute browser path>
```

Run `brain-creator doctor` again. A browser process being available does not prove that target-system authentication is valid.

## Authentication Needs A Checkpoint

**Symptoms**

- The target redirects to login.
- CAPTCHA, 2FA, recovery, or a password prompt appears.
- Existing storage state fails verification.

**Fix**

Ask Brain Creator to create an AuthCheckpoint. Complete login in an isolated headed browser, save storage state under `.brain-creator/auth/<systemId>/storage-state.json`, and verify it in a fresh read-only context before completing the checkpoint.

Never put passwords or one-time codes in generated tests, prompts, command arguments, or committed files.

## Feishu Source Cannot Be Loaded

**Symptoms**

- Wiki node resolution fails.
- The document is private or the app lacks permission.
- Complex blocks or attachments are skipped.

**Diagnose**

`doctor` reports whether direct OpenAPI credentials are complete. Both variables are required:

```text
BRAIN_CREATOR_FEISHU_APP_ID
BRAIN_CREATOR_FEISHU_APP_SECRET
```

**Fix**

- Correct the app permission or document sharing scope for direct OpenAPI.
- Without direct credentials, let the host Agent read the document with its Feishu capability and submit a normalized content package.
- Export DOCX, PDF, or Markdown when neither channel can read the source.

Unparsed tables, whiteboards, and attachments remain visible as discovered assets. Run `bc_prepare action=analyze-attachments`; Brain Creator creates a connector or attachment Gap only after recorded download/recognition retries fail or access cannot be restored.

## Requirement Eval Blocks Approval

**Symptoms**

- `nextAction` is `confirm_requirement_eval`.
- `nextAction` is `revise_blocked_requirement`.
- Baseline approval is rejected.

**Fix**

- Confirm a clarification or missing branch with a durable `confirmationNote` when the business owner supplies the answer.
- Revise the requirement source for a direct contradiction. A note cannot bypass this gate.
- Regenerate analysis after the source or confirmed knowledge changes.

Do not bind and execute a system simply to evade an unresolved requirement gate.

## System Evidence Is Incomplete

**Symptoms**

- Case compilation reports ambiguous navigation.
- A page, locator, input value, or state transition is missing.
- Multiple equal candidate paths are returned.

**Fix**

Refresh System Brain or submit focused page/training evidence from the host browser. Use safe exploration only for bounded tab, disclosure, and native-select interactions. Use training evidence for complex menus, form entry, and business workflow transitions.

Review the returned ExplorationTask through `bc_status` or its CompileRun. After adding evidence, preview and confirm `bc_prepare action=resolve-exploration-task`. Brain Creator recompiles automatically. Do not mark the task failed until the evidence attempt is exhausted; failure creates the final Gap.

Brain Creator should not choose one ambiguous path automatically.

## Bug And Gap Classification Looks Wrong

**Symptoms**

- A syntax, parser, locator, or missing-element failure appears as a product Bug.
- A verified expected/actual mismatch appears only as a technical Gap.

**Fix**

Review the execution diagnosis, retry budget, and evidence references. A product Bug requires an approved expectation and actual mismatch after controlled automation retry. Technical failures remain typed Gaps.

For historical assets, preview the legacy diagnosis review and obtain explicit confirmation before migrating any Bug or Gap. Never reclassify in bulk without evidence.

## Session State Needs Recovery

Ask:

```text
用 Brain Creator 恢复当前系统的会话，显示需求、鉴权、活动套件、Agent 任务、Bug、Gap、最近账本事件和下一步。
```

The Agent should use the session/status Facade instead of rebuilding state through many independent list calls. If the status disagrees with persisted suite evidence, review the RunLedger before retrying.

## Collect A Diagnostic Report

When reporting a problem, include:

```bash
npx brain-creator --version
npx brain-creator doctor --json
npx brain-creator config --json
```

Also include the failing command or natural-language request, the reported readiness or Gap category, and non-secret evidence paths. Do not include `.brain-creator/auth`, raw prompts containing secrets, access tokens, passwords, or storage-state content.

## Next Steps

- Return to the [Quickstart](getting-started.md).
- Check exact syntax in [CLI reference](cli-reference.md).
- Review provider configuration in [MCP installation](mcp-installation.md).
