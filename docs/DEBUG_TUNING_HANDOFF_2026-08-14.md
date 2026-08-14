# Research Harness 全程 Debug 与调优交接

日期：2026-08-14  
产品仓库：<https://github.com/Robin9989Law/omp-research-harness>  
权威规则仓库：<https://github.com/Robin9989Law/innovation-proposition-hunting>  
当前产品版本：`@prcbooboo/omp-research-harness@0.0.4`  
本文基线提交：`92fb5f0`  
权威 IPH 锁：`966f5ae29e283e0510ff6967f2fbe755b0c06a49`

## 1. 交接结论

这轮工作已经从“修复一次 OMP 阻塞”扩大为对整个 Agent-native 科研工作流的系统工程重构。
当前在已定义状态空间和故障模型内，以下门均已关闭：

- 23 个正向状态、22 条正向迁移的确定性拓扑完整；
- 真实 MiniMax-M3 已分段覆盖 Node 1–22；
- Node 17–22 另在同一研究根中连续走到 `COMPLETE`；
- frontier/layer/atomic/collision specialist 使用 GPT-5.6-sol，V3/V4 reviewer 使用
  DeepSeek V4 Pro，运行时身份和实际模型均由 lifecycle 证明；
- 单任务、单任务事件流、多任务混合流与 1,101 条事件压力均已覆盖；
- READY、INVALID、BLOCKED_CAPABILITY、MIGRATION_REQUIRED、STOP、rollback、恢复和
  reviewer 防篡改均有测试；
- 真实 OMP loader、事务安装、自定义模型、package、release dry-run 与 plugin doctor 均通过；
- Node 4 与 Node 6 的真实失败没有被抹去，均保留失败证据、修复 commit 和修复后重放。

这不等于“所有未来 provider、网络故障和科研输入都绝对可靠”。更准确的结论是：当前版本已通过
定义内的系统验收，可以进入真实用户项目回放和发布后的持续可靠性采样。

## 2. 产品到底是什么

Research Harness 不是替 Agent 写论文的提示词集合，也不是另一个文献搜索工具。它是 OMP 上的科研
控制面，把权威 IPH Schema 3.0 状态机、模型角色、任务生命周期、证据合同、独立复核、计算授权和
事务回滚连接起来，使 Agent 能在不伪造状态、不跳过证据门的前提下完成创新命题狩猎。

两仓职责必须严格分离：

| 组件 | 职责 | 真相源 |
|---|---|---|
| `innovation-proposition-hunting` | 科研规则、Schema、模板、validator、N/V 语义 | Python validator |
| `omp-research-harness` | OMP 工具面、Agent 路由、生命周期、权限、事务、防篡改、可观测性 | OMP runtime + harness |
| 模型 | 阅读、推理、质疑、综合、提出动作 | 不能自证状态或权限 |

```mermaid
flowchart LR
  M3["M3：全局综合与行动责任"] --> H["Harness：观察投影与动作投影"]
  S["Specialists：独立对抗审计"] --> H
  E["Event Manager：只读事件压缩"] --> M3
  H --> V["Python Validator：机器事实裁决"]
  V -->|"READY"| T["原子状态迁移"]
  V -->|"INVALID / BLOCKED"| X["STOP + 唯一恢复动作"]
```

## 3. 用户已确认的产品决策

以下内容不是临时实现偏好，而是本轮明确形成的产品方向：

1. **M3 负责主流程。**成本低不是降低责任的理由；M3 负责全局理解、创新批判、机会成本比较、
   动态重规划和最终行动选择。
2. **不得预设 M3 笨。**M3 可能比人类更快地理解大规模上下文并从全局反推当前最佳利益点。
   工程目标是激发这种能力，不是把它降格成逐条照抄脚本的执行器。
3. **关键节点先让题面可判定。**提供必读事实、权威规则、输出合同、正例、反例和 completion proof，
   再让 M3 自己推理；“不知道如何输出”不能被误判为“不会做”。
