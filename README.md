# Research Harness for OMP

[![npm version](https://img.shields.io/npm/v/%40prcbooboo%2Fomp-research-harness)](https://www.npmjs.com/package/@prcbooboo/omp-research-harness)
[![CI](https://github.com/Robin9989Law/omp-research-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Robin9989Law/omp-research-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Research Harness 是一个运行在 [Oh My Pi（OMP）](https://github.com/can1357/oh-my-pi)
上的科研立题插件。它把“这个方向新不新、准备声称的内容是否成立、什么时候可以开始
实验”从一次聊天判断，变成有状态、可恢复、可审计的工作流。

它不是论文生成器，也不会替研究者拍脑袋选题。它重点解决科研过程中最容易失控的两段：

- **创新立题**：逐层收敛研究方向，核对危险近邻，优先尝试证伪候选命题。
- **方案冻结**：冻结精确主张、证据和实验责任，经独立复核后才开放计算。

底层裁决来自
[innovation-proposition-hunting](https://github.com/Robin9989Law/innovation-proposition-hunting)
Schema 3.0 状态机。Research Harness 负责把它接入 OMP 的工具、subagent、会话和配置系统；
Python validator 始终是唯一裁决源。

## 它适合什么项目

Research Harness 适合需要认真回答“创新点是否真实存在”的博士论文、期刊论文和长期研究
项目，尤其适用于这些情况：

- 文献很多，但尚未形成可证伪的具体命题；
- 担心所谓创新只是换名、参数替换或已知结论的机械延伸；
- 研究跨越多个会话，需要准确恢复到上次停止的位置；
- 希望在实验前冻结主张、协议、基线和证据责任；
- 需要把作者工作与独立复核分开，并保留可验证的 reviewer provenance。

如果只是临时查几篇文献、生成摘要或润色现成稿件，这个插件通常太重。它的目标不是更快地产生
答案，而是避免研究建立在错误命题上。

## 工作方式

当前版本深做科研生命周期中的 E2“创新立题”和 E3“方案冻结”。E0/E1/E4/E5/E6 已保留
衔接骨架，但不是本版本的主要自动化范围。

```mermaid
flowchart LR
    A["主题与成果类型"] --> B["L1 研究工作"]
    B --> C["L2 可行创新域"]
    C --> D["L3 具体命题"]
    D --> E["逐近邻证伪"]
    E --> F["N0 新颖性裁决"]
    F -->|"N0-1 / N0-2"| X["关闭、吸收或降级"]
    F -->|"N0-4C"| G["冻结精确 claim"]
    G --> H["有效性审计"]
    H --> I["独立 reviewer"]
    I -->|"V3 + 用户授权"| J["允许计算"]
    J --> K["计算后新 epoch 与 V4 复核"]
```

负结果不是失败。如果近邻已经直接占据候选，或候选可以从已知结果机械推出，工作流会保留
证据并关闭方向，而不是为了“做出创新”继续包装它。

## 核心功能

### 分层构建研究命题

工作流按 L1 → L2 → L3 逐层收敛：

- L1 识别领域边界和连续研究链，只使用元数据与摘要；
- L2 建立危险近邻表，明确哪些浅层主张已被关闭；
- L3 只对真正进入候选集的工作做全文、原子观点和碰撞分析。

这种顺序可以避免在问题还没形成时批量下载全文、抽取大量最终不会进入裁决的观点。

### 证伪优先的新颖性审计

每个候选都必须接受三类检查：是否被直接占据、是否能机械推出、是否只是换名。候选只有在
这些证伪尝试都失败后，才可能进入 `N0-4C`。

### 精确主张与有效性门禁

Research Harness 会把论文准备声称的内容绑定到 claim inventory、理论责任、协议、代码、
测试、基线和证据。经验结果不能自动升格成定理，写作措辞也不能超过当前证据强度。

### 独立复核

V3/V4 复核必须由 `iph-reviewer` subagent 完成。插件从 OMP task lifecycle 注入真实的 agent
和 session 身份；主 agent 不能伪造 reviewer，也不能在复核后改写 review 产物。

### 计算防火墙

研究计算必须满足：

```text
COMPUTE = N0-4C AND V3 AND compute_authorized
FINAL_LOCK = N0-4C AND V4 AND current independent audit
```

在门禁打开前，插件会拦截研究脚本、明显的数值/机器学习计算和实验命令。探索性产物可以登记，
但会被永久标记为不可进入冻结证据，防止预实验数字悄悄变成正式结论。

### 可恢复状态与 STOP 纪律

每个研究目录有唯一的 `workflow_state.json`。新会话会从最近的研究根恢复，只执行机器状态中
的 `next_required_action`。校验失败时工作流进入 STOP，保留已经完成的产物，并只给出一项
恢复动作。`iph_status` 会明确报告物理 STOP 锁，不能再用“字段未显示”猜锁状态。
STOP/BLOCKED 不会触发自动续跑；operator 修复记录中的外部原因后，使用事务化
`resumeBlocked` 恢复到 `resume_state`，验证失败则逐字节还原状态、锁和日志。

### 防篡改与事务配置

- 禁止通过 edit、write、shell、eval 或自定义工具直接修改研究状态；
- 已登记的 review 和状态产物受到快照保护，旁路修改会回滚；
- 用户级 `SYSTEM.md` 与模型角色采用事务安装，失败会恢复原配置；
- 卸载前会检查配置漂移，避免覆盖用户后续修改。

### 按任务选择模型

模型不是写死在 agent 中，而是通过 OMP `modelRoles` 路由。当前默认配置是：

| 角色 | 默认模型 | 用途 |
|---|---|---|
| `default` | `minimax-code-cn/MiniMax-M3:high` | 主流程 |
| `frontier` | `openai-codex/gpt-5.6-sol:high` | 最近前沿、文献身份与覆盖裁决 |
| `layer` | `openai-codex/gpt-5.6-sol:high` | L1、L2 与贡献架构裁决 |
| `atomic` | `openai-codex/gpt-5.6-sol:high` | 原子观点提取 |
| `collision` | `openai-codex/gpt-5.6-sol:high` | 文献碰撞与证伪综合 |
| `review` | `deepseek/deepseek-v4-pro:high` | 独立 V3/V4 复核 |
| `commit` | `minimax-code-cn/MiniMax-M3:high` | 提交信息，与主流程共用模型 |

所有角色都可以在安装时或安装后修改。插件不会在 provider 不可用时静默换模型，因为这会破坏
复核独立性和运行记录。

## 快速开始

### 1. 用提示词安装（推荐）

已经能启动 OMP 时，先把下面整段交给它。安装过程中如果发现已有 checkout 或用户配置
被手动修改，OMP 应停止并报告差异，不覆盖现有内容。

```text
请为当前用户安装并配置最新版 Research Harness。只使用下面两个官方仓库和指定 npm 包，
不要搜索或安装同名 fork：

- Research Harness 产品源码：https://github.com/Robin9989Law/omp-research-harness
- OMP 插件 npm 包：https://www.npmjs.com/package/@prcbooboo/omp-research-harness
- 权威 IPH 规则与 validator：https://github.com/Robin9989Law/innovation-proposition-hunting

请严格完成以下步骤：
1. 检查 OMP、Bun 和 Python 版本是否满足插件要求。
2. 从 npm 安装官方包：
   `omp plugin install @prcbooboo/omp-research-harness@latest`
   安装后核对 package.json 中的 repository 必须指向上面的 Research Harness 产品源码。
3. 读取已安装插件内的 `config/iph-lock.json`。从上面的权威 IPH 仓库克隆
   innovation-proposition-hunting，放入 OMP 能发现的标准用户技能目录，并切换到 lock 指定的
   commit；逐项验证 lock 中的文件 SHA-256。已有 checkout 若有未提交修改，不得 reset、覆盖
   或静默换目录，直接停止并报告。
4. 运行 `omp plugin doctor @prcbooboo/omp-research-harness`。
5. 先运行用户配置安装器的 `install --dry-run`。如果发现旧版安装清单，先检查配置漂移；
   无漂移时事务化卸载旧配置后再安装最新版，有漂移时停止并报告。
6. 安装科研 SYSTEM，并按“角色—职责—模型”配置七个受管 modelRoles：
   - default：运行主研究流程 → minimax-code-cn/MiniMax-M3:high
   - frontier：核验最近前沿、文献身份和覆盖轴 → openai-codex/gpt-5.6-sol:high
   - layer：裁决 L1、L2 和贡献架构 → openai-codex/gpt-5.6-sol:high
   - atomic：atomic-claim-extractor，提取原子观点 → openai-codex/gpt-5.6-sol:high
   - collision：collision-synthesizer，执行文献碰撞与证伪综合 → openai-codex/gpt-5.6-sol:high
   - review：iph-reviewer，执行独立 V3/V4 复核 → deepseek/deepseek-v4-pro:high
   - commit：生成 Git commit message → minimax-code-cn/MiniMax-M3:high
   不要修改 task、vision、plan、designer 等非受管角色。
7. 最后运行安装器 `status`、插件 doctor 和模型角色读取，报告插件版本、权威 IPH commit、
   三个来源 URL、SYSTEM 是否匹配，以及七个受管角色的实际模型和全部 roleDrift。
   任何来源、哈希、模型或健康检查不匹配，都不要继续创建研究工作流。

安装完成后提醒我退出并重新启动 OMP，让新的插件工具和 SYSTEM 生效。
```

重启 OMP 后再创建研究工作流。安装会改变用户级 `SYSTEM.md` 和七个受管模型角色，因此不要在
正在执行研究动作的会话中边安装边继续推进。

### 2. 手动安装

#### 2.1 准备运行环境

需要：

- OMP `>=17.2.15 <18`
- Bun `>=1.3.14`
- Python 3
- authoritative `innovation-proposition-hunting` checkout

克隆并切换到当前锁定的 IPH 版本：

```bash
git clone https://github.com/Robin9989Law/innovation-proposition-hunting.git /absolute/path/to/innovation-proposition-hunting
git -C /absolute/path/to/innovation-proposition-hunting checkout 636dde23fa637c13d7c305b76f0c5628b0348ebf
export IPH_SKILL_DIR=/absolute/path/to/innovation-proposition-hunting
```

建议把 `IPH_SKILL_DIR` 写入 shell 配置，保证以后启动的 OMP 会话也能读取。未设置时，插件只会
检查几个标准技能目录；找不到锁定版本或内容哈希不一致时会返回 `BLOCKED`，不会换用其他
validator。

## 系统验证

本项目用 [SYSTEM_TEST_MATRIX.md](SYSTEM_TEST_MATRIX.md) 管理完整验证面：23 个正向
状态节点、22 条迁移、专家角色路由、正负 N0 终态、STOP/BLOCKED 恢复、事务回滚、
防篡改、计算门、安装和打包。升级固定按静态拓扑 → 单元 → 真实 OMP 组件 → 故障注入
→ 部署 → 真实 M3 单步重放执行，首错即停，不靠重复清锁碰运气。

#### 2.2 安装插件

```bash
omp plugin install @prcbooboo/omp-research-harness@latest
omp plugin doctor @prcbooboo/omp-research-harness
```

#### 2.3 安装科研人格和模型角色

OMP 插件安装目录中的脚本会事务化配置用户级 `SYSTEM.md` 和七个受管模型角色：

```bash
PLUGIN_DIR="$HOME/.omp/plugins/node_modules/@prcbooboo/omp-research-harness"

"$PLUGIN_DIR/scripts/install-user-config.sh" install --dry-run
"$PLUGIN_DIR/scripts/install-user-config.sh" install \
  --role frontier=openai-codex/gpt-5.6-sol:high \
  --role layer=openai-codex/gpt-5.6-sol:high \
  --role atomic=openai-codex/gpt-5.6-sol:high \
  --role collision=openai-codex/gpt-5.6-sol:high \
  --role commit=minimax-code-cn/MiniMax-M3:high
"$PLUGIN_DIR/scripts/install-user-config.sh" status
```

先运行 `--dry-run` 可以查看将要写入的内容。安装器会保存原 `SYSTEM.md` 和安装前的模型角色，
任一步失败都会回滚。

本地软链接开发或插件升级后，先运行 `status`。若 `upgradeRequired=true`，用事务化升级同步
新版 SYSTEM 和新增模型角色，同时保留首次安装前的卸载恢复点：

```bash
"$PLUGIN_DIR/scripts/install-user-config.sh" upgrade --dry-run
"$PLUGIN_DIR/scripts/install-user-config.sh" upgrade
"$PLUGIN_DIR/scripts/install-user-config.sh" status
```

### 3. 新项目怎么开始

在一个没有其他 `workflow_state.json` 祖先的项目目录中启动 OMP：

```bash
mkdir my-research-project
cd my-research-project
omp
```

然后复制下面的提示词，替换方括号中的内容：

```text
/iph 这是一个新研究项目，请从 BOOT 开始建立创新立题工作流。

研究主题：【一句话主题】
目标成果类型：【期刊论文 / 博士论文】
workflow ID：【稳定、简短、使用英文和连字符的 ID】
claim profile：【THEORY / ALGORITHM / MIXED】

要求：
1. 先确认成果类型、研究边界和 workflow ID，再调用 iph_bootstrap。
2. 本轮只创建 Schema 3.0 BOOT state，不自动选择创新路径，不搜索文献，不推进状态。
3. 不运行任何研究计算。
4. 创建后报告 active_state、next_required_action 和 strict validation 结果。
```

`claim profile` 不确定时，通常先选 `MIXED`；如果项目明确只有理论责任或只有算法/协议责任，
再分别使用 `THEORY` 或 `ALGORITHM`。

### 4. 已有项目怎么重新立题

已有项目的代码、稿件、文献和历史实验可以复用，但旧结论不能自动继承。推荐在旧项目旁边创建
一个独立的 reframing 目录，把原项目作为只读背景：

```bash
mkdir project-reframing
cd project-reframing
omp
```

然后输入：

```text
/iph 请为已有项目“【旧项目的绝对路径】”从 BOOT 开始重新立题。新的 workflow 和全部裁决产物保存在当前目录，旧项目只作为只读背景。

目标成果类型：【期刊论文 / 博士论文】
workflow ID：【例如 project-reframing-001】
claim profile：【THEORY / ALGORITHM / MIXED】

要求：
1. 不继承旧项目对创新性、有效性或贡献成立的判断。
2. 旧代码、稿件、文献库和实验记录只作为候选材料；历史实验结果先视为探索性材料，不得直接进入冻结证据。
3. 后续重新执行 L1 研究链识别、L2 危险近邻分析和 L3 具体命题碰撞，优先寻找能够否定候选的证据。
4. 明确登记哪些旧主张被关闭、吸收、降级或需要重新核验。
5. 未达到 N0-4C、V3 并获得计算授权前，不运行研究计算。
6. 本轮只创建 Schema 3.0 BOOT workflow，不自动推进；创建后报告唯一 next_required_action。
```

如果旧项目中没有 `workflow_state.json`，也可以直接在项目根目录启动；只要已经存在旧 state，
就不要覆盖它，也不要在其子目录再建一个 state。新目录应与旧研究根并列，或放在完全独立的
路径中。

### 5. 创建后怎么继续

先查看机器状态：

```text
/iph-status
```

继续工作时，让 agent 严格执行唯一恢复动作：

```text
/iph 先调用 iph_transition_plan，按返回的工件和 specialist 合同只完成当前状态；
需要 frontier/layer/atomic/collision specialist 时必须委派，strict READY 后才推进。
```

```text
/iph 执行当前 next_required_action
```

需要独立复核时使用：

```text
/iph-review
```

## 日常使用

| 命令 | 作用 |
|---|---|
| `/iph <任务>` | 创建工作流，或执行当前状态允许的单一动作 |
| `/iph-status` | strict validate，并生成机器状态与交接报告 |
| `/iph-review` | 派发独立 reviewer，绑定真实 task/session provenance |

插件还向 OMP 注册 11 个底层工具：只读 status、transition plan、bootstrap、validate、advance、碰撞轮次创建/修复、review
封印、STOP 解锁、探索登记和 handover。正常使用时不需要记住这些工具名，斜杠命令和注入的
机器状态会引导 agent 选择正确工具。

当 transition plan 指定 specialist 时，M3 只需给 `task` 传 `context` 和
`tasks[].name/agent/task`。插件会移除 M3 自造的 `outputSchema` / `schemaMode`，避免便宜
主模型生成截断 JSON Schema 导致委派预检失败。`iph_*` 工具始终按原名直接调用，不使用
`ipc_call` 等包装层。

### 如何理解状态

新颖性和有效性是两条独立轴：

| 状态 | 含义 |
|---|---|
| `N0-1` | 正式近邻直接占据候选，应关闭或吸收 |
| `N0-2` | 候选可由已知结果机械推出，应关闭或降级 |
| `N0-3` | 候选仍处于前沿核验或专属门未完成，不得计算 |
| `N0-4C` | 新颖性路径通过，可以进入有效性轴 |
| `V0–V2` | 主张及其理论/算法责任正在冻结和审计 |
| `V3` | 当前 epoch 已通过独立复核，可以在授权后计算 |
| `V4` | 计算后的新 claim bundle 已完成再次复核 |

Validator 有四种退出结果：

```text
READY = 0
INVALID = 1
BLOCKED = 2
MIGRATION_REQUIRED = 3
```

任何非零结果都会 STOP。修复报告中的唯一恢复动作后，再运行 `/iph-status`；不要直接编辑
`workflow_state.json` 来“修好”状态。

## 自定义模型

可以用 YAML 或 JSON 文件局部覆盖模型角色，也可以重复传入 `--role`。命令行覆盖文件，文件
覆盖插件默认值。

```yaml
# my-model-roles.yml
modelRoles:
  default: minimax-code-cn/MiniMax-M3:high
  frontier: openai-codex/gpt-5.6-sol:high
  layer: openai-codex/gpt-5.6-sol:high
  atomic: openai-codex/gpt-5.6-sol:max
  collision: openai-codex/gpt-5.6-sol:max
  review: deepseek/deepseek-v4-pro:max
  commit: minimax-code-cn/MiniMax-M3:high
```

已安装后可以直接更新，不需要卸载：

```bash
"$PLUGIN_DIR/scripts/install-user-config.sh" configure --dry-run \
  --roles-file /absolute/path/to/my-model-roles.yml

"$PLUGIN_DIR/scripts/install-user-config.sh" configure \
  --roles-file /absolute/path/to/my-model-roles.yml

"$PLUGIN_DIR/scripts/install-user-config.sh" status
```

`configure` 只修改模型选择；`upgrade` 用于插件源码新增角色或 SYSTEM 变化后的整体同步。

允许管理的角色是 `default`、`frontier`、`layer`、`atomic`、`collision`、`review`、`commit`。其他已有 OMP 角色会
原样保留。

## 卸载

先恢复用户配置，再删除插件：

```bash
"$PLUGIN_DIR/scripts/install-user-config.sh" uninstall --dry-run
"$PLUGIN_DIR/scripts/install-user-config.sh" uninstall
omp plugin uninstall @prcbooboo/omp-research-harness
```

如果安装后手动改过受管配置，卸载会拒绝覆盖。确认要恢复安装前值时才使用
`uninstall --force`。

## 产品边界

Research Harness 能强制流程和证据合同，但不能替代以下工作：

- 获取你无权访问的付费全文；
- 领域专家对研究意义和边界条件的最终判断；
- 实验复现、数据真实性检查和人工伦理审查；
- 对“绝对新颖”或“必然正确”的保证；
- E4 系统实验、E5 成文和 E6 投稿的完整自动化。

它能保证的是：机器不会把缺证据、缺复核或未授权的状态标成 READY，也不会在这些条件未
满足时按正常路径进入计算。

## 开发与验收

从源码联调：

```bash
git clone https://github.com/Robin9989Law/omp-research-harness.git
cd omp-research-harness
bun install --frozen-lockfile
export IPH_SKILL_DIR=/absolute/path/to/innovation-proposition-hunting

bun run check
bun run release:check
omp plugin link .
omp plugin doctor @prcbooboo/omp-research-harness
```

`bun run check` 包含 TypeScript 检查、单元与安全测试、真实 OMP loader E2E、事务安装/回滚/
卸载 E2E，以及权威 IPH strict validation。CI 还会运行 authoritative IPH 的完整 pytest
回归套件。npm 发布使用 GitHub OIDC trusted publishing 和 provenance，不在 workflow 中保存
长期 npm token。

## 相关项目

- [innovation-proposition-hunting](https://github.com/Robin9989Law/innovation-proposition-hunting)：
  Schema 3.0 状态机、模板、规则和 Python validator。
- [Oh My Pi](https://github.com/can1357/oh-my-pi)：插件运行时、模型路由、工具和 subagent
  基础设施。

本项目使用 [MIT License](LICENSE)。
