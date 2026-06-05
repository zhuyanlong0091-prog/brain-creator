# Brain Creator Release Checklist

Brain Creator is not ready for public npm publish until every blocker below is resolved.

## Current Publish Blockers

- `private:true` is still set in `package.json`.
- `license` is not set in `package.json`.
- npm authentication is not configured on this machine.

Run the release readiness report:

```bash
npm run release:check
```

Run package gates:

```bash
npm run verify:package-contents
npm run verify:package-install
```

## Required Before npm publish

- Confirm final package name: `brain-creator` or a scoped package.
- Confirm and document license.
- Log in with the npm publishing account.
- Run `npm run release:check` and confirm it reports ready.
- Run `npm run verify:package-contents`.
- Run `npm run verify:package-install`.
- Run the full project verification suite.

## `/plugin` Publishing

The repo-local Codex plugin is now covered by:

- `plugins/brain-creator/.codex-plugin/plugin.json`
- `plugins/brain-creator/.mcp.json`
- `plugins/brain-creator/skills/`
- `.agents/plugins/marketplace.json`

Validate it before sharing:

```bash
py C:\Users\28917\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py plugins\brain-creator
```

This is a repo-local plugin publish path. A broader public marketplace submission would still need the target marketplace process and permissions.

## Not Yet Covered

- Automated npm publish from CI.
- GitHub release notes automation.