4. **specialist 是独立对抗同伴，不是上级。**M3 可以接受或推翻专家，但必须记录
   `ACCEPTED`/`OVERRIDDEN` 和精确依据；task 完成只证明身份与生命周期，不证明结论正确。
5. **科学判断与主流程分工。**frontier、layer、atomic、collision 使用 GPT-5.6-sol；独立 V3/V4
   reviewer 使用 DeepSeek V4 Pro；commit 与主流程继续使用 M3。
6. **庞大事件流可以有管理员，但按容量触发。**DeepSeek V4 Flash 只压缩 lifecycle 事件，不读
   科研全文、不派任务、不写文件、不做科学裁决、不推进状态。
7. **测试必须是系统工程。**先整理全部节点，再逐层测试单任务、单任务事件流、任务流、异常流和
   部署流；不得“头疼医头、脚疼医脚”。
8. **失败案例永久保留。**历史失败目录不覆盖；重测从明确 baseline 开始，失败证据不得改写成 PASS。
9. **重要步骤本地 commit。**调试阶段不边改边发布；用户实测前原计划不 push/npm。本交接完成后，
   用户已进一步明确授权 push 与 npm 发布。
10. **用户可以自定义全部受管模型角色。**配置必须事务化、可 dry-run、可检测漂移、可恢复卸载，
    provider 不可用时不得静默换模型。

本轮明确保留的案例目录：

- 永久失败案例：`/Users/robinlaw/Downloads/paper1-failure-case-2`
- 初始回滚基线：`/Users/robinlaw/Downloads/论文1-pre-iph-baseline`
- 后续重测根：`/Users/robinlaw/Downloads/iph-baseline-2026-08-14`

## 4. Agent-native 核心范式

### 4.1 Agent 才是直接用户

传统软件主要优化人类界面的可读性；本产品的直接用户会自行规划、调用工具、委派任务、读取外部数据
并修改状态。产品接口因此必须让以下事实机器可见且不可伪造：

- 当前 state、target、gate、N/V level、epoch；
- STOP 是否存在、BLOCKED 的具体能力和唯一恢复动作；
- task 是 started、message、completed、failed 还是 aborted；
- specialist 的 agent/session/research-root/target/model 身份；
- 哪些文件是可变 state pointer，哪些是不可变 decision evidence；
- 每次动作前后的 state、artifact hash、validator exit 和 rollback 结果。

自然语言用于解释和推理，不能承担权限、完成、身份或状态真相。

### 4.2 概率性策略，确定性副作用

模型拥有开放推理空间；harness 只约束外部副作用：

```text
模型提出动作 → harness 校验身份/状态/合同 → validator 判机器事实 → 原子提交或完整回滚
```

这条边界非常重要。过度脚本化会压制 M3 的全局反推和创新能力；完全信任自然语言又会制造跳态、
伪身份、假 PASS 和半提交。正确设计是高带宽世界模型加窄而确定的写通道。

### 4.3 READ → REASON → ACT

关键节点的 transition plan 应让 M3 在行动前获得：

1. 当前题面和唯一目标态；
2. 必读状态与证据；
3. 权威规则和禁止事项；
4. 必需工件与字段形状；
5. 最小正例和典型反例；
6. specialist 的边界与 completion proof；
7. strict validator 和提交后的唯一相邻 next action。

这些内容是能力激发，不是替 M3 得出科研结论。M3 仍应跨节点理解全局、质疑专家和比较信息增益，
但一次只能提交一条状态边。

### 4.4 错误是下一步 API

错误输出必须包含 observed state、责任层、issue code、是否 rollback 和唯一可执行恢复动作。同一
state hash 与同一失败码不得盲目重试；先保存证据并修复根因。

## 5. 当前角色与模型路由

当前默认配置来自 `config/model-roles.yml`：

