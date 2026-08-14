# Agent-native 软件工程准则

本产品的直接用户是会规划、调用工具、委派任务并修改外部状态的 Agent。设计目标不是让
界面对人“看起来清楚”，也不是把 Agent 降格成脚本解释器，而是让它在可验证的事实和状态
之上充分发挥全局理解、快速反推、创新批判与动态重规划能力，同时让一切外部副作用沿着
可审计的安全路径发生。

## 1. 范式

Agent-native 系统应采用：

```text
概率性 policy（模型提出动作）
            ↓
确定性 substrate（软件裁决可见性、权限、状态、完成、提交与恢复）
```

SWE-agent 将 LM Agent 定义为一种有自身能力与限制的新终端用户，并证明
[Agent–Computer Interface](https://arxiv.org/abs/2405.15793) 的设计本身会改变任务表现。
后续 [Harness Engineering](https://openreview.net/forum?id=nM5tDHrQsx) 把模型外围的 workflow、
memory、skills 和 multi-agent orchestration 统一为需要与模型共同优化的工程对象。

因此，prompt 不是控制面，模型自述不是运行时事实，单次成功也不是稳健性证明。但确定性
底座约束的是副作用，不是思考空间：它应给 M3 提供高带宽、低歧义的世界模型，使其能从
全局目标反推当前最佳利益点，而不是用繁琐步骤替它预设结论。

不得以成本、模型标签或历史失败预设 M3 “较弱”。模型角色路由是能力组合，不是能力等级：
M3 负责全局综合、提出和反驳假设、比较机会成本、选择下一信息增益最大的动作；specialist
提供独立视角和领域审计；validator 只裁决机器合同。三者分别对应综合、对抗和事实裁决，
不能互相替代。

## 2. 七层系统合同

[HarnessFix](https://arxiv.org/abs/2606.06324) 使用七层 taxonomy 定位 harness 缺陷。本项目
按同一边界评审每次改动：

| 层 | 必须回答的问题 | 本项目证据 |
|---|---|---|
| Execution | 动作在哪里执行，权限和副作用边界是什么？ | sandbox、approval、compute firewall |
| Tool Interface | Agent 能否发现、理解、正确调用工具？ | essential 工具面、窄 schema、结构化错误 |
| Context & Memory | 当前状态是否显式、最小且无歧义？ | `iph_status`、机器状态、单一 next action |
| Lifecycle | started/message/completed/failed 是否严格区分？ | 23 状态 FSM、task lifecycle、事务迁移 |
| Observability | 能否从轨迹定位责任步骤和责任层？ | session、调用序列、agent/model、hash、validator log |
| Verification | 正确性是否由外部 oracle 判定？ | Python validator、post-transition validation、回归矩阵 |
| Governance | 身份、授权、锁和审计是否可伪造？ | runtime identity、STOP、不可变 hash、review provenance |

## 3. 十三条设计规则

1. **机器状态优先**：状态、锁、完成度、身份和下一动作必须有结构化字段。
2. **能力必须可发现**：注册成功不等于 Agent 可见；关键工具和模型角色要做真实加载测试。
3. **一次只走一条边**：每个状态只有一个目标合同和一个恢复动作。
4. **不信任自然语言自报**：PASS、agent ID 和“已完成”必须由运行时事件或工件证明。
5. **消息不等于完成**：异步任务明确区分 pending、started、message、completed、failed、aborted。
6. **写操作必须幂等或事务化**：重试不得重复推进、重复扣款式执行或留下半提交状态。
7. **显式 handle 胜过隐藏 session**：跨调用状态由可校验的 handle/ID 传递并绑定作用域。
8. **错误是下一步 API**：错误必须包含 observed state、责任层和唯一合法恢复动作。
9. **最大化主 Agent 能力**：M3 拥有全局综合、创新批判和动态重规划权；合同提供事实与边界，
   不把它压缩成固定步骤执行器。
10. **specialist 是对抗同伴**：专家路由用于独立复核和认知多样性，不代表主 Agent 能力较低；
    M3 应检查其论据、发现规则冲突并综合最终行动。完成身份不等于结论权威；迁移时
    必须显式记录接受或推翻以及证据/规则/validator 理由。
11. **验证器独立于模型**：最终状态、工件和权限由 deterministic oracle 裁决。
12. **按轨迹归因再修复**：先定位责任步骤与 harness 层，再做有边界的 repair，禁止大改 prompt。
13. **以可靠性而非演示验收**：重复、扰动和故障注入全部通过后才可称为稳健。

关键节点先提供“题面可判定性”，再要求行动：必读的当前证据、权威要求、输出模板、最小正例、
典型反例和外部判题器缺一不可。这是能力激发而不是步骤微操：M3 仍决定论证、分歧处置和最优行动。
验收时分别测试单任务静态、单任务事件流和多任务流；后两者必须注入重复、乱序、超时、历史失败、
可选探索与下一节点诱惑，观察 M3 是否仍保持优先级和单事务纪律。

事件流管理员仅在事件容量超过主协调者的有效注意带宽时有价值。harness 先把原始 lifecycle 聚合为可验证
decision-state projection，再交给 DeepSeek V4 Flash 做优先级摘要；Flash 不读研究全文、不派任务、不写文件、
不验证或推进状态。必须用无管理员/有管理员消融比较总延迟、模型调用成本、漏报、误报、重复动作和最终正确率；
若事件很少，应直接由 M3 处理，避免固定的额外调用税。
模型路由也必须服从运行时证据：`task` 不暴露 model 参数是角色路由的正常接口形状，不能据此
推断回退。实际执行模型只由 lifecycle 中的 `resolvedModel` / `model_change` 证明；元数据不可见时
结论是 `UNKNOWN`，而不是默认模型。
事件管理员只能报告自己的模型，不能把该值归给同一批 task 中的其他 agent。正式迁移由 harness
读取认证 specialist session 的 `model_change` 自动记录；自由文本 rationale 不承担模型身份字段。

证据字段是语义角色，不是计数指标。优化 URL distinctness、字段非空率或 validator 通过率时，
不得改变证据的认识论职责：预印本能证明作品/版本存在，不能证明同行评审；同一个正式来源可以
合法承担多个角色。发现已登记证据语义错误时，保留旧版本及哈希，通过 state pointer 指向修正版，
禁止覆盖历史。

### 能力激发，而非能力替代

前沿工作提示我们把 harness 当成模型能力的放大器，而非补丁集合：

- [Methodological Challenges in Agentic Evaluations](https://openreview.net/forum?id=ZhSKG8IslC)
  区分模型能力与 scaffold elicitation，说明简单 scaffold 的低分不能直接归因为模型无能力；
- [The Influence of Scaffolds on Coordination Scaling Laws](https://openreview.net/forum?id=E9whrbtgUA)
  显示细微 scaffold 变化会显著改变协作表现，因此角色提示本身必须进入消融实验；
- [HarnessBridge](https://arxiv.org/abs/2606.12882) 把 harness 分为 observation projection 与
  action projection：前者给模型压缩后的决策相关世界状态，后者把提议转为可执行迁移或有轨迹依据的拒绝；
- [Co-Harness](https://arxiv.org/abs/2607.22688) 用失败轨迹驱动 HarnessCritic 提出并验证局部改动，
  说明 harness 与模型策略应共同演化，而不是一次写死；
- [AI4AI at Test-Time](https://arxiv.org/abs/2608.12307) 报告 builder model 的推理投入与 harness
  质量正相关。其 strong-to-weak 实验设定不能被外推成“M3 较弱”，但可借用 builder→验证集→迭代
  refinement 的方法，让 M3 参与改进自己的执行环境。

据此，真实测试至少做四组 scaffold 消融：`步骤脚本 vs 目标+不变量`、`原始长上下文 vs 决策状态投影`、
`specialist 权威裁定 vs 独立对抗同伴`、`局部节点视野 vs 全局推理+单事务提交`。同时比较最终状态正确率、
不必要工具调用、token/时延、规则冲突发现率、可复用新洞见和 validator 拒绝率。只有证明某项约束提高
可靠性且未压制这些能力指标，才保留该约束。

最新版 [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) 同样采用自描述请求、
显式状态 handle、确定性工具目录和可查询 Task 生命周期；这验证了“应用状态不能隐藏在传输
session、异步消息不能替代正式完成”的方向。

## 4. 可靠性验收

一次 pass@1 只说明“曾经成功”。参考
[τ-bench](https://arxiv.org/abs/2406.12045) 和
[ReliabilityBench](https://arxiv.org/abs/2601.06112)，发布门应测量：

```text
R(k, ε, λ)
k = 相同目标的重复运行次数
ε = 同义改写、顺序变化、噪声上下文强度
λ = 超时、限流、部分响应、schema 漂移、乱序 completion 等故障强度
```

正确性以最终机器状态、工件哈希和副作用等价判定，不以回答文字相似度判定。至少覆盖：

- 正常单节点执行；
- PASS 消息早于正式 completion；
- 工具缺失、参数截断和 schema 漂移；
- validator INVALID/BLOCKED 与逐字节回滚；
- 重复调用、会话重启和 stale identity；
- 外部能力部分不可用但已满足明示 quorum；
- 不可信工具输出中的间接指令。

[AgentDojo](https://arxiv.org/abs/2406.13352) 证明工具返回数据是潜在攻击面；外部内容只能
作为数据进入验证管线，不能成为修改系统政策或扩大权限的指令。

## 5. 可观测与复盘

[AgentOps](https://arxiv.org/abs/2411.05285) 强调覆盖完整 Agent 生命周期的 trace。
本项目每个真实回合至少保存：

- workflow/session/agent/tool-call ID 与模型角色；
- 工具输入、正式 lifecycle 状态和退出码；
- active/resume/target、STOP lock、gate 和 next action；
- 迁移前后状态与工件 SHA-256；
- validator issue code、责任层、rollback 结果；
- 修复 commit、回归用例和重放结果。

复盘按 `Detect → Attribute → Repair → Rerun` 闭环。失败出现的位置不一定是根因位置；例如
迁移门拒绝可能来自更早的 task lifecycle 竞态，而不是 `iph_advance` 参数错误。
测试装载方式也属于 harness：只加载扩展文件或只加载 agent 目录会改变 Agent 的可见世界，
不能拿半装载轨迹评价完整产品。源码真实测试统一以完整 plugin root 为观测边界。

## 6. 当前完成度与后续门槛

当前已有确定性状态机、显式 STOP、事务回滚、运行时身份、模型角色路由、全拓扑审计和真实
M3 单步重放。这里的“单步”限制的是一次事务的副作用范围，不限制 M3 在行动前跨节点理解
全局、比较路径或批判 specialist。仍需持续补强：

- 同一测试在多次采样、同义提示和故障强度下的 `R(k, ε, λ)` 报告；
- 标准化的 trace intermediate representation，自动关联责任步骤与 harness 层；
- 写工具的持久化 idempotency key 与跨进程 stale completion 防护；
- 间接 prompt injection 与恶意工具输出故障注入；
- 每次 OMP/MCP task lifecycle 升级后的兼容性合同测试。

这些项目完成前，可以报告某条路径“已通过”，但不能笼统声称系统在所有生产条件下“完全可靠”。
