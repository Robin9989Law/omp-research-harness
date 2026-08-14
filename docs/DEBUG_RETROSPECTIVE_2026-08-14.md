# Research Harness 系统调试复盘（2026-08-14）

## 结论

本轮不是对单个报错逐项打补丁，而是按 Agent-native 系统工程重建了控制面：M3 保持全局综合、
创新批判与动态重规划权；specialist 作为独立对抗同伴；Python validator 裁决机器事实；harness
只约束身份、生命周期、证据、状态迁移和副作用。

最终本地状态：

- 权威 IPH：463/463 Python 测试通过，8 个本地提交待推送；
- Research Harness：37/37 单元测试通过，23 节点/22 迁移拓扑完整，26 类故障注入通过，
  真实 OMP loader、事务安装、完整 npm tarball、release dry-run 均 READY；
- npm dry-run 包：约 70 KB，解包约 209 KB；未执行 `npm publish`；
- 真实基线：从 `L1_FREEZE` 安全推进到 `L2_TRIAGE`，`k_set_selected=true`、
  `active_contribution=NONE`、STOP 未激活，下一相邻目标为 `LAYER_DECISION`；
- 模型路由实证：主流程 M3、layer-adjudicator GPT-5.6-sol、event-flow-manager DeepSeek V4 Flash，
  三者真实 JSONL 均为 `resolvedModelIsFallback=false`。

## 方法

采用 `Detect → Attribute → Repair → Rerun`，按以下层次首错即停：

1. 静态拓扑与双实现状态集合；
2. 单节点/单任务；
3. 单任务 lifecycle 事件流；
4. 混合多任务流与管理员消融；
5. 1,101 条事件风暴；
6. STOP/BLOCKED/rollback 故障注入；
7. 真实 OMP 完整插件加载；
8. 用户配置、安装、打包和 release dry-run。

失败案例目录永久保留，不覆盖历史；真实重测从用户指定 baseline 开始。重要修复均先本地 commit，
最后统一 push。

## 主要失败链与根因

| 观察 | 根因层 | 修复 |
|---|---|---|
| frontier-auditor 无法指派 | 模型角色/agent discovery | 显式受管角色；完整插件根加载；真实 task lifecycle 验证 |
| strict caller schema 连续 `Expected ']'` | Tool Interface | specialist task 自动剥离 `outputSchema/schemaMode`，仅允许最小字段 |
| M3 编造 `ipc_call` | Capability discovery | 13 个 `iph_*` 工具全部 essential，并在真实 loader 断言可见 |
| PASS 消息后仍阻塞 | Lifecycle | message 与正式 completed 分离；短暂等待 completion；身份绑定 root+target |
| recent frontier gate 与时间窗不同步 | Transaction/state | 权威 CLI 原子同步 recent window；失败全量回滚 |
| BLOCKED 无法恢复 | Recovery | `resumeBlocked` 事务恢复；失败逐字节还原 state/lock/log |
| optional 搜索路由不可达导致整体失败 | Evidence policy | 必需 quorum 与 optional 能力明确分离，optional 只告警 |
| false-first 被误解为 JSON 排序 | Scientific contract | 证伪优先定义为审计义务，不创造数组顺序门禁 |
| 预印本被写成同行评审证明 | Evidence semantics | URL 字段绑定认识论角色；版本化 ledger 修复并保留旧哈希 |
| 磁盘有 ledger 但活动指针缺失 | State/evidence binding | gate 要求活动 `url_ledger` 指针；提供原子 pointer repair |
| M3 不知如何输出 validator 可接受结果 | Context/ACI | 关键节点提供题目、必读证据、输出合同、正反例、completion proof |
| specialist 完成被当成结论权威 | Governance | M3 必须记录 `ACCEPTED/OVERRIDDEN` 与依据；completion 只证明身份 |
| lifecycle 重复、乱序、身份碰撞 | Lifecycle | 终态单调、重复幂等、冲突保留、跨 target stale 分类 |
| 多任务第一项完成后其余绑定丢失 | Orchestration | dispatch binding 保留整个任务批次，直到 session 结束 |
| M3 在 L2 提前置真 `l2_frozen` | State contract | 每个 target 精确 gate assignments；未来 gate 写前拒绝 |
| M3 在 L2 猜 `contribution=M` | Output contract | plan 明示 L1/L2 为 NONE；写前拒绝层级冲突 |
| M3 把下一步跳到 K_FULLTEXT | Navigation | plan 明示 post-commit 相邻 target；nextAction 写前拒绝跳态 |
| M3 误报 Flash 未启用 | Observability | 实际模型只认 session `model_change`，不从 task 参数缺失推断 |
| event manager 把自己的 Flash 身份归给 layer | Provenance | harness 自动读认证 specialist session；rationale 禁止自报模型 |
| `-e` 调试时工具有、agent 无 | Test harness | 标准源码入口统一 `--plugin-dir`，不拆开产品包 |
| `--no-extensions --plugin-dir` 时 agent 有、工具无 | Test harness | 同上；两条半装载轨迹作为失败注入保留 |
| release dry-run 被 `~/.npm` root-owned cache 阻塞 | Execution environment | 使用自动清理的一次性 npm cache，不触碰用户缓存 |