| role | 模型 | 职责 |
|---|---|---|
| `default` | `minimax-code-cn/MiniMax-M3:high` | 主协调、全局综合、创新批判、行动选择 |
| `frontier` | `openai-codex/gpt-5.6-sol:high` | 最近前沿、身份门、覆盖轴、近邻审计 |
| `layer` | `openai-codex/gpt-5.6-sol:high` | L1/L2/贡献架构裁决 |
| `atomic` | `openai-codex/gpt-5.6-sol:high` | 原子观点提取 |
| `collision` | `openai-codex/gpt-5.6-sol:high` | 文献碰撞与证伪综合 |
| `review` | `deepseek/deepseek-v4-pro:high` | 独立 V3/V4 复核 |
| `event` | `deepseek/deepseek-v4-flash:low` | 只读事件状态压缩 |
| `commit` | `minimax-code-cn/MiniMax-M3:high` | Git commit message |

实际模型只认 task lifecycle 中的 `resolvedModel` / `model_change`。`task` 参数没有 model 字段是角色
路由的正常接口，不代表回退；元数据不可见时只能报告 `UNKNOWN`。

自定义模型通过 `install-user-config.sh configure --roles-file ...` 完成。配置器只管理上述八个角色，
其他 OMP 角色保持不变；支持 `--dry-run`、漂移检查、事务回滚和恢复卸载。

## 6. 状态机与责任分配

| Node | source → target | 责任主体 |
|---:|---|---|
| 1 | BOOT → SCOPE_LOCK | M3 |
| 2 | SCOPE_LOCK → PRIOR_CLAIM_DRAIN | M3 |
| 3 | PRIOR_CLAIM_DRAIN → RECENT_FRONTIER | frontier-auditor |
| 4 | RECENT_FRONTIER → LITERATURE_REGISTER | frontier-auditor |
| 5 | LITERATURE_REGISTER → L1_FREEZE | layer-adjudicator |
| 6 | L1_FREEZE → L2_TRIAGE | layer-adjudicator |
| 7 | L2_TRIAGE → LAYER_DECISION | layer-adjudicator |
| 8 | LAYER_DECISION → K_FULLTEXT | M3 |
| 9 | K_FULLTEXT → K_CLAIM_REGISTER | atomic-claim-extractor |
| 10 | K_CLAIM_REGISTER → SYNTHESIZE_COLLISION | collision-synthesizer |
| 11 | SYNTHESIZE_COLLISION → OUTPUT_CLAIM_BIND | M3 |
| 12 | OUTPUT_CLAIM_BIND → EVIDENCE_VALIDATE | M3 |
| 13 | EVIDENCE_VALIDATE → N0_AUDIT | M3 |
| 14 | N0_AUDIT → CLAIM_FREEZE | M3 |
| 15 | CLAIM_FREEZE → VALIDITY_AUDIT | M3 |
| 16 | VALIDITY_AUDIT → INDEPENDENT_REVIEW | M3 |
| 17 | INDEPENDENT_REVIEW → DIRECTION_LOCK | iph-reviewer |
| 18 | DIRECTION_LOCK → COMPUTE | M3 + 明确用户授权 |
| 19 | COMPUTE → POSTCOMPUTE_CLAIM_FREEZE | M3 |
| 20 | POSTCOMPUTE_CLAIM_FREEZE → FINAL_VALIDITY_AUDIT | M3 |
| 21 | FINAL_VALIDITY_AUDIT → FINAL_LOCK | iph-reviewer |
| 22 | FINAL_LOCK → COMPLETE | M3 |

N0-1 与 N0-2 是合法负面终局，N0-3 是 HOLD；不得为了到 `COMPLETE` 而把失败候选包装成 N0-4C。
计算门仍是 `N0-4C AND V3 AND compute_authorized`，用户授权不旁路前两项。

## 7. 必须保持的失败语义

| 结果 | 含义 | 状态动作 |
|---|---|---|
| `READY = 0` | 当前机器合同满足 | 才能提交计划中的相邻边 |
| `INVALID = 1` | 已有工件或主张违反合同 | STOP；保留证据，按唯一 remediation 修复 |
| `BLOCKED = 2` | 具体外部能力不可用 | `BLOCKED_CAPABILITY`；可进入 BLOCKED 并登记 resume_state |
| `MIGRATION_REQUIRED = 3` | Schema 版本不兼容 | 只允许受控迁移 |

