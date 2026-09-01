# 存储与证据

Brain Creator 使用本地文件仓库。默认运行仓库是 schema 20 分片目录 `.brain-creator/store/`。旧的 `.brain-creator/local-assets.json` 仍作为迁移源和兼容格式保留，但新 MCP 上下文默认不会继续写入这个单文件。

## 迁移

首次启动且不存在 schema 20 manifest 时，Brain Creator 会检查 `local-assets.json`，先校验 JSON，创建带时间戳的 `local-assets.json.backup-*` 备份，再通过临时文件和原子重命名写入分片仓库，并校验新的 manifest。已有 schema 19 仓库会在 `store/backups/` 生成独立迁移快照；迁移失败不会删除旧文件，也不会把历史用例自动晋升为可信场景。

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

新的文档 Suite 和 Requirement Suite 使用同一套归属目录：

```text
.brain-creator/artifacts/<系统>/<需求>-v<版本>/<Suite 运行>/
  source/
  analysis/
  cases/
  specs/
  tests/
  evidence/
  report/
  manifest.json
  index.md
```

`latest.json` 保存在 Suite 目录的同级。每个已存在的产物都记录工作区相对路径、字节数、SHA-256 hash 和来源引用。缺失证据会被明确记录；工作区外的产物路径会被拒绝。

历史根目录产物通过统一 CLI 管理。迁移和清理在传入 `--confirm` 前都只返回预览：

```bash
npx brain-creator artifacts migrate
npx brain-creator artifacts migrate --confirm
npx brain-creator artifacts rollback --migration <迁移 ID> --confirm
npx brain-creator artifacts retention --older-than-days 90
npx brain-creator artifacts retention --older-than-days 90 --confirm
```

迁移会校验 hash、更新仓库路径、写入 `legacy-path-index.json` 并支持回滚。无法证明归属的文件会保存在 `artifacts/unresolved/`。清理只选择带 manifest、已终止且非 latest 的 Suite 目录。

## 导出

将已完成的文档 Suite 导出为可迁移 ZIP：

```bash
npx brain-creator export --suite <suite-run-id> --output exports/suite.zip
```

归档包含归属该运行的 source、analysis、cases、specs、tests、evidence、report、index 和 manifest，不包含仓库、密钥、浏览器 storage state 或其他无关工作区文件。Bridge 和 Host Agent 的 Generator/Healer 输出会在 Playwright 执行前或任务接收前检查，ZIP 导出时还会再次扫描。缺失证据会列在 manifest 中，不会被静默忽略。

## 结构化执行证据

执行证据现在区分“运行成功”和“需求验证强度”。一条证据可以包含：

- `assertionContracts`：带需求来源引用、证据要求和类型的断言契约。
- `reporterResult`：标准化后的 Playwright JSON Reporter 结果。
- `assuranceLevel`：`strong`、`limited` 或 `none`。
- `reporterPath`：执行器返回结构化结果时保存的 Reporter 文件。

静态 HTML 报告与 Markdown 证据报告一起生成。即使命令退出码为 0，如果没有完成结构化 Reporter 映射，结果仍为 `none`，不能被描述为强需求验证。报告是离线执行产物，不是新的 Brain Creator UI 入口。

完成执行证据后，系统还会自动评估场景可信状态。首次强证据可见观察运行会将
已绑定场景推进到 `verified`；连续三次需求、System Brain 和数据版本不变的强
证据通过后才进入 `trusted`。首次无头通过会停留在 `bound`，等待可见观察证据。
缺少 Reporter、来源引用、必需覆盖或非通过诊断时，不能晋升，并会把原因写入
证据。需求、System Brain 或数据计划发生变化会清零之前的强运行次数。

报告开头会给出白话摘要：本次理解了什么、观察到什么、用了哪些可复用数据、
实际结果是什么、失败属于哪一类，以及为什么可以或不可以支持需求符合性判断。
Suite 报告还会统计可信、已验证和已隔离的场景证据。

## 鉴权密钥处理

新的鉴权密文使用 `.brain-creator/secret.key` 中的随机本地密钥。可通过 `BRAIN_CREATOR_SECRET_KEY` 使用外部托管密钥，也可通过 `BRAIN_CREATOR_SECRET_KEY_FILE` 指定密钥文件；环境变量优先。已有 `enc:v1` 数据在读取配置时会先解密，再重新加密为 `enc:v2`。生成的 token/cookie seed 只引用 `BRAIN_CREATOR_AUTH_TOKEN` 或 `BRAIN_CREATOR_AUTH_COOKIE`，不会写入凭据值。所有产物阶段都会匹配当前受保护凭据值，以及私钥、JWT、Bearer Token、明文 password/token/cookie 字段等高置信凭据模式。
