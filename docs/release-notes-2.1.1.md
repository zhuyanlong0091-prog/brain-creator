# Brain Creator 2.1.1

Brain Creator 2.1.1 makes the complete documentation available to npm users and introduces a searchable bilingual documentation site.

## Documentation

- Added a complete Simplified Chinese user documentation directory under `docs/zh-CN/`.
- Added bilingual VitePress navigation and local fuzzy full-text search.
- Added task-oriented home, quickstart, concepts, requirement-to-test, Agent usage, CLI, MCP, troubleshooting, and release pages.
- Added a generated Brain Creator documentation mark and a restrained technical documentation theme.
- Corrected historical repository URLs from `brain-creator-mvp` to `brain-creator`.

## Distribution

- All public Markdown documentation is included in the npm tarball.
- npm metadata points to the searchable GitHub Pages documentation site.
- GitHub Actions builds documentation on pull requests and deploys it from `main`.

## Verification

Before publishing, run:

```bash
npm test
npm run build
npm run docs:build
npm run verify:package-contents
npm run verify:package-install
npm run release:check
```

The runtime architecture and Facade MCP behavior are unchanged in this patch.