科学或 reviewer 的实质 FAIL 不是能力缺失：

- reviewer FAIL 保持 `INDEPENDENT_REVIEW`/`FINAL_VALIDITY_AUDIT` 和当前 V-level；
- 其他 specialist FAIL 保持当前 gate 和 V-level；
- 两者都写不可变 failure artifact、machine-readable remediation、`INVALID+STOP`；
- 只有 agent/provider/全文访问等具体能力不可用才是 `BLOCKED_CAPABILITY`。

STOP 期间禁止推进状态。修复唯一恢复动作后由受控工具清锁；不得手改 `workflow_state.json`、
`validation.log` 或 `.workflow_stop.lock`。

## 8. Debug 方法与测试分层

本轮采用 `Detect → Attribute → Repair → Rerun`，按首错即停逐层提高真实性：

1. 静态拓扑与 Python/TypeScript 状态集合；
2. 单节点/单任务确定性 fixture；
3. 单任务真实 lifecycle；
4. 多任务、optional、stale、冲突和乱序事件流；
5. 1,101 条事件风暴；
6. STOP/BLOCKED/rollback/防篡改故障注入；
7. 真实 OMP 完整插件加载；
8. 真实 M3 与 specialist 节点回放；
9. 安装、配置漂移、卸载、package 与 release dry-run。

测试装载方式本身属于产品。源码真实重放必须同时加载：

- `--plugin-dir <repo>`：agents、SYSTEM 和资源；
- `--extension <repo>/extensions/iph.ts`：13 个 `iph_*` 工具和安全 hooks。

只加载其中一个会制造“agent 有但工具无”或“工具有但 agent 无”的假故障，不能据此评价产品。

## 9. 关键缺陷、根因与修复

| 现象 | 根因 | 修复 |
|---|---|---|
| frontier-auditor 无法指派 | agent discovery/角色装载不完整 | 完整 plugin root 加载，角色显式受管并做真实 lifecycle 测试 |
| strict schema 连续 `Expected ']'` | M3 生成的长 caller schema 在接口层截断 | specialist task 自动移除 `outputSchema/schemaMode`，只保留最小 task 合同 |
| M3 调用不存在的 `ipc_call` | 关键工具注册但不在模型可见工具面 | 13 个 `iph_*` 工具全部 essential，真实 loader 断言可见 |
| PASS 消息后仍阻塞 | message 被误当 completion，或 completion 晚到 | lifecycle 单调化；等待正式 completed；身份绑定 root+target |
| headless reviewer 无身份 | in-memory subagent 没有 session file，认证只认文件路径 | 用 live AgentRegistry/sessionManager 认证，session file 仅作持久化 fallback |
| reviewer 新证据被父 task 回滚 | 子工具事务与父 task 快照边界不一致 | 父边界重验 reviewer identity、同态 state、bundle/review hash 和最小 delta |
| reviewer task 获得过宽写权限 | 只按“父任务声明 reviewer”豁免 | 收紧到唯一 reviewer、当前 gate、只允许新增唯一 review JSON；既存证据永久只读 |
| reviewer FAIL 被写成 BLOCKED | 科学失败和能力不可用混用 | FAIL 保持原 gate/V-level 并落 INVALID+STOP；能力缺失才 BLOCKED |
| 非 reviewer specialist FAIL 无闭环 | `iph_advance` 只有正向或 BLOCKED 语义 | 增加 same-state specialist FAIL 事务与不可变 failure artifact |
| BLOCKED 自动续跑/反复清锁 | session_stop 未区分终止锁 | STOP/BLOCKED 不自动 continue；显式 `resumeBlocked` 恢复 |
| gate 与 recent window 不一致 | state 与 registry 分开写 | 权威 CLI 在同一事务同步窗口并 post-validate |
| false-first 被理解为 JSON 排序 | 自然语言合同不够精确 | 定义为证伪义务；FAIL 必须引用规则/schema/validator，不造门禁 |
| 预印本被当同行评审证明 | URL 被当作非空字段而非认识论角色 | URL ledger 绑定证据角色，版本化修复并保留旧 hash |
| ledger 文件存在但 state 未指向 | validator 隐式猜文件名 | gate 强制活动 artifact pointer，提供原子 pointer repair |
| M3 会推理但不会构造可接受输出 | transition plan 缺 output contract | 加入题面、必读证据、正反例、gate assignments、相邻 next action |
| M3 在 L2 猜 contribution/跳 nextAction | 目标态合同含糊 | 写前拒绝 future gate、错误 contribution 和非相邻 next action |
| 多任务第一项完成后其余绑定丢失 | dispatch 生命周期过早清理 | 任务批次绑定保留到 session 结束 |
| Flash 身份被错误归给 layer | 自由文本承载模型 provenance | 只从认证 session 读取实际模型；rationale 禁止自报模型 |
| theory witness 文件不存在仍假绿 | validator 只核历史输出/hash，未执行命令 | fixture 生成时真实执行五条命令并核对 exit/stdout/stderr/SHA-256 |
| novelty audit 引用不存在的 Table 2 | fixture 伪造 locator/错误概括在线更新 | 改用官方 PDF `§1.1 Eq. (4)`、`§2.1 Theorem 1` 并收窄边界 |
| Node 4 缺引用图证据 | 只声称覆盖，没有 query/filter/date/hit count | 补官方 bibliography 后向遍历与 OpenAlex 前向查询；GPT-5.6-sol 重审 |
| Node 6 返回 READY 后状态回退 | `write(path=xd://iph_advance)` 被父防火墙当普通写入 | 精确白名单识别 `xd://iph_*` 底层事务，其他 write 仍保护 |
| npm dry-run 被用户 cache 权限阻塞 | `~/.npm` 有历史 root-owned 文件 | release/package 使用自动清理的隔离 cache，不触碰用户缓存 |
| CI/release 使用旧 IPH commit | workflow 复制了一份 lock 值，产品锁升级后发生双写漂移 | workflow 运行时直接读取 `config/iph-lock.json`；package check 拒绝硬编码 commit |

