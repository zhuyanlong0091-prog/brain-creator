# Brain Creator 2.0.3 Release Notes

Brain Creator 2.0.3 is a patch release focused on shipping the Codex plugin installation path through the npm package.

## Highlights

- Added the `brain-creator-install-codex-plugin` npm bin so a business project can register the installed package as a Codex plugin marketplace and install `brain-creator@personal`.
- Packaged the repo-local Codex plugin assets under `plugins/brain-creator/` and `.agents/plugins/marketplace.json`.
- Extended package install smoke coverage to verify the installed Codex plugin helper is available.
- Extended Codex-native smoke coverage to verify plugin installation from both a source checkout and a packed npm install.
- Updated doctor output to point users to `npx brain-creator-install-codex-plugin`.

## Compatibility

- Existing MCP tools, facade tools, skills, and CLI commands remain compatible.
- The default Codex path remains host-agent friendly, avoiding unnecessary Claude or Codex subprocess waits.
- No data migration is required.

## Publish Checklist

- Run `npm test`.
- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Run `npm run verify:package-contents`.
- Run `npm run verify:package-install`.
- Run `npm run verify:codex-native-entry`.
- Validate the repo-local Codex plugin before npm publish.
- Run `npm run release:check` with npm auth available before publishing.
