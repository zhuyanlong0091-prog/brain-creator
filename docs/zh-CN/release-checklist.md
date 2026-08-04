# Brain Creator 发布清单

在 npm 发布和 Codex 插件交付前，验证源码、包内容、运行入口和文档站。

## 必跑检查

```bash
npm test
npm run build
npm run docs:build
npm run verify:requirement-eval
npm run verify:package-contents
npm run verify:package-install
npm run verify:codex-native-entry
npm run release:check
```

## npm 发布前

- `package.json`、`package-lock.json`、`src/version.ts` 和插件 manifest 版本一致。
- `brain-creator --version` 输出目标版本。
- npm tarball 包含 CLI、Skill、MCP、插件资产、README 和全部公开 Markdown 文档。
- tarball 不包含 `.brain-creator/`、鉴权状态、prompt、trace、本地测试结果、源码或开发脚本。
- `npm run verify:package-install` 能在临时业务项目安装 tarball、启动 MCP 并完成 host-agent smoke。
- npm 登录和 OTP/发布令牌仅在发布命令中使用，不写入仓库或对话文档。

发布：

```bash
npm publish --access public
```

发布后验证：

```bash
npm view brain-creator version
npx --yes brain-creator@<version> --version
```

## Codex 插件

- 三份 Brain Creator Skill 副本一致。
- `.agents/plugins/marketplace.json`、插件 manifest 和 npm 包版本一致。
- `brain-creator plugin install` 能注册项目本地包根目录。
- `/bc help` 和 Facade 工具可被发现。
- `host-agent` 模式不会错误启动本地 Claude 子进程。

## 文档站

- `npm run docs:build` 无死链、locale 或静态构建错误。
- 英文与 `zh-CN` 导航都可访问。
- 搜索能返回中英文结果。
- GitHub Pages 工作流在 PR 中只构建，在 `main` 中构建并部署。
- 仓库 Settings > Pages 的 Source 设置为 GitHub Actions。

## 版本发布后的下一步

- 检查 npm 页面上的 README 和版本。
- 检查 GitHub Pages 部署状态和站点 URL。
- 记录版本功能、验证结果、已知限制和回滚版本。
