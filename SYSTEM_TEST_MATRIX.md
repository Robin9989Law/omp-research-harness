# IPH Research Harness 系统验证矩阵

本文件把状态机、角色路由、工件合同、门禁和恢复路径当成一个系统测试，而不是按
报错逐个补丁。Python IPH validator 是科研判定的唯一真相源；TypeScript harness
只负责控制面、运行时身份、事务、路由和可观测性。

## 1. 系统边界与完成定义

一次升级只有同时满足以下五层才算完成：

1. **拓扑完整**：23 个正向状态节点、22 条正向迁移、N0-1/N0-2 负面终态、
   `BLOCKED → resume_state` 恢复覆盖完整；
2. **认知与控制完整**：M3 负责全局综合、创新批判和动态重规划；指定 specialist 提供独立
   领域审计，validator 独立裁决机器合同；
3. **事务完整**：state、lifecycle、STOP lock、validation log 在失败时一起回滚；
4. **证据完整**：gate、artifact pointer、不可变哈希和 next action 同步记账；
5. **部署完整**：技能锁、用户配置、真实 OMP loader、安装、打包内容和 README 同步。

## 2. 正向节点矩阵

| 段 | source → target | 判断角色 | 关键系统证明 |
|---|---|---|---|
| E2/L1 | BOOT → SCOPE_LOCK → PRIOR_CLAIM_DRAIN | M3 | scope 与 prior claims 原子登记 |
| E2/frontier | PRIOR_CLAIM_DRAIN → RECENT_FRONTIER → LITERATURE_REGISTER | frontier / GPT-5.6-sol | 最近窗口、身份、覆盖、注册表一致 |
| E2/layer | LITERATURE_REGISTER → L1_FREEZE → L2_TRIAGE → LAYER_DECISION | layer / GPT-5.6-sol | L1/L2/贡献架构与证据深度一致 |
| E2/L3 | LAYER_DECISION → K_FULLTEXT → K_CLAIM_REGISTER | M3 + atomic / GPT-5.6-sol | 只对 K 集合取全文；进入 K_CLAIM_REGISTER 前由 atomic 完成原子观点 |
| E2/collision | K_CLAIM_REGISTER → SYNTHESIZE_COLLISION → OUTPUT_CLAIM_BIND | collision + M3 / GPT-5.6-sol | collision 专家完成 evidence→reasoning→statement，M3 只做确定性输出绑定 |
| E2/audit | OUTPUT_CLAIM_BIND → EVIDENCE_VALIDATE → N0_AUDIT | M3 | 证伪书与 N0 正/负终态 |
| E3/precompute | N0_AUDIT → CLAIM_FREEZE → VALIDITY_AUDIT → INDEPENDENT_REVIEW → DIRECTION_LOCK | M3 + review / DeepSeek V4 Pro | N0-4C、V1/V2、运行时绑定 V3 |
| E4 | DIRECTION_LOCK → COMPUTE → POSTCOMPUTE_CLAIM_FREEZE | M3 | 用户授权不旁路 N0-4C/V3，S4 后新 epoch |
| E3/final | POSTCOMPUTE_CLAIM_FREEZE → FINAL_VALIDITY_AUDIT → FINAL_LOCK → COMPLETE | iph-reviewer / DeepSeek V4 Pro + M3 | 当前 bundle 的 V4 与最终锁；reviewer 为认证 specialist，不允许 M3 自审 |

`auditSystemTopology()` 在单元测试中逐边核对上述 23 节点、目标唯一性、专家角色、
禁止动作合同和 mutable/immutable 工件冲突。任何新增、删减或改向都会使测试失败。

## 3. 失败注入与恢复矩阵

