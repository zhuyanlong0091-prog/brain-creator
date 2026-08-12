# 存储与证据

Brain Creator 使用本地文件仓库。默认运行仓库是 schema 17 分片目录 `.brain-creator/store/`。旧的 `.brain-creator/local-assets.json` 仍作为迁移源和兼容格式保留，但新 MCP 上下文默认不会继续写入这个单文件。

## 迁移

首次启动且不存在 schema 17 manifest 时，Brain Creator 会检查 `local-assets.json`，先校验 JSON，创建带时间戳的 `local-assets.json.backup-*` 备份，再通过临时文件和原子重命名写入分片仓库，并校验新的 manifest。迁移失败不会删除旧文件。

主要目录如下：

```text
.brain-creator/store/
  manifest.json
  collections/<资产集合>.json
  systems/<系统 ID>/system.json
  systems/<系统 ID>/assets.json
  knowledge/<知识项目 ID>/requirements/<需求 ID>.json
  runs/<Suite 运行 ID>/ledger.jsonl
  indexes/asset-index.json
```

可以通过 `BRAIN_CREATOR_STORE_DIR` 指定其他分片目录。`BRAIN_CREATOR_DATA_FILE` 仍可作为旧仓库迁移源。Brain Creator 运行期间不要手工修改这些文件，应使用 Facade 控制面。

## Doctor 检查

运行：

```bash
npx brain-creator doctor
```

报告会检查 manifest 格式和版本、索引是否存在、遗留单文件以及未完成的临时文件或锁文件。`warn` 表示需要复核但不一定阻止执行；`fail` 表示 manifest 不可信，应先从备份恢复再执行测试。

如果索引缺失且当前没有 Suite 或 Agent 任务，可以通过运行时控制面重建：

```json
{
  "target": "runtime",
  "operation": "rebuild-index"
}
```

## 证据 manifest

完成的文档 Suite 会在以下位置生成 manifest：

```text
.brain-creator/artifacts/<系统>/<需求>/<Suite 运行>/manifest.json
```

每个已存在的产物都记录工作区相对路径、字节数、SHA-256 hash 和来源引用。缺失证据会被明确记录；工作区外的产物路径会被拒绝。

## 导出

将已完成的文档 Suite 导出为可迁移 ZIP：

```bash
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip

## 结构化执行证据

执行证据现在区分“运行成功”和“需求验证强度”。一条证据可以包含：

- `assertionContracts`：带需求来源引用、证据要求和类型的断言契约。
- `reporterResult`：标准化后的 Playwright JSON Reporter 结果。
- `assuranceLevel`：`strong`、`limited` 或 `none`。
- `reporterPath`：执行器返回结构化结果时保存的 Reporter 文件。

静态 HTML 报告与 Markdown 证据报告一起生成。即使命令退出码为 0，如果没有完成结构化 Reporter 映射，结果仍为 `none`，不能被描述为强需求验证。报告是离线执行产物，不是新的 Brain Creator UI 入口。

## 鉴权密钥处理

新的鉴权密文使用 `.brain-creator/secret.key` 中的随机本地密钥。可通过 `BRAIN_CREATOR_SECRET_KEY` 使用外部托管密钥，也可通过 `BRAIN_CREATOR_SECRET_KEY_FILE` 指定密钥文件；环境变量优先。已有 `enc:v1` 数据在读取配置时会先解密，再重新加密为 `enc:v2`。生成的 token/cookie seed 只引用 `BRAIN_CREATOR_AUTH_TOKEN` 或 `BRAIN_CREATOR_AUTH_COOKIE`，不会写入凭据值。
```

归档包含 `manifest.json` 和可用证据文件，不包含仓库、密钥、浏览器 storage state 或其他无关工作区文件。缺失证据会列在 manifest 中，不会被静默忽略。
