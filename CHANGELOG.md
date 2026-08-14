# Changelog

## Unreleased

- transition plan 现在明示目标态 contribution 合同和提交后的唯一相邻 target；`iph_advance`
  在任何写入前拒绝 L1/L2 贡献越层及跳态 `nextAction`。
- 子代理实际模型身份只接受运行时 `resolvedModel` / `model_change`；`task` 无 model 参数是
  正常的角色路由接口，不再被误报为回退到默认模型。
- 新增 `scripts/run-local-omp.sh` / `npm run debug:omp`，以 `--plugin-dir` 成套加载本地工具、
  agents 与 SYSTEM；系统矩阵拒绝会制造半装载假故障的 `-e` / `--no-extensions` 调试入口。

## 0.0.4 - 2026-08-14

- 将 M3 明确定义为全局综合与创新批判的责任主体，而不是弱调度器：确定性合同只限制
  副作用，不限制思考空间；specialist 是独立对抗同伴，scaffold 改动需做能力激发消融。
- specialist 完成身份不再暗示结论权威；专属迁移门要求 M3 显式记录
  `ACCEPTED` 或 `OVERRIDDEN` 及证据/规则/validator 理由。
- transition plan 增加 `READ → REASON → ACT` 节点 briefing：必读证据、权威参考、
  输出合同、最小正反例和 completion proof，减少 M3 因输出不可构造而徘徊。
- task lifecycle 改为单调事件流：终态不得被延迟/ 重复 `started` 或冲突终态回退，
  乱序终态保留已认证的 research root 与 target 绑定。
- 新增只读 `event-flow-manager` 与 `iph_event_snapshot`：先确定性投影当前/终态/过期/冲突事件，
  再由 DeepSeek V4 Flash low 向 M3 提供无副作用的压缩摘要。
- transition plan 返回精确 target gate assignments；`iph_advance` 在写入前拒绝缺失 gate 或
  属于未来状态的 gate，修复 L2_TRIAGE 语义误导。
- 分离 gate closure 与开放探索预算：validator READY 后 specialist 先正式完成；超时 draft
  可由新任务复核续接，但 stale identity 不可用于推进。
- URL verification 改为证据角色合同而非 distinctness 计数；预印本不得证明同行评审，
  活动 URL ledger 通过版本化 state pointer 修订并保留旧哈希。
- 新增 `iph_repair_artifact_pointer`，在不覆盖历史证据的前提下原子切换版本化修正版；
  新旧路径与 SHA-256 进入审计日志，验证失败全量回滚。
- 修复 specialist completion 竞态：PASS 消息早于正式 `yield` 时，迁移门会等待正式
  lifecycle completion；身份凭证同时绑定研究根与目标状态，不能跨项目或跨节点复用。
- 系统矩阵增加 Agent-native 工程合同和 Python/TypeScript 状态集合交叉校验，防止双实现漂移。
- 收紧 frontier-auditor 语义合同：false-first 不等于 JSON 排序，OCCUPIES 是最强负面；
  specialist FAIL 必须引用权威规则、schema 字段或 validator issue，不能临时创造门禁。
- 增加 23 节点/22 迁移的系统拓扑审计与 16 类故障注入矩阵，缺边、错向、专家路由
  漂移和 mutable artifact 错误冻结会在测试阶段失败。
- 修复 `recent_frontier_complete=true` 时 state 时间窗未同步：权威 CLI 现在从本次
  登记的 literature registry 校验并原子同步 `recent_window`。
- 增加 `iph_clear_lock.resumeBlocked`：operator 修复外部阻塞后可事务化恢复到
  `resume_state`；恢复验证失败时 state、STOP lock 与 validation log 全部回滚。
- STOP 锁或 committed BLOCKED 状态不再触发 `session_stop` 自动续跑，消除 M3 的
  validate/clear-lock 循环。
