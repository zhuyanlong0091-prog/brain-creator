# E2E：恢复会话到继续执行

在新的 Claude Code 或 Codex 会话中恢复 Brain Creator 的持久状态，检查 bridge，并从正确步骤继续。

## 为什么需要恢复入口

Brain Creator 工作流可能跨越需求澄清、人工登录、测试数据准备和多条用例执行。新的 Agent 会话不应依赖旧对话，也不应通过多次 list 查询猜测进度。

恢复入口一次返回：

- 当前 SystemProfile 和 KnowledgeProject；
- 鉴权状态与未完成 AuthCheckpoint；
- 需求基线和 Requirement Eval 动作；
- 活动 Requirement/Document Suite；
- 当前 TestDataTask 或 AgentTask；
- 最近 ExecutionPlan、Evidence 和 RunLedger 事件；
- open Bug 与 Gap；
- bridge preflight；
- 推荐的下一步。

## 1. 用户进入新会话

发送：

```text
用 Brain Creator 恢复上次会话，显示当前系统、未完成任务、阻塞原因和下一步。
```

Agent 应调用会话/状态 Facade，而不是依次查询系统、鉴权、用例、运行和 Gap。

## 2. 查看完整快照

快照中的 `readiness` 有三种结果：

- `ready`：没有阻塞，可以进入推荐动作。
- `action-required`：存在待确认需求、未完成套件、AgentTask、Bug 或 Gap。
- `blocked`：bridge、鉴权、checkpoint 或必要证据不可用。

`nextAction` 必须与持久套件和任务状态一致。存在活动任务时，不得重新创建计划或重复启动套件。

## 3. 检查 Bridge Preflight

`host-agent` 返回当前 Agent 待完成的任务包；这不是 bridge 缺失。

`claude` 或 `codex` provider 会先执行短 preflight。命令不存在、无法非交互运行或 preflight 超时时，应立即返回可操作错误，不等待完整 Agent 超时。

`disabled` 只能预览，不能继续已确认执行。

## 4. 按推荐动作继续

| `nextAction` | Agent 行为 |
|---|---|
| `confirm_requirement_eval` | 展示待确认动作并取得持久说明 |
| `revise_blocked_requirement` | 要求修订直接矛盾的需求来源 |
| `configure_auth` | 创建或验证 AuthProfile |
| `complete_checkpoint` | 等待用户完成登录、CAPTCHA 或 2FA |
| `prepare_test_data` | 恢复当前数据任务，不重复造数 |
| `submit_agent_output` | 完成当前 host-agent 任务包 |
| `resume_suite` | 从阻塞阶段继续同一用例 |
| `review_gaps` | 展示阻塞证据并等待处理 |
| `review_bugs` | 展示可回归 Bug 与证据 |

## 5. 验证执行后状态

任务完成后再次请求状态，确认：

- 活动任务已清除或指向下一条用例；
- Suite 计数与 case result 一致；
- `nextCaseNo` 指向真实未开始或等待任务；
- 新 Evidence、Bug 或 Gap 已进入 RunLedger；
- 新建测试数据已清理，或仍明确显示 cleanup due。

## 中断后的安全规则

- 不因为新会话而重复批准需求或套件。
- 不重复创建测试数据、AgentTask 或 ChainRun。
- 不跳过未完成清理。
- 不把 `waiting-for-agent` 当作 provider 失败。
- 状态与运行账本冲突时先复盘，不直接重跑。
- 用户取消或拒绝的 Facade 动作不得通过底层工具绕过。

## 常用请求

```text
用 Brain Creator 查看当前系统状态，并告诉我下一步，不要执行写操作。
```

```text
继续完成当前 host-agent 任务，提交后恢复同一个套件。
```

```text
显示最近 RunLedger，解释套件为什么停止。
```

```text
鉴权已经完成，重新验证 checkpoint 并继续当前用例。
```

## 验证命令

源码仓库中可运行：

```bash
npm run verify:live-session-resume-workflow
```

实时 bridge smoke 需要对应 Claude/Codex CLI 与目标环境；默认单元测试不依赖外部 Agent。