完整 30 类可执行故障注入见 [SYSTEM_TEST_MATRIX.md](../SYSTEM_TEST_MATRIX.md)。详细过程见
[DEBUG_RETROSPECTIVE_2026-08-14.md](DEBUG_RETROSPECTIVE_2026-08-14.md)。

## 10. M3 调优结论

本轮最重要的认知纠偏是：问题多次不是“M3 不会”，而是 M3 看不到完整世界模型，或不知道怎样把正确
理解编码为 validator 接受的工件。

支持这一结论的轨迹包括：

- M3 在活动 ledger 指针缺失时拒绝无根修复，反而暴露 validator/状态绑定缺口；
- agent 类型不可见时没有伪造 specialist identity；
- specialist 只有 PASS 消息、没有 completion 时选择等待；
- briefing 补齐后，能一次构造正确 gate、contribution、next action 和 disposition；
- frontier-auditor 的实质拒绝发现了 fixture 自己缺少引用图证据，而不是“阻碍流程”。

因此后续调优应优先做 scaffold 消融，而不是继续增加步骤：

- 步骤脚本 vs 目标+不变量；
- 原始长上下文 vs 决策状态投影；
- specialist 权威裁定 vs 独立对抗同伴；
- 局部节点视野 vs 全局推理+单事务提交。

比较指标应包括最终机器状态正确率、无效工具调用、token/时延、规则冲突发现率、可复用新洞见和
validator 拒绝率。只保留既提高可靠性、又不压制 M3 全局推理的约束。

## 11. 事件流管理员结论

DeepSeek V4 Flash 的价值是降低主协调者在庞大事件流中的注意压力，不是替 M3 做研究或调度。

| 条件 | 结果 |
|---|---|
| 无管理员 | M3 可完成低容量流程，少一次模型调用 |
| Flash 与工作任务同时启动 | 只能看到早期 `CURRENT_STARTED`，不能证明最终完成 |
| 事件积累后、迁移前调用 | 可准确压缩 current/optional/stale/conflict，并减少无效动作 |
| 1,101 条确定性压力流 | 正确区分 1 current completed、1,000 optional、100 stale |

