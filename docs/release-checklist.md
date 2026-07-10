# Brain Creator Release Checklist

Brain Creator can be published to npm only after the release readiness report is ready and the package smoke checks pass.

## Current Publish Gates

- `package.json` must not contain `private:true`.
- `package.json` must declare the confirmed license.
- `LICENSE` must be included in the package.
- npm authentication must be configured on the publishing machine.

Run the release readiness report:

```bash
npm run release:check
```

Run package gates:

```bash
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run verify:codex-plugin-install
```

## Required Before npm publish

- Confirm final package name: `brain-creator`.
- Confirm and document license: `MIT`.
- Log in with the npm publishing account.
- Run `npm run release:check` and confirm it reports ready.
- Run `npm run verify:package-contents`.
- Run `npm run verify:package-install`.
- Run `npm run verify:codex-native-entry`.
- Run `npm run verify:codex-plugin-install`.
- Run the full project verification suite.
- If npm requires two-factor authentication, publish with a current OTP:

```bash
npm publish --access public --otp=<current-2fa-code>
```

Alternatively, publish with a granular npm access token that is allowed to bypass 2FA for automation.

## `/plugin` Publishing

The repo-local Codex plugin is now covered by:

- `plugins/brain-creator/.codex-plugin/plugin.json`
- `plugins/brain-creator/.mcp.json`
- `plugins/brain-creator/skills/`
- `.agents/plugins/marketplace.json`

Validate it before sharing:

```bash
py <plugin-creator-skill>/scripts/validate_plugin.py plugins/brain-creator
npm run verify:codex-plugin-install
npm run verify:codex-native-entry
```

This is a repo-local plugin publish path. A broader public marketplace submission would still need the target marketplace process and permissions.

## Not Yet Covered

- Automated npm publish from CI.
- GitHub release notes automation.