## M3 行为评估

结论不是“M3 笨”。多次最有价值的发现恰恰来自 M3 的拒绝和全局反推：

- validator 没有检测活动指针缺口时，M3 拒绝无根修复，暴露 gate 合同缺陷；
- agent 类型不可见时，M3 没有静默换通用 worker 或伪造 identity；
- layer-adjudicator 未正式完成时，M3 等待 lifecycle，没有把进度消息当 PASS；
- 修复 briefing 后，M3 能一次构造正确 gate、contribution、相邻 nextAction 和 disposition。

M3 的失败主要来自“世界模型或输出合同不完整”，而不是理解能力不足。最佳工程策略是提供高带宽、
可验证的题面和状态投影，同时把不可伪造的副作用交给确定性 substrate。

## 事件管理员消融

| 条件 | 用时 | 父调用 | 子 agent | 结果 |
|---|---:|---:|---:|---|
| A：无管理员 | 3m29s | 17 | 1 | 临时副本成功进入 L2_TRIAGE |
| B：Flash + 2 个 optional scout（修复前） | 3m25s | 14 | 4 | 成功，但 contribution 首次错误后重试 |
| B 重放（输出合同修复后） | 3m35s | — | 4 | 零无效推进、零重试，成功 |
| 真实基线：Flash + 必需 layer | 5m40s | — | 2 | 零重试，成功；耗时主要来自完整必读证据和科学复核 |

DeepSeek V4 Flash 单次投影约数秒；在 3 个工作任务运行时准确压缩为 1 个必需 started、2 个 optional、
0 conflict。确定性 1,101 事件压力测试在毫秒级正确区分 1 个当前完成、1,000 个 optional、100 个 stale。

但 Flash 与初始任务同批启动时过快，只能看到 `CURRENT_STARTED`，无法代表稍后的正式 completion。
因此最终策略是容量触发而非固定启用：1–3 个简单任务由 M3 直接等待；大量事件积累后，在状态变更前
的决策检查点调用管理员。它压缩事件，不做科学判断、不派任务、不写文件、不推进状态。

## Agent-native 最佳实践

1. prompt 不是控制面；状态、身份、模型、完成度和权限必须来自运行时事实。
2. 确定性 substrate 限制副作用，不限制模型思考空间。
3. READ → REASON → ACT 的核心是先让题目可判定，而不是把模型降格为脚本解释器。
4. specialist 是对抗同伴，不是等级更高的上级；M3 对最终行动负责。
5. 消息不等于 completion，自报模型不等于 runtime model。
6. 一次只提交一条状态边，但行动前可以做全局反推、机会成本比较和创新批判。
7. 写操作必须事务化、可回滚、可幂等；同一 state hash + failure 不盲目重试。
8. evidence 字段是认识论角色，不是非空率或 distinct URL 数量指标。
9. 调试装载方式属于产品；半装载轨迹不能评价完整产品。
10. 可靠性用重复、扰动、乱序、超时、能力缺失和恶意输出测试，不用一次演示成功验收。

## 本地提交

### innovation-proposition-hunting（8）

`5b91614`、`00464b5`、`636dde2`、`c419602`、`f083995`、`ed67a77`、`6a4a9cd`、`1f7df51`。

### omp-research-harness（20 个实质提交 + 1 个复盘库存提交）

从 `201303d feat: harden M3-led research workflow` 到
`94ec99a docs: record system debug outcomes and event policy`，覆盖角色迁移、恢复、工具可见性、完整拓扑、
生命周期、Agent-native 合同、证据语义、briefing、事件管理员、输出合同、完整包装载、模型 provenance
和 hermetic release 检查。

## 发布结论

本地发布门已满足。按用户要求，本轮只 push Git 仓库，不执行 npm publish。npm 发布应等待用户对
源码/本地插件完成实测后，另行升级版本并走 OIDC trusted publisher。
