# iph 功能拆解 → omp 深度结合与调优

> 目的：把 iph 从「一个粗糙 skill」拆成可被 omp 原生承载的功能单元，标出哪些
> 靠模型自律（→ 可机器强制调优）、哪些必须保留 Python 真相源。V0.0.1 只做「立题」
> （新颖性轴 + 有效性轴），其余阶段为愿景。

## 1. iph 功能全景（fine-grained）

### 1.1 状态机（双轴，22 状态 + BLOCKED + COMPLETE）

```
新颖性轴（14）:
BOOT → SCOPE_LOCK → PRIOR_CLAIM_DRAIN → RECENT_FRONTIER → LITERATURE_REGISTER
→ L1_FREEZE → L2_TRIAGE → LAYER_DECISION → K_FULLTEXT → K_CLAIM_REGISTER
→ SYNTHESIZE_COLLISION → OUTPUT_CLAIM_BIND → EVIDENCE_VALIDATE → N0_AUDIT

有效性轴（8）:
CLAIM_FREEZE → VALIDITY_AUDIT → INDEPENDENT_REVIEW → DIRECTION_LOCK
→ COMPUTE → POSTCOMPUTE_CLAIM_FREEZE → FINAL_VALIDITY_AUDIT → FINAL_LOCK

旁路: BLOCKED（resume_state 指回）、COMPLETE（终态）
```

三段式证据深度：L1_SCOUT（零全文）→ L2_TRIAGE（摘要级）→ L3_EVIDENCE（只对 K 集合全重）。

### 1.2 门禁（14 gate，置真必须 decision_log 有对应条目）

```
scope_locked · prior_claims_drained · recent_frontier_complete ·
literature_registry_valid · l1_frozen · k_set_selected · l2_frozen ·
architecture_frozen · k_fulltext_complete · k_claims_complete ·
output_claims_traced · evidence_validated · n0_4_locked · compute_authorized
```

### 1.3 校验器（13 个 + 1 编排 + 4 迁移 + 2 辅助）

| 脚本 | 检查 |
|---|---|
| `validate_all.py` | 编排：按状态只跑到期检查；非零写 `.workflow_stop.lock` |
| `validate_schema_v2.py` | schema 版本、遗留字段、迁移路由 |
| `validate_workflow_state.py` | 双轴状态、阶段门、gate↔decision_log 交叉、计算授权 |
| `validate_claim_inventory.py` | 高风险声明出现 → 恰好绑定一个 inventory claim |
| `validate_theory_obligations.py` | 理论命题、证明责任、见证咬合力（WITNESS_NO_BITE） |
| `validate_protocol_contract.py` | 算法协议、更新语义、标签可得性、同预算比较 |
| `validate_claim_code_trace.py` | 伪代码↔实现符号↔可执行测试追溯、自证测试检测 |
| `validate_baseline_budget.py` | baseline 预算、comparator 与 algorithm claim 求交 |
| `validate_exploration_firewall.py` | 探索产物登记、哈希新鲜度、数字泄漏防火墙 |
| `validate_literature_registry.py` | 文献身份、URL 完整 |
| `validate_evidence_chain.py` | 全文归档、原子观点、输出支持、碰撞三段式 |
| `validate_frontier_integrity.py` | 前沿七轴、作者续作实名、重要性历史、证据降级 |
| `validate_artifact_hashes.py` | bundle hash、epoch、manifest role 集合 |
| `validate_audit_provenance.py` | 独立 reviewer 来源、author/reviewer 分离 |
| `migrate_v1_to_v2.py` / `migrate_v2_to_v3.py` / `migrate_claim_types.py` / `migrate_frontier_coverage.py` | 可恢复迁移 |
| `validation_common.py` / `python_test_contract.py` | 共享枚举/hash/role 辅助、测试合同 |

### 1.4 CLI 操作（8 子命令，`iph.py`）

```
validate · advance · start-collision-round · repair-collision-round ·
review · clear-lock · register-exploration · handover
```

### 1.5 退出语义

```
READY=0 · INVALID=1 · BLOCKED=2 · MIGRATION_REQUIRED=3
非零 → 写 .workflow_stop.lock → 锁内推进判 STATE_ADVANCED_UNDER_STOP_LOCK
```

### 1.6 规则（20 条 RULE-ID）

R-AUTH-01（授权非旁路）· R-COMPUTE-02（门前禁数值）· R-BLOCKED-03（BLOCKED 白名单）·
R-LOG-04（decision_log 记账）· R-N0-17（证伪优先正负同严）· R-SELFTEST-06（禁自证）·
R-EMPIRICAL-07（empirical 不升格 theorem）· R-PERSIST-08（先落盘再升级）·
R-KEY-09（密钥卫生）· R-WITNESS-10（见证咬合力）· R-FRONTIER-11（前沿七轴）·
R-BASELINE-12（baseline 无门控）· R-LAYER-13（证据深度按层）· R-SKILL-14（仓库自律）·
R-CLOSE-15（负结果合法）· R-LOG-16（日志只锚不可变产物）· R-L2-18（危险近邻表）·
R-ATOMIC-19（原子观点门槛）· R-REVIEW-20（review 实质四问）。

