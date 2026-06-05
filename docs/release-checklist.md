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

## Not Yet Covered

- Marketplace `/plugin` publishing.
- Automated npm publish from CI.
- GitHub release notes automation.