| 编号 | 注入点 | 预期行为 | 自动证据 |
|---|---|---|---|
| F1 | post-transition validator 非零 | 四个事务文件恢复原字节 | `TRANSACTION_ROLLBACK` E2E |
| F2 | 合法进入 BLOCKED | BLOCKED state 与 STOP 锁保留 | `EXPECTED_BLOCKED_COMMIT` E2E |
| F3 | BLOCKED 外部原因修复 | 显式恢复到 resume_state；失败全量回滚 | `--resume-blocked` Python 测试 + OMP E2E |
| F4 | STOP 锁已存在 | session_stop 不自动续跑，不触发 validate 循环 | session-stop control 测试 + 真实 M3 回合 |
| F5 | 最近前沿 gate 置真 | 从 literature registry 同步 recent_window | Python CLI 回归测试 |
| F6 | specialist caller schema 畸形 | harness 删除 outputSchema/schemaMode 后派发 | task sanitizer 测试 |
| F7 | specialist 身份缺失/不匹配 | 迁移拒绝 | runtime lifecycle 测试 |
| F8 | reviewer 自审或主 agent 改审计 | 拒绝或逐字节回滚 | reviewer/protected artifact 测试 |
| F9 | 未授权计算 | tool_call 前拦截 | compute preflight 测试 |
| F10 | lifecycle、skill commit/hash 或安装中途漂移 | STOP 或事务回滚 | lock/install/package E2E |
| F11 | 工具已注册但未挂到模型可见工具面 | 13 个 IPH 工具全部 essential | 真实 OMP loader 可见性断言 + M3 回合 |
| F12 | specialist 先发 PASS 消息、正式 completion 尚未落地 | 身份门识别 started 并短暂等待正式 completion；凭证绑定 research root + target | lifecycle 竞态单测 + 真实 M3 单节点重放 |
| F13 | specialist 从模糊术语创造不存在的 JSON 排序约束 | FAIL 必须引用精确规则/schema/issue；明确 false-first 与 OCCUPIES 极性 | agent 合同断言 + 真实 GPT-5.6-sol 失败轨迹 |
| F14 | specialist 已产出 READY gate，却把正式 completion 时间用于无界可选检索 | gate closure 与 exploration 分离；超时身份不可复用，draft 可由新任务复核续接 | agent 合同断言 + 15 分钟真实超时轨迹 + 续接重放 |
| F15 | 为满足自造的 URL distinctness，把 arXiv 预印本写成同行评审证明 | URL 字段按证据角色校验；预印本域不得证明 `PEER_REVIEWED_*`；活动 ledger 使用版本化 state pointer | Python 正反测试 + 真实 M3 语义逃逸轨迹 |
| F16 | specialist 已完成但结论与权威规则冲突 | 允许 M3 接受或推翻，但迁移必须记录 disposition 及证据/规则/validator 依据 | disposition 合同单测 + decision note 审计 |
| F17 | 磁盘上存在 URL ledger，但已置真的 literature gate 没有活动指针 | validator 拒绝隐式文件名猜测；要求 `artifacts.url_ledger` 并用版本化修复工具原子切换 | workflow-state 单测 + 真实 M3 拒绝无根修复轨迹 |
| F18 | M3 理解目标但不知如何构造 validator 可接受的输出 | transition plan 先给题面、必读证据、输出合同、最小正例、反例与 completion proof | briefing 单测 + 真实 OMP loader |
| F19 | task lifecycle 重复/乱序：`completed` 后到 `started/failed`，或终态先到 | 生命周期单调；终态不回退，重复幂等，身份/作用域不被后到事件污染 | duplicate/out-of-order/identity-collision 单测 |
| F20 | 大量事件直接涌入 M3，当前/历史/冲突任务混杂 | 确定性 `iph_event_snapshot` 投影，DeepSeek V4 Flash 只读压缩，无 task/advance/科学裁决权 | 角色/工具安装 E2E + 有无管理员消融 |
| F21 | transition plan 的自然语义让 M3 提前置真下一态 gate | 每个 target 返回并预检精确 gate assignments；未提交前拒绝 future gate | gate-state 绑定单测 + L2 真实回滚轨迹 |
| F22 | M3 在 L1/L2 猜测贡献类型，或把 `nextAction` 直接写成更远节点 | plan 明示当前 target 的 contribution 合同与提交后的唯一相邻 target；写前拒绝跨层 contribution 和跳态 next action | contribution/next-action 单测 + L2 消融失败轨迹 |
| F23 | M3 因 `task` 无 model 参数误报 specialist 回退到默认模型 | agent role 负责路由；实际模型只以 lifecycle `resolvedModel` / `model_change` 为证，缺证据报告 UNKNOWN | DeepSeek V4 Flash 真实 JSONL trace + agent/系统合同断言 |
| F24 | 本地调试只用 `--extension`，或在 OMP 17.3 下只用 `--plugin-dir`，导致 agent 或 `iph_*` 工具/保护 hooks 只加载一半 | 源码调试统一使用 `scripts/run-local-omp.sh`，同时传 plugin root 与精确 extension 模块；禁止 `--no-extensions` | runner 静态断言 + 真实 Node 17 半装载失败轨迹 + session tool-call 证据 |
| F25 | event-flow-manager 把自己的 Flash 身份外推给 layer-adjudicator，M3 再把错误身份写入 decision note | 模型身份从自由文本剥离；harness 直接读取认证 session 的 `model_change` 并自动记账，rationale 禁止自报模型；manager 只可标注自身模型 | session model-evidence 单测 + 真实 L2 错误归因轨迹 |
| F26 | `npm pack --dry-run` 受用户 `~/.npm` 历史 root-owned 缓存污染而 EPERM | release/package E2E 使用一次性隔离 npm cache，结束后清理；不修改用户缓存，不建议 sudo | release-check 真实失败轨迹 + 隔离缓存重放 |
| F27 | reviewer 在子任务内合法 `iph_review` 后，父 `task` 安全快照把 sealed state 当成越权修改回滚 | 父边界只接受同态 review state、runtime IDs、bundle hash、review hash 与 PASS/FAIL 语义全部一致的闭环；仅放行该 state 与唯一登记 JSON，其余变化照常回滚 | 真实 loader/hook E2E + Node 21 连续事务 E2E |
| F28 | 把科学 FAIL 与 capability unavailable 混成同一失败 | reviewer FAIL 保持 review state/V2 或 V3；其他 specialist FAIL 保持当前 gate/V-level；两者都落 INVALID+STOP+required remediation。只有能力不可用返回 `BLOCKED_CAPABILITY` 并由 coordinator 提交 BLOCKED | PASS/FAIL/capability 三分支单测 + same-state specialist FAIL smoke + BLOCKED E2E |
| F29 | validator 只校验 witness 命令字段与历史 output/hash，命令本身不存在仍可假绿 | fixture 生成时真实执行五条 witness 命令，逐项核对命令、exit code、stderr、stdout bytes 与 SHA-256；近邻 locator 使用官方 PDF 的真实章节/公式/定理 | 22 源状态 fixture matrix + witness 命令执行 |
| F30 | 受限环境无法联网重新下载固定论文，导致系统测试不可复现 | `IPH_FIXTURE_PDF_CACHE` 接受已验证的固定 PDF；无论在线下载或离线缓存都必须命中同一 pinned SHA-256 | fresh offline fixture generation + 22/22 validator replay |
| F31 | frontier fixture 声称覆盖前后向引用，却没有可复核的 database/query/filter/date/hit count | fixture 登记官方 PDF bibliography 后向遍历与 OpenAlex 前向查询，并保存 observed result；frontier-auditor 独立复核 | Node 4 首次 substantive FAIL + 修复后 GPT-5.6-sol strict 0 |
| F32 | OMP 用 `write(path=xd://iph_advance)` 动态桥调用 IPH 工具，防火墙只看外层 `write` 而回滚合法事务 | 只对白名单中的精确 `xd://iph_*` 识别为同一受信任事务；其他 xd/write 仍受快照保护；证据收集还原底层工具名 | bridge 解析单测 + Node 6 失败轨迹 + 修复后真实重放 |

