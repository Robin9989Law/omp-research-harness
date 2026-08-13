# 科研 harness — 需求规格

> 把 omp（Oh My Pi）从编码 harness 改造为科研专用 harness：将
> innovation-proposition-hunting（iph）状态机嵌入 omp，使其成为默认工作流，
> 而非按需调用的技能。本文件是需求调研结论，不是实现。

## 1. 目标

- 重定义定位：omp 的默认人格与工作流从「编码 agent」切换为「科研 agent」，
  iph 状态机成为常驻默认工作流。
- 全局生效：配置装到 `~/.omp/agent/`（用户级），所有 session 生效。
- 隔离开发：本项目 `/Users/robinlaw/Downloads/科研harness` 独立 git 仓库，
  与 iph skill 仓库、现网 `~/.omp/agent/` 解耦；上线时才安装。

## 2. 已锁定决策

| 编号 | 决策点 | 结论 |
|---|---|---|
| Q1 | 定位 | B：重定义成科研 harness，iph 状态机是默认工作流 |
| Q2 | 作用域 | 全局（用户级配置） |
| Q3 | 交付形态 | 新项目 `科研harness`，隔离运作 |
| Q4 | 计算门力度 | 中等保守：拦明显计算（研究脚本 / ML 库名 / 实验动词），validator 兜底 |
| Q5 | 无 state 目录行为 | 引导模式（bootstrap 建立研究目录 + workflow_state.json） |
| Q6 | 基座 | omp（Oh My Pi），非 pi（上游 pi-mono） |
| Q7 | 版本范围 | V0.0.1：立题做实；其余阶段用 skill + model + harness 自身能力 |
| Q8 | 模型路由 | 按任务分模型：原子观点/碰撞→GPT-5.6-sol；复核→DeepSeek V4 Pro；其他及 commit→M3 |
| Q9 | 部署 | 直接当前 omp（不 fork）；打包为公开 provenance OMP 插件（`omp plugin install`）+ 事务化用户级配置（SYSTEM.md / modelRoles，可回滚/卸载）；开发用 `omp plugin link` 本地联调 |
| Q10 | 生命周期状态 | 薄包装：`lifecycle_state.json` 只存 `active_stage` + 阶段指针，E2/E3 用 iph `workflow_state.json` 作子状态，不动 schema 3.0 |
| Q11 | 可移植性 | machinery（extension/agents/commands/skills）进插件；SYSTEM.md/modelRoles 走用户配置 + README；iph.py 路径经 `IPH_SKILL_DIR` 抽象，不硬编码，并用随包 lock manifest 固定上游 commit/内容 |

## 2.1 V0.0.1 范围

- 核心：E2 创新立题 + E3 方案冻结（iph 新颖性轴 + 有效性轴）做成 harness 原生工作流，
  把「立题」做实做硬。
- 其余阶段（E0 入口 / E1 领域形成 / E4 执行 / E5 写作 / E6 投稿）暂用
  skill + model + harness 自身能力，不进 V0.0.1。
- 7 阶段生命周期全景作为愿景，不阻塞 V0.0.1。

## 3. 双模式模型

### 3.1 研究模式（目录内存在 `workflow_state.json`）

- 当前目录或最近祖先目录存在 state 即进入研究模式，所有 hook 共用该研究根。
- iph 状态机驱动一切：仅从 `next_required_action` 恢复，推进前必 validate，
  计算门硬拦。
- 会话结束（yield）前 hook 自动 `iph validate`，非零即注入唯一恢复动作续跑，
  对应 iph 的 STOP 锁纪律（R-BLOCKED-03）。

### 3.2 引导模式（无 `workflow_state.json`）

- 科研 harness 引导建立研究目录 + 初始 `workflow_state.json`（iph BOOT，模板取自
  iph `templates.md`）。
- 引导产物：成果类型确认 → scope_lock → 初始 state；不擅自推进、不自行选创新路径。

## 4. 交付物（映射 omp 扩展面）

| 文件（本项目内） | 安装落点（`~/.omp/agent/`） | 职责 |
|---|---|---|
| `SYSTEM.md` | `SYSTEM.md` | 科研人格 + 「iph 状态机是默认工作流」指令（替换默认编码人格） |
| `extensions/iph.ts` | `extensions/iph.ts` | iph CLI 工具化 + 门禁 hook（自动 validate / 状态注入 / 计算拦截） |
| `agents/frontier-auditor.md` | `agents/frontier-auditor.md` | 前沿身份、检索路径与覆盖审计（@frontier → GPT-5.6-sol） |
| `agents/layer-adjudicator.md` | `agents/layer-adjudicator.md` | L1/L2 与贡献架构裁决（@layer → GPT-5.6-sol） |
| `agents/atomic-claim-extractor.md` | `agents/atomic-claim-extractor.md` | 原子观点提取 subagent（@atomic → GPT-5.6-sol） |
| `agents/collision-synthesizer.md` | `agents/collision-synthesizer.md` | 文献碰撞综合 subagent（@collision → GPT-5.6-sol） |
| `agents/iph-reviewer.md` | `agents/iph-reviewer.md` | 独立复核 reviewer（@review → deepseek-pro，承载 V3/V4 硬门） |
| `commands/*.md` | `commands/*.md` | `/iph`、`/iph-status`、`/iph-review` 斜杠命令 |

关键约束：校验器唯一真相源是 iph 的 Python 脚本；TS 层做参数 schema、退出码转译、
运行时 reviewer provenance 绑定及原子镜像，不复制或替代任何有效性判定逻辑；封印后
仍必须由 Python validator 给出最终 READY/INVALID/BLOCKED/MIGRATION_REQUIRED。

## 4.1 模型路由（Q8）

`modelRoles` + 自定义 agent frontmatter `model: "@角色"` 实现按任务分模型：

| 角色 | 模型 | 承接 iph 环节 |
|---|---|---|
| default | minimax-code-cn/MiniMax-M3:high | 其他工作流（主 agent） |
| frontier | openai-codex/gpt-5.6-sol:high | RECENT_FRONTIER / LITERATURE_REGISTER 前沿身份与覆盖 |
| layer | openai-codex/gpt-5.6-sol:high | L1_FREEZE / L2_TRIAGE / LAYER_DECISION 层级裁决 |
| atomic | openai-codex/gpt-5.6-sol:high | K_CLAIM_REGISTER 原子观点 |
| collision | openai-codex/gpt-5.6-sol:high | SYNTHESIZE_COLLISION 碰撞 |
| review | deepseek/deepseek-v4-pro:high | INDEPENDENT_REVIEW / FINAL_VALIDITY_AUDIT |
| commit | minimax-code-cn/MiniMax-M3:high | 提交信息（与主流程共用模型，避免切换） |

分模型前提：这些环节必须委派给 subagent（task 工具），主 agent 不内联执行。

## 5. 已关闭的设计级细节

- **SYSTEM.md 科研人格正文**：保留 omp 工具、内部 URL、委派与恢复基建；科研人格与
  iph 状态机纪律替换默认编码目标。详见 `DESIGN_REVIEW.md`。
- **iph.py 运行时路径解析**：`IPH_SKILL_DIR` 为显式合同，标准用户技能目录为回退；
  缺失返回 BLOCKED，不使用开发机绝对路径，不复制 validator。
