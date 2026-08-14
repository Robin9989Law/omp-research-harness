# SIF

评测/进化 harness，不是科研运行时。不要从研究会话调用，不要打进 npm 插件包。

```text
status        读 sif/iteration_state.json
iterate       跑计划中的下一步（首错即停；干净树用 --base <branch> 评测已提交差）
replay        从 STOP 步重放
ingest        收口一场已结束（或 --snapshot）的连续研究会话
trace         只读评分 Codex rollout / forensics 导出（不写账本，不能冒充 IPH live-run）
flaws         归并账本 FAIL 为 HarnessFix 风格缺陷记录
lock-bump     候选 IPH lock，不改 config/iph-lock.json
certify       双门认证，不 push / 不 publish
```

连续 live-run 不是 `test:models` 的隔离单边。会话停稳后再 ingest：

```bash
bun run iterate:ingest -- --research-root /path/to/research-root
```

仍在跑时只允许只读快照，且禁止开 Python validator（会重建 `lifecycle_state.json`）：

```bash
bun run iterate:ingest -- --research-root /path/to/research-root --snapshot
```

终态后若要权威结果门，显式加 `--validator`。ingest 只读研究根；snapshot 不往账本写 FAIL。
终态 PASS 记为 L5 `live-continuous`，可供 `certify --real-models` 替代隔离 pass^k。
`--summary` 只打印诊断摘要：hub wait、挂起工具、跳态、节点超时、H0–H3、RQ3 四消融、观测投影。

历史 Codex 开发会话（forensics 导出）只能做过程门回放，不能当 `iterate:ingest` 的研究根：

```bash
bun run iterate:trace -- --codex /path/to/forensics-session-dir --summary
```

隔离 L5 必须给一次性 `--run-root`，禁止用仓根当研究根：

```bash
SIF_FIXTURE_ROOT=/path/to/fresh-fixtures bun run iterate -- --real-models
bun run iterate -- --ablation   # L6：H0–H3 + HarnessFix 四消融（无轨迹也可跑政策对照）
```

地图：

- 合同：`schema.json` + `iteration_state.json`（gitignore）
- 影响面：`impact.yml`
- 证据：`evidence/index.json`（入库）与 `evidence/runs/`（gitignore）
- 被测产品仍在 `extensions/`、`agents/`、权威 IPH lock