最终策略：1–3 个简单任务由 M3 直接处理；事件数量、乱序、历史/stale 或 optional 噪声超过注意带宽时，
harness 先生成确定性 event projection，再让 Flash 摘要。Flash 没有 task、write、validate 或 advance 权限。

## 12. 当前验证证据

### 12.1 最终本地门

- 权威 IPH：450/450 Python `unittest` 通过；
- Harness：48/48 Bun 测试通过；
- system matrix：23 states、22 transitions、30 executable failure injections；
- full-node deterministic：22/22 正向边，N0-1/N0-2、N0-3 HOLD、Node 18–22 连续流通过；
- `omp_e2e=READY`，13 个工具、lifecycle、rollback、reviewer provenance 通过；
- `install_e2e=READY`，dry-run/install/configure/upgrade/rollback/uninstall 通过；
- `package_e2e=READY`；
- `release_check=READY`，使用隔离 npm cache，`publish=not_run`；
- `omp plugin doctor`：4 ok、0 warning、0 error。

最近一次 dry-run 包体：约 80.8 KB 压缩、247.9 KB 解包，不是 800 MB。测试 fixture、session 和原始
研究证据不进入 npm 包。

### 12.2 真实模型证据

完整哈希与路径见 [FULL_NODE_EVIDENCE_2026-08-14.md](FULL_NODE_EVIDENCE_2026-08-14.md)。摘要：

| 范围 | 证据 |
|---|---|
| Node 1–3 | M3 + Node 3 GPT-5.6-sol frontier |
| Node 4 | 修复引用图证据后 GPT-5.6-sol strict 0 |
| Node 5 | GPT-5.6-sol layer |
| Node 6 | 修复 xd 事务后 GPT-5.6-sol strict 0 |
| Node 7–10 | layer/atomic/collision GPT-5.6-sol |
| Node 11–16 | M3 |
| Node 17–22 | 同一研究根连续流；Node 17/21 DeepSeek V4 Pro；最终 COMPLETE |

原始 evidence manifest 目前保留在 `/tmp/iph-real-model-*20260814*/evidence.json`。仓库内文档保存其路径、
摘要和 SHA-256；换机或清理 `/tmp` 前，如需长期保留完整原始 session，应另行归档到受控、不进入 npm
包的证据存储。不得因原始文件迁移而改写已登记 hash。

## 13. 为什么完整流程需要数小时

全量真实 22 节点不是普通单元测试。多个科学节点需要独立模型阅读证据、搜索/核验文献、生成工件、
正式 completion、strict validate 和状态提交；单个 specialist 常需 5–20 分钟，串行全跑通常 1–3 小时。

最终测试金字塔：

1. 每次提交：`bun run check` + pinned PDF 的 `bun run test:nodes`；
2. 某节点实现/prompt/合同变化：只跑 `--from-node N --to-node N`；
3. reviewer/compute 控制面变化：连续跑 Node 17–22；
4. 模型路由、OMP lifecycle、插件装载或发布候选变化：完整 `--all-nodes`，可按节点分片；
5. 首次失败保留，修复后从失败节点重放，不重做未受影响的昂贵节点。

这解释了为什么 Node 17–22 已完成后不应再次重复运行。发布前仍需要确定性全门和 release dry-run，
但不应把完整真实模型串行回放放进每个 commit。

## 14. 接手后的标准操作

### 14.1 快速健康检查

```bash
cd /Users/robinlaw/Downloads/科研harness
git status --short
bun run check
bun run release:check
omp plugin doctor @prcbooboo/omp-research-harness
```

需要确定性 22 节点时：

```bash
bun run test:nodes -- --pdf-cache /absolute/path/to/pinned-W-0001.pdf
```

只重放受影响的真实节点：

```bash
bun run test:models -- \
  --fixture-root /tmp/iph-agent-node-fixtures-full.<id> \
  --all-nodes --from-node 6 --to-node 6
```

源码 OMP 调试必须走：

