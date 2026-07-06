# Brain Creator 2.0.2 Release Notes

Brain Creator 2.0.2 is a patch release focused on making the agent-native user entrypoints easier to operate from Claude Code, Codex, and MCP clients.

## Highlights

- Added clearer user entrypoint documentation so agents can map natural language requests to the facade tools without asking users to manually choose low-level `bc_*` tools.
- Added `statusMarkdown` to `bc_status` so a new session can return a concise, directly reusable system status report.
- Added `reviewMarkdown` to `bc_review` so suite, bug, gap, and artifact reviews all expose a consistent short report format.

## Compatibility

- No new MCP tools were added.
- Existing facade and internal tools remain compatible.
- Approval gates remain unchanged: document suite execution still requires preview and explicit confirmation, and plan execution still requires approval before generation.

## Publish Checklist

- Run `npm test`.
- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Run `npm run release:check`.
- Run `npm run verify:package-contents`.
- Run `npm run verify:package-install`.
- Validate the repo-local plugin before npm publish.
