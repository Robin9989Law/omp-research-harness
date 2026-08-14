# Research Harness 系统调试复盘（2026-08-14）

## 结论

本轮不是对单个报错逐项打补丁，而是按 Agent-native 系统工程重建了控制面：M3 保持全局综合、
创新批判与动态重规划权；specialist 作为独立对抗同伴；Python validator 裁决机器事实；harness
只约束身份、生命周期、证据、状态迁移和副作用。

当前可证状态：

- 权威 IPH：470/470 `unittest` 通过；当前 Python 环境未安装 pytest，因此没有把 pytest 启动失败误报为产品失败；
- Research Harness：46/46 Bun 测试、23 节点/22 迁移拓扑、30 类故障注入、真实 OMP loader、事务安装与 package check 均 READY；
- fresh offline fixture：22/22 源状态通过权威 validator；五条 theory witness 命令真实执行并校验 exit/stdout/hash；
- N0 终态：N0-1、N0-2 与 N0-3 HOLD 均落态成功，强行进入正向 claim freeze 被拒且 state 逐字节不变；
- 晚期连续事务：Node 18–22 从 `DIRECTION_LOCK` 走到 `COMPLETE`，覆盖未授权计算拒绝、显式授权、S4、epoch+1、第二轮 runtime-bound review；
- 真实模型历史证据：M3 已覆盖 Node 1–16，首次 Node 17 reviewer 正确发现伪 locator 与缺失 witness；此前也验证过 GPT-5.6-sol、DeepSeek V4 Pro/Flash 的角色路由；
- 当前外部阻塞：修复后的 Node 17 真实重放在 provider 请求前被沙箱网络策略阻断，trace 为 0 token、0 tool call。因此 Node 17 修复后及 Node 18–22 不能声称“真实 M3 已复测”；
- 未执行 Git push、`npm publish` 或远程发布。

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
| 只用 `--extension` 时工具有、agent 无 | Test harness | 标准源码入口同时传 `--plugin-dir` 与精确 `--extension`，不拆开产品包 |
| OMP 17.3 下只用 `--plugin-dir` 时 agent 有、`iph_*` 工具/hooks 无 | Test harness | 同上；真实 Node 17 半闭环轨迹作为失败注入保留 |
| release dry-run 被 `~/.npm` root-owned cache 阻塞 | Execution environment | 使用自动清理的一次性 npm cache，不触碰用户缓存 |
| reviewer 合法 seal 后仍在父 task 返回时消失 | 两层事务边界 | 父快照重新判定 runtime identity、同态 state、bundle/review hash 与 PASS/FAIL/STOP；只放行合法最小 delta |
| pending review fixture 预置未来审计 | Fixture integrity | pending 状态删除未来/旧 review 文件；审计必须由当前 reviewer 新建 |
| reviewer FAIL 被映射成 BLOCKED | Failure semantics | 实质 FAIL 保持 review state，落 INVALID+STOP+required remediation；只有能力不可用才用 BLOCKED_CAPABILITY |
| theory witness 命令不存在但 matrix 假绿 | Verification | fixture 生成时逐项真实执行命令并比较 exit/stdout bytes/SHA-256 |
| novelty audit 引用不存在的 Table 2 | Evidence authenticity | 改用官方 PDF `§1.1 Eq. (4)` 与 `§2.1 Theorem 1`，收窄为 matched-budget evaluation contract 边界 |
| 受限环境无法重新下载固定 PDF | Reproducibility | 支持 `IPH_FIXTURE_PDF_CACHE` 离线输入，但仍强制同一 pinned SHA-256 |

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

### innovation-proposition-hunting

本轮后续关键提交包括 `a419a28`（原子 phase 语义）、`008453b`（pending review 与 sealed provenance 分离）、
`7ec04da`（高风险 claim 词扫描）和 `966f5ae`（pending gate 也验证 sealed review failure）。

### omp-research-harness

本轮后续关键提交从 `e089e1d` 的全边 agent-runnable fixture，到 `cd9de73` 的 reviewer/最小读题范围、
`744a07b` 的确定性恢复诊断。reviewer 父 task 边界、晚期连续 E2E、N0 终态 E2E 与本文档更新
已于 `13763bc` 做本地里程碑提交。其后新增的 `test:models` 真实模型逐节点回放器及其 README/测试矩阵入口
已通过 typecheck、dry-run 和全量 `bun run check`，但当前 Codex 沙箱又把 `.git` 设为只读，
`git commit` 返回 `index.lock: Operation not permitted`；这一批新增修改不得虚报为已提交。

## 发布结论

确定性本地门已满足，但真实模型最终门尚未满足：需要在模型网络恢复后用 `test:models`
重新跑 Node 17–22，并保存 M3、reviewer 与 event manager 的正式 lifecycle/model trace。当前也尚有因
`.git` 只读而无法提交的回放器及文档入口修改。
因此本轮不 push、不发布 npm，也不声称“全部生产条件稳健”。恢复两项外部能力后，顺序必须是：

1. 执行 `bun run test:models -- --fixture-root <fresh-root>`，在 fresh fixture 上真实重跑 Node 17；
2. 由同一运行器逐边重跑 Node 18–22；
3. 重跑单任务事件流与 1,101 条混合压力流，记录有/无 Flash 消融；
4. `bun run check` + 两个新增事务 E2E；
5. 本地 commit；用户实测通过后才考虑 push/npm。