## 2. omp 深度结合映射

| iph 单元 | omp 原生机制 | 结合方式 |
|---|---|---|
| 状态机（22+2） | 文件态 `workflow_state.json` + session 状态 | 状态仍是 JSON 真相源；harness 用 hook 自动读/写/校验，不接管 |
| 校验器（13） | extension `registerTool` | shell out 到 Python，4 退出码 → 结构化 result；**不重写 TS** |
| CLI 8 子命令 | `registerTool` × 8 + `registerCommand`（`/iph …`） | 每个子命令一个带 schema 的工具 |
| 门禁 gate | extension hook：`session_stop` / `tool_call` | 自动 validate + 拦非法推进 |
| V3/V4 独立复核 | `task` 子代理（`iph-reviewer` 类型）+ 隔离 worktree + `agent://<id>` 身份 | 真实多 agent 身份注入 reviewer_agent_id/thread_id |
| 证据链 | `read`/`write`/`bash` + 文献 MCP | 文献检索走 MCP/Exa；三层注册仍是 JSON |
| 状态常驻 | `before_agent_start` hook | 每轮注入 active_state + next_required_action |
| STOP 锁 | `session_stop` hook + 状态文件 | 非零 → 注入唯一恢复动作续跑 |

## 3. 调优：把「事后校验」升级为「事前拦截」

这是结合的核心价值。iph 现在靠模型自律（读 SKILL.md、记得 validate、不篡改），
omp 能把其中一大半变成机器强制：

| iph 失效模式（优化计划证据） | 现状 | omp 调优 |
|---|---|---|
| 忘了跑 validate（A2–A6，事故 F3） | 模型自律 | `session_stop` hook 自动 validate，非零续跑注入恢复动作 |
| 手改 state 绕过 gate（P4 gate-gaming） | validator 事后查 | `tool_call` hook 拦对 `workflow_state.json` 的直接 edit/write，只许走 `iph_advance` |
| 独立复核伪造（P0） | reviewer_agent_id 手写字符串 | task 子代理真实身份 + 隔离 worktree + `iph review` 登记 hash |
| 主 agent 事后改 review 产物（P0） | REVIEW_ARTIFACT_TAMPERED 事后查 | hook 拦主 agent 对 `review_artifacts/` 的 write |
| 合成数据冒充真实（P1） | validator 查 data_source | compute 工具强制数据源声明 + 真实文件哈希 |
| 未授权计算（F1） | EXPLORATION_LEAK 事后查 | `tool_call` hook 拦 compute_authorized=false 时的计算命令（Q4 力度待定） |
| 「继续」时重选路径（§3 恢复纪律） | 模型自律 | `before_agent_start` hook 注入 next_required_action，锁死恢复点 |

**不变式**：校验器是唯一真相源（Python）；omp 的 hook 只做「拦」和「读」，不做
「判」——判定仍由 Python 校验器输出，TS 层只转译退出码。这条防止双实现漂移
（iph 自己的 2026-08 事故就是多副本漂移）。

## 4. V0.0.1「立题」范围边界

- **做硬**：E2 创新立题（新颖性轴 14 态）+ E3 方案冻结（有效性轴 8 态）→
  SYSTEM.md 科研人格 + `extensions/iph.ts`（工具 + 门禁 hook）+ `iph-reviewer` agent + 斜杠命令。
- **defer**（愿景，V0.0.1 不做）：E0 入口、E1 领域形成、E4 执行、E5 写作、E6 投稿
  → 暂用 skill + model + harness 自身能力。

## 5. 状态→门禁→产物→校验器 全映射（源码权威，`validate_workflow_state.py`）

进入前提来自 `STATE_PREREQUISITES`，产物来自 `GATE_ARTIFACTS`，置真来自
`GATE_COMPLETION_STATE`。

### 5.1 新颖性轴（14 态）

