# 科研生命周期框架 — 可扩展 7 阶段骨架

> 愿景：E0–E6 七阶段科研生命周期。V0.0.1 深做 E2/E3（立题），其余阶段搭骨架、
> 预留扩展接口。参考：LangGraph（图=节点+持久状态+回环）、Dify/n8n（节点统一
> 输入/输出契约）、CrewAI/gpt-researcher（角色=可插拔 agent）、SciSpace/Elicit
> （多阶段覆盖）。

## 1. Stage 接口（统一契约，扩展的载体）

每个阶段 = 一个可注册的节点：

| 字段 | 含义 |
|---|---|
| `id` / `name` / `目标` | 标识与职责 |
| `entry` | 前置阶段 + 输入契约 |
| `exit` | 产物契约 + 门禁 |
| `impl` | `deep`（原生状态机）\| `skeleton`（skill + model + harness） |
| `loop_back` | 结果推翻时可回退的阶段 |

## 2. 七阶段图（含回环）

```
E0 入口 → E1 领域形成 → E2 创新立题 → E3 方案冻结 → E4 执行 → E5 写作 → E6 收尾/投稿
                            ↑               ↑            │
                            └───────────────┴────────────┘
                            loop-back：
                              E4 结果推翻命题 → 回 E2/E3（新 epoch）
                              E5 写作漂移     → 回 E3（措辞超 claim bundle）
```

## 3. 阶段表

| 阶段 | 目标 | impl | 门禁 | 深度 |
|---|---|---|---|---|
| E0 入口 | 主题 + 交付目标 → 入口卡 | 引导模式（ask + SYSTEM.md） | 成果类型明确 | 骨架 |
| E1 领域形成 | 主题 → 可研究领域 + 初步文献 | web_search + literature skill | 研究链连续性、非关键词堆砌 | 骨架 |
| E2 创新立题 | L1→L2→L3，N0 新颖性裁决 | iph 新颖性轴（14 态） | n0_4_locked | 深（V0.0.1） |
| E3 方案冻结 | 冻结 exact claim + 实验设计 | iph 有效性轴（8 态） | DIRECTION_LOCK | 深（V0.0.1） |
| E4 执行 | 初步实验 → 系统实验 | iph compute 漏斗（S0–S4） | COMPUTE = N0-4C AND V3 AND authorized | 骨架（spec 已有，defer） |
| E5 写作 | 初稿 → 润色 | qinyan-nature-polishing / qinyan-paper-polish | 写作一致性门（措辞 ≤ claim bundle） | 骨架 |
| E6 收尾/投稿 | 成稿核对 + 投稿 | handover + 投稿清单 | 稿件↔claim↔证据链终检 | 骨架 |

## 4. 扩展接口（预留）

1. **新阶段**：注册 Stage 定义（entry/exit/impl/loop_back）→ 插入图。impl 可为
   skill / 自定义 tool / subagent / 原生状态机。
2. **新方法**：一个阶段内可注册多个 impl（E2 现有「iph 方法」，未来可挂「XX 方法」），
   按需切换，不重写框架。
3. **新回环**：声明 loop_back 边（如未来 E6 拒稿 → 回 E5/E3）。

## 5. 状态承载

- `lifecycle_state.json`：`active_stage` + 各阶段状态指针。
- 深阶段（E2/E3）用 iph `workflow_state.json`（schema 3.0）作子状态；
  骨架阶段用产物指针（如 E5 → `draft.md`、E6 → 投稿清单）。
- 阶段门禁由 `extensions/iph.ts` 的 hook 读取 `lifecycle_state.json` 强制执行；
  骨架阶段门禁先靠 model 自律 + 产物存在性，后续再机器化。

## 6. 与 V0.0.1 交付物的关系

V0.0.1 交付物新增两项：

- `LIFECYCLE.md`（本文件）：阶段注册表 + 图 + 扩展契约。
- `lifecycle_state.json` schema：阶段指针，`extensions/iph.ts` 消费。

其余交付物不变：`SYSTEM.md`、`extensions/iph.ts`、3 个 agent md、`commands/*.md`。