## 4. 分层测试顺序

系统更新由仓内隔离的 **SIF**（`sif/`，不进 npm 插件包）编排。现有 `bun run check`、
`test:omp`、`test:nodes`、`test:models` 是后端，不是入口。SIF 是评测/进化 harness；
IPH 研究会话中的运行时 harness 冻结，禁止在科研会话内进化脚手架。

```text
bun run iterate              # 按变更影响面跑下一步，首错即停
bun run iterate:status
bun run iterate:replay
bun run iterate:ingest -- --research-root <research-root>   # 连续 live-run 收口；进行中加 --snapshot
bun run iterate:lock-bump -- --commit <sha>
bun run certify              # 结果门 + 过程门；不 push / 不 publish
```

每次升级固定按以下顺序执行，首错即停，不清锁重试：

```text
L0 静态：typecheck + topology audit + doc/version scan
L1 单元：bun test + Python unittest/pytest
L2 组件：真实 OMP loader/tool/hook E2E
L3 恢复：STOP/BLOCKED/rollback 故障注入
L4 部署：install transaction + package contents + plugin doctor
L5 真实模型：M3 可跨节点做全局推理，但每回合只提交一个合同事务；指定 specialist 独立复核
L6 能力激发：H0–H3 梯子 + HarnessFix 四消融（prompt-only / 无轨迹 / 自由编辑 / 无回归门）；比较时固定信息预算
```

结果门看最终 `workflow_state` 与 Python validator；过程门从 HTIR 提取发现问题→优化任务→高效完成。
边走通但无主动闭环证据是 `unverified_success`，不能 `certify`。日常 iterate 为 pass@1；
certify 对受影响真实节点要求 pass^k（k=2 次**独立隔离**试次，各用新 `--run-root`），**或**一场连续 live-run 的 `live-continuous` PASS。
`test:models` 仍是隔离单边；iterate 的 L5 不得把 `PROJECT_ROOT` 当研究根，必须设 `SIF_FIXTURE_ROOT`。连续立题会话停稳后用 `iterate:ingest` 收口，不要对着正在跑的
`debug:omp` 开 validator。失败产出范围化 repair operator，禁止用更细步骤脚本换绿灯。