- `iph_status` 和 `iph_transition_plan` 明示 `stopLockActive` 与锁摘要，消除模型从
  缺失字段误判锁状态的问题。
- 13 个 IPH 工具全部标记为 coordinator essential；修复扩展注册了 `iph_clear_lock`
  但 M3 实际工具面不可见的恢复死锁。
- 权威 IPH 锁升级到 `1f7df5134683cc1e65d375da831bd64ec708a999`。

- M3 remains the default coordinator, while new `frontier` and `layer` roles route the two
  early scientific judgment gates to GPT-5.6-sol.
- Added `iph_transition_plan`, specialist task provenance enforcement, immutable protection
  for decision-log artifacts, and automatic rollback when target-state validation fails.
- Transition planning now covers the complete positive path, preserves N0-1/N0-2 as terminal
  outcomes, and rejects mutable state-pointer files passed as immutable decision-log hashes.
- User-config status now detects roles added after the original install, and the transactional
  `upgrade` action synchronizes new roles and SYSTEM without losing the uninstall restore point.
- A deliberate transition to `BLOCKED` now commits state and STOP lock on its expected exit 2;
  only invalid target-state transitions are rolled back.
- Added a real read-only `iph_status` tool, renamed the generic result header to
  `iph_result_status`, and made specialist dispatch strip caller-generated `outputSchema` /
  `schemaMode` so M3 cannot break task preflight with truncated schemas.
- Runtime guidance now requires direct `iph_*` calls and explicitly forbids hallucinated
  wrappers such as `ipc_call`.

## 0.0.3 - 2026-08-13

- 原子观点与文献碰撞默认模型恢复为 OMP `openai-codex/gpt-5.6-sol:high`；独立复核继续使用 DeepSeek V4 Pro。
- commit 角色改用 MiniMax M3，与默认主流程共用模型，避免不必要的模型切换。
- 修复状态推进只记录 `decision_log` 哈希、未登记顶层 artifact 路径而导致的
  `BOOT → SCOPE_LOCK` post-validation STOP。
- `iph_advance` 现在原子提交路径指针、不可变哈希、gate、下一动作与状态迁移。
- `iph_clear_lock` 增加受控 artifact-map 与 stale next-action 恢复，不再需要手改
  `workflow_state.json` 或删除 STOP 锁。
- 权威 IPH 更新并锁定到 `6c3173d9c6cf1ce7bf727e9680cb9fe4d63936e6`。

## 0.0.2 - 2026-08-13

- 将 npm repository 元数据规范化为 canonical git URL。
- npm 发布工作流移除长期 token，只允许受审批的 GitHub OIDC trusted publisher。
- package publishing access 强制 2FA，并拒绝传统 token 直接发布。
- release dry-run 改为 registry-safe 打包验证，可在版本已发布后重复运行。

## 0.0.1 - 2026-08-13

- npm 发布坐标确定为 `@prcbooboo/omp-research-harness`。
- 接入 innovation-proposition-hunting Schema 3.0 状态机，固定权威上游提交和内容哈希。
- 增加 BOOT、状态推进、独立复核、探索登记、碰撞修复与 strict validate OMP 工具。
- 将 reviewer 身份绑定到真实 OMP subagent lifecycle，并保护研究状态与复核证据不被旁路篡改。
- 增加最近研究根发现、生命周期薄指针验证、计算权门禁和 STOP 恢复动作。
- 增加事务化用户配置安装、漂移检测、故障回滚及可恢复卸载。
- 增加 TypeScript、单元测试、真实 OMP loader、安装/打包 E2E、插件 doctor 和权威 IPH
  完整回归 CI。
- 增加受审批保护的 npm trusted publishing/provenance 手动发布流程。
- 原子观点、文献碰撞与独立复核统一路由到已完成真实调用验收的 DeepSeek V4 Pro。
- 开放五个 harness 模型角色的 YAML/JSON、CLI 覆盖和事务化在线重配置。