```bash
npm run debug:omp -- -p \
  --model minimax-code-cn/MiniMax-M3 \
  --thinking high --approval-mode yolo \
  --cwd /absolute/research/root \
  "先调用 iph_status 和 iph_transition_plan，只完成当前状态。"
```

### 14.2 调试纪律

- 先保存 session、state hash、STOP、validation log 和调用序列；
- 先归因到 Execution、Tool Interface、Context、Lifecycle、Observability、Verification 或 Governance；
- 修最小责任层，不先大改 prompt；
- 修复后跑受影响节点，再跑确定性总门；
- 重要修复独立本地 commit；
- 不 reset、覆盖或清理用户项目中的历史失败产物；
- 不把 token、API key 写入仓库、日志、交接或 decision artifacts；
- 不用 `sudo npm`，不修改用户 `~/.npm` 权限来绕过问题。

### 14.3 研究工作流纪律

- 每回合先 `iph_status`，再 `iph_transition_plan`；
- 一次只提交一个相邻 target；
- 允许全局思考，但禁止跳态副作用；
- specialist 正式完成后仍需 M3 记录 disposition；
- 非零 validator 结果立即 STOP；
- 同一 state hash + 同一失败不重复碰运气；
- BLOCKED 只用于真实能力缺失；科学 FAIL 保持同态 INVALID；
- 未达 N0-4C、V3 且未获用户授权时禁止研究计算。

## 15. 发布交接

发布前必须同时满足：

- 产品仓库与权威 skill checkout clean；
- `config/iph-lock.json` commit 与所有文件哈希匹配；
- README 的手动安装 commit 与 lock 一致；
- `bun run check`、`bun run release:check`、plugin doctor 通过；
- package version 尚未存在于 npm；
- GitHub push 与 npm publish 分别成功；
- 发布后重新查询 npm `latest`、版本、repository、dist integrity；
- 不在命令、tracked `.npmrc`、日志或交接文档中记录 access token。

本轮交接审计发现并修正了三类发布漂移：README 手动安装仍指向旧 IPH commit、两处仍写“七个”
受管角色，以及 CI/release workflow 仍复制更旧的 commit。当前权威值为 lock commit `966f5ae...`、
八个受管角色；workflow 以后直接读取 lock，不再维护第二份 commit。

## 16. 尚未关闭的长期改进

以下不是当前发布阻塞项，但应进入下一阶段可靠性工程：

1. 对同一节点做 `R(k, ε, λ)`：重复采样、同义提示、顺序扰动、超时/限流/schema 漂移；
2. 建立标准 trace IR，自动关联责任步骤、harness 层、state delta 和修复 commit；
3. 为写工具增加跨进程持久化 idempotency key；
4. 增加间接 prompt injection、恶意工具输出和不可信网页指令测试；
5. 每次 OMP/MCP lifecycle 版本升级做兼容性合同测试；
6. 把真实模型 evidence manifest 从临时目录归档到独立、受控且不随 npm 发布的证据存储；
7. 定期复做 event-manager 消融，确认 Flash 的额外调用成本仍小于它减少的协调成本；
8. 用真实新项目和已有项目重立题各做一次用户验收，不只使用合成 fixture。

## 17. 最终原则

> 不要把 M3 当成需要被脚本牵着走的弱执行器。给它完整、可验证、低歧义的世界模型，让它承担全局
> 综合、创新批判和行动责任；让 specialist 提供独立对抗，让 validator 裁决机器事实，让 harness
> 只控制身份、生命周期、证据和副作用。系统的价值不是让每一步看起来顺利，而是让正确结论、负面
> 结论和真实阻塞都能被准确区分、保留、恢复和复现。

相关文档：

- [README](../README.md)
- [Agent-native 软件工程准则](../AGENT_NATIVE_ENGINEERING.md)
- [系统测试矩阵](../SYSTEM_TEST_MATRIX.md)
- [全节点真实模型证据](FULL_NODE_EVIDENCE_2026-08-14.md)
- [系统调试复盘](DEBUG_RETROSPECTIVE_2026-08-14.md)
