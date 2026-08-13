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
| E2/L3 | LAYER_DECISION → K_FULLTEXT → K_CLAIM_REGISTER | M3 + atomic / GPT-5.6-sol | 只对 K 集合取全文和原子观点 |
| E2/collision | K_CLAIM_REGISTER → SYNTHESIZE_COLLISION → OUTPUT_CLAIM_BIND | atomic + collision / GPT-5.6-sol | evidence→reasoning→statement、输出绑定 |
| E2/audit | OUTPUT_CLAIM_BIND → EVIDENCE_VALIDATE → N0_AUDIT | M3 | 证伪书与 N0 正/负终态 |
| E3/precompute | N0_AUDIT → CLAIM_FREEZE → VALIDITY_AUDIT → INDEPENDENT_REVIEW → DIRECTION_LOCK | M3 + review / DeepSeek V4 Pro | N0-4C、V1/V2、运行时绑定 V3 |
| E4 | DIRECTION_LOCK → COMPUTE → POSTCOMPUTE_CLAIM_FREEZE | M3 | 用户授权不旁路 N0-4C/V3，S4 后新 epoch |
| E3/final | POSTCOMPUTE_CLAIM_FREEZE → FINAL_VALIDITY_AUDIT → FINAL_LOCK → COMPLETE | review / DeepSeek V4 Pro + M3 | 当前 bundle 的 V4 与最终锁 |

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
| F11 | 工具已注册但未挂到模型可见工具面 | 11 个 IPH 工具全部 essential | 真实 OMP loader 可见性断言 + M3 回合 |
| F12 | specialist 先发 PASS 消息、正式 completion 尚未落地 | 身份门识别 started 并短暂等待正式 completion；凭证绑定 research root + target | lifecycle 竞态单测 + 真实 M3 单节点重放 |
| F13 | specialist 从模糊术语创造不存在的 JSON 排序约束 | FAIL 必须引用精确规则/schema/issue；明确 false-first 与 OCCUPIES 极性 | agent 合同断言 + 真实 GPT-5.6-sol 失败轨迹 |
| F14 | specialist 已产出 READY gate，却把正式 completion 时间用于无界可选检索 | gate closure 与 exploration 分离；超时身份不可复用，draft 可由新任务复核续接 | agent 合同断言 + 15 分钟真实超时轨迹 + 续接重放 |

## 4. 分层测试顺序

每次升级固定按以下顺序执行，首错即停，不清锁重试：

```text
L0 静态：typecheck + topology audit + doc/version scan
L1 单元：bun test + Python unittest/pytest
L2 组件：真实 OMP loader/tool/hook E2E
L3 恢复：STOP/BLOCKED/rollback 故障注入
L4 部署：install transaction + package contents + plugin doctor
L5 真实模型：M3 可跨节点做全局推理，但每回合只提交一个合同事务；指定 specialist 独立复核
L6 能力激发：对步骤脚本/目标不变量、原始上下文/状态投影、权威专家/对抗同伴做 scaffold 消融
```

M3 每一步先 `iph_status`、再 `iph_transition_plan`；可以分析全局路径、质疑计划和比较信息价值，
但一次只能提交计划中的一个 target。
同一 state hash + 同一失败码不得第二次调用 validate/clear-lock。失败时保存 session、
state hash、STOP lock、validation log 和工具调用序列，回到对应层修复后再重放。

L6 不把单次成功率当作唯一指标，还记录无效工具调用、token/时延、规则冲突发现率、可复用新洞见和
validator 拒绝率。测试结果用于删除压制 M3 全局推理的冗余步骤，并保留能提高事实质量和副作用安全的
最小 scaffold。

## 5. 面向 Agent 用户的工程约束

本产品的直接用户是 Agent。自然语言说明只是辅助界面，真正的产品合同必须满足：

- 状态、锁、身份、完成度和下一动作均为机器可判定字段；
- 已发送消息不等于任务完成，自报 ID 不等于运行时身份；
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