源码真实模型测试必须通过 `npm run debug:omp -- ...` 启动。该入口同时传
`--plugin-dir <root>`（agents/resources）和 `--extension <root>/extensions/iph.ts`（工具/hooks）。
不得只用其中一个，也不得传 `--no-extensions`；半装载的失败不代表发布包行为。

M3 每一步先 `iph_status`、再 `iph_transition_plan`；可以分析全局路径、质疑计划和比较信息价值，
但一次只能提交计划中的一个 target。立题会话在 READY 后继续下一条相邻边，直到
`DIRECTION_LOCK`、诚实 N0-1/N0-2、STOP 或 BLOCKED。期刊目标 45 分钟、博士 3 小时是到
`DIRECTION_LOCK` 的软 SLA，不含 COMPUTE。
同一 state hash + 同一失败码不得第二次调用 validate/clear-lock。失败时保存 session、
state hash、STOP lock、validation log 和工具调用序列，回到对应层修复后再重放。

当前确定性回归另执行：

```text
bun run test:nodes -- --pdf-cache <pinned-pdf>
bun run test:models -- --fixture-root <fresh-root>
bun run test:models -- --fixture-root <fresh-root> --all-nodes
bun run test:models -- --fixture-root <fresh-root> --all-nodes --from-node N --to-node M
```

它分别证明 22 个源状态都能被权威 validator 接受、N0-1/N0-2/N0-3 不会被强推为正结果、
以及 Node 18–22 能从明确授权连续提交到 COMPLETE。`--all-nodes` 是 L5 真实模型的
22 节点隔离单边回放；确定性与真实模型两层结果必须分开报告。

真实模型采用分层预算，不把发布级认证放进每次提交：

- 日常：`check` + `test:nodes`；
- 节点实现、prompt 或合同变化：只跑受影响的 `N..M`；
- reviewer/compute 控制面变化：默认连续跑 Node 17–22；
- 模型路由、OMP lifecycle、插件装载或发布候选：完整 `--all-nodes`，允许按节点范围在独立 CI worker
  分片并合并 evidence；
- 首次失败保留为负证据，修复后从该节点重放，不从 Node 1 重做已经证明且未受影响的昂贵科学审计。

L6 不把单次成功率当作唯一指标，还记录无效工具调用、token/时延、规则冲突发现率、可复用新洞见和
validator 拒绝率。测试结果用于删除压制 M3 全局推理的冗余步骤，并保留能提高事实质量和副作用安全的
最小 scaffold。

## 5. 面向 Agent 用户的工程约束

本产品的直接用户是 Agent。自然语言说明只是辅助界面，真正的产品合同必须满足：

- 状态、锁、身份、完成度和下一动作均为机器可判定字段；
- 已发送消息不等于任务完成，自报 ID 不等于运行时身份；
- `task` 参数没有 model 字段不等于模型回退；实际模型身份只取运行时 lifecycle 元数据；
- 每个节点只有一个目标、一个合同和一个合法恢复动作；
- 错误必须包含已观察状态和可执行诊断，不能只给模糊失败；
- 重复、提前、超时和乱序调用必须幂等或安全拒绝；
- M3 负责全局综合、创新批判和行动选择；specialist 是独立对抗同伴，validator 负责事实裁决；
- 系统约束副作用而不约束思考空间，不得用“便宜/弱模型”假设减少 M3 的判断责任；
- gate closure 与开放探索使用不同预算；READY 后先正式完成，超时 draft 可续接但 stale identity 不可复用；
- 每次真实模型测试保留调用序列、模型角色、agent ID、状态快照和工件哈希。

## 6. 发布门

- 技能仓库与 harness 工作区 clean；
- 两仓本地提交均通过各自全量测试；
- 真实 M3 单步日志与磁盘状态一致；
- `bun run check`、`release:check`、`omp plugin doctor` 通过；
- README、CHANGELOG、lock commit/hash 与 package version 一致；
- 用户明确实测前不执行 `npm publish`。Git push 与 npm 发布是两个独立动作。

截至 2026-08-14：确定性 22/22 与真实模型 Node 1–22 分段证据均已通过；Node 17–22 另有同一研究根的
连续回放，最终 `COMPLETE`。Node 4/6 的首次失败、根因、修复 commit 和重放证据均保留，详见
`docs/FULL_NODE_EVIDENCE_2026-08-14.md`。这关闭的是已定义节点与故障矩阵，不扩大为“所有未来生产条件
完全可靠”。用户实测前仍不 push、不执行 `npm publish`。
