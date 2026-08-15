# SIF

评测/进化 harness，不是科研运行时。不要从研究会话调用，不要打进 npm 插件包。

```text
iterate       默认一体化：探针实测 → HIT 给调优参考 → CLEAR 后自动 replay/跑完计划/certify
probe         只要探针（调试用）
status        读 iteration_state + 最新探针卡
replay        单独重放 STOP 步（一体化时会自动 replay）
ingest        收口一场已结束（或 --snapshot）的连续研究会话
trace         只读评分 Codex rollout / forensics 导出
flaws         归并账本 FAIL
lock-bump     候选 IPH lock
certify       单独双门认证（一体化时 CLEAR 后会自动 certify）
```

一条命令同时做实测、调优参考和完整框架。不要从研究会话调用。

```bash
bun run sif -- --base main --ablation
# 或
bun run iterate -- --base main --ablation
```

HIT 时打印 `reference` / `anchors` / `suggestion` 后退出 2，按建议改完再跑同一条命令。CLEAR 后自动重放失败步、跑完 L0–L6、再 certify。跟随改动：

```bash
bun run sif -- --watch --interval 8 --base main --ablation
```

可选只读跟随研究根：`--research-root <path>`（snapshot，不开 validator）。
旧的单步 iterate：`--step`。只要探针：`bun run iterate:probe`。
`--no-probe` / `--no-certify` 拆开阶段（一般不用）。

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
- 证据：`evidence/index.json`（认证入库）与 `evidence/runs/`、`evidence/probes/`（gitignore；探针 OBSERVE 不是 PASS/FAIL）
- 被测产品仍在 `extensions/`、`agents/`、权威 IPH lock