| 状态 | 进入前提(gate) | 产物 | 置真 gate | 主校验器 |
|---|---|---|---|---|
| BOOT | — | workflow_state.json 初始化 | — | validate_schema_v2 + workflow_state |
| SCOPE_LOCK | — | scope_lock.md + hierarchy_status.md | scope_locked | workflow_state |
| PRIOR_CLAIM_DRAIN | scope_locked | 旧观点耗尽 | prior_claims_drained | workflow_state |
| RECENT_FRONTIER | +prior_claims_drained | 近期窗口（近三年） | recent_frontier_complete | frontier_integrity |
| LITERATURE_REGISTER | +recent_frontier_complete | near_neighbor_registry.json | literature_registry_valid | literature_registry |
| L1_FREEZE | +literature_registry_valid | l1-card.md | l1_frozen | workflow_state（EVIDENCE_DEPTH_EXCEEDS_LAYER） |
| L2_TRIAGE | +l1_frozen | l2-triage.md | k_set_selected | workflow_state |
| LAYER_DECISION | scope_locked + k_set_selected | l2-card.md + contribution-architecture.md | l2_frozen + architecture_frozen | workflow_state |
| K_FULLTEXT | +l2_frozen + architecture_frozen | literature_archive/（全文+SHA256） | k_fulltext_complete | evidence_chain |
| K_CLAIM_REGISTER | +k_fulltext_complete | literature_claim_registry.json（原子观点） | k_claims_complete | evidence_chain |
| SYNTHESIZE_COLLISION | +k_claims_complete | 碰撞综合（三段式） | — | evidence_chain（ATOMIC_COLLISION_NO_ANCHOR） |
| OUTPUT_CLAIM_BIND | +k_claims_complete | output_claim_support.json | output_claims_traced | evidence_chain |
| EVIDENCE_VALIDATE | +output_claims_traced | validation.log | evidence_validated | evidence_chain + artifact_hashes |
| N0_AUDIT | +evidence_validated + l1 + l2 + arch | novelty-audit.md（证伪书） | n0_4_locked | workflow_state（FALSIFICATION_LEDGER_MISSING）+ evidence_chain |

### 5.2 有效性轴（7 态 + COMPUTE 独立轨道）

| 状态 | 进入前提 | 产物 | 等级 | 主校验器 |
|---|---|---|---|---|
| CLAIM_FREEZE | N0-4C | claim_inventory.json | V0 | claim_inventory |
| VALIDITY_AUDIT | V1 | theory_obligation_registry + protocol_contract + baseline_budget + audit_manifest | V2 | theory_obligations + protocol_contract + claim_code_trace + baseline_budget + artifact_hashes |
| INDEPENDENT_REVIEW | V2 | independent_audit.json | V3 | audit_provenance + artifact_hashes |
| DIRECTION_LOCK | N0-4C + V3 | 方向锁 | — | workflow_state |
| COMPUTE | N0-4C + V3 + compute_authorized | compute_evidence.json（S0→S4） | 计算轨道 | exploration_firewall + workflow_state（UNREGISTERED_COMPUTE_ARTIFACT） |
| POSTCOMPUTE_CLAIM_FREEZE | S4 + compute_evidence | 新 epoch claim bundle | 重建 | claim_inventory + artifact_hashes |
| FINAL_VALIDITY_AUDIT | 新 epoch | independent_audit.json（V4） | V4 | audit_provenance + artifact_hashes |
| FINAL_LOCK | N0-4C + V4 + current audit | 终锁 | 终态 | workflow_state（COMPLETE gate） |

要点：有效性轴**不用 gate**，用 `validity_level`（V0–V4）+ `independent_audit` +
`compute_authorized` 交叉核验；`SYNTHESIZE_COLLISION` 无独立 gate，碰撞结论由
`OUTPUT_CLAIM_BIND` 的 `output_claims_traced` 与 `evidence_validated` 收口。
## 6. Q4 计算门 hook 设计（已锁定：中等保守）

**触发前提**（两条同时满足才拦）：
1. `ctx.cwd` 存在 `workflow_state.json`（研究目录）；
2. `gates.compute_authorized !== true`（未获计算权）。

**拦截对象**：`tool_call`，`toolName ∈ {bash, eval}`。

**拦截规则（高信号，机械可判）**：
- 执行研究目录内 `*.py`/`*.sh`/`*.R`/`*.jl`/notebook，且路径不在 iph `scripts/`；
- `python -c` / heredoc 出现数值/统计/ML 库名：numpy、scipy、sklearn、torch、
  tensorflow、jax、pandas、statsmodels、pymc、cmdstan、regress、optim；
- 实验动词：train、fit、grid_search、cross_val、sweep、bootstrap、monte_carlo、
  simulate、run_experiment。

**白名单（放行）**：
- iph 自身：`iph.py` 全部子命令、`validate_*.py`、`migrate_*.py`（校验/迁移/记账不算计算）；
- `pytest`（iph 技能仓库测试，非研究计算）；
- 文献检索：web_search / read URL / MCP 检索 / curl 抓元数据；
- 纯文件/git/文本操作。

**逃生通道**：确需数值预实验 → `iph register-exploration`（登记为永久探索级证据，
数字不得进冻结工件）。hook 不拦它，因为它本身就是报备动作。

**推荐力度**：中等保守——拦「一眼假」（跑研究脚本 / 明显 ML import），不拦玩具命令
（`python -c "print(1+1)"`）。真泄漏由 validator（EXPLORATION_LEAK /
UNREGISTERED_COMPUTE_ARTIFACT）兜底；hook 是事前拦、validator 是事后查，两层配合。

**残余风险**：误伤「数据预处理脚本」（属探索而非实验）→ 缓解：误伤时提示走
`iph register-exploration` 报备。
