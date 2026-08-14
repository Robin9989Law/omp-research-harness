# 全节点真实模型证据（2026-08-14）

## 结论

22 条正向边均已由真实 M3 单边回放覆盖；需要科学判断的节点留下对应 specialist 的正式
session identity 与实际模型记录，Node 17–22 还在同一研究根中连续走到 `COMPLETE`。所有被采纳的
正向证据均满足：目标状态正确、strict validator exit 0、无 STOP lock、运行时存在
MiniMax-M3 `model_change`。这不是一次单体演示，而是“当前确定性全拓扑 + 分段真实模型 + 晚期连续流”
的组合证明。

## 当前提交上的确定性全覆盖

- `bun run test:nodes -- --pdf-cache <pinned W-0001.pdf>`：22/22 源状态、22/22 正向边、
  N0-1/N0-2 合法负终态、N0-3 HOLD、Node 18–22 连续流全部 READY。
- 固定 PDF 仍必须命中 `125fe807fe49dbbb491c2f7d835cf61b17174cfc4fef9f2a974d0d4eb294ddf1`；
  cache 只消除重复下载，不放宽真实性门。
- authoritative IPH skill：450/450 Python `unittest` 通过。

## 真实模型正向覆盖

| 节点 | source → target | coordinator / specialist | 证据文件（SHA-256） |
|---:|---|---|---|
| 1–3 | BOOT → SCOPE_LOCK → PRIOR_CLAIM_DRAIN → RECENT_FRONTIER | M3；Node 3 frontier-auditor / GPT-5.6-sol | `/tmp/iph-real-model-all-nodes-20260814/evidence.json` (`723ff1f4b0131facf8cc17e575bb0111ea8a5eb73748b57cb7d0bb58150c3dad`) |
| 4 | RECENT_FRONTIER → LITERATURE_REGISTER | M3 + frontier-auditor / GPT-5.6-sol | `/tmp/iph-real-model-node04-remediated-20260814/evidence.json` (`f550a2bbf4446075ccc4abf3576c894875c2d2d018ce60df6166103f9e78fb73`) |
| 5 | LITERATURE_REGISTER → L1_FREEZE | M3 + layer-adjudicator / GPT-5.6-sol | `/tmp/iph-real-model-nodes05-10-20260814/evidence.json` (`4f77d277f2bdef1eb95155e07c998567665091645d3227489656782ab969fdb0`) |
| 6 | L1_FREEZE → L2_TRIAGE | M3 + layer-adjudicator / GPT-5.6-sol | `/tmp/iph-real-model-node06-xd-fixed-20260814/evidence.json` (`8512a63a18446a7c86be6eaad65d8b5ad8d9b9985be098b7c374d9a4902bbc73`) |
| 7–10 | L2_TRIAGE → LAYER_DECISION → K_FULLTEXT → K_CLAIM_REGISTER → SYNTHESIZE_COLLISION | M3；layer / atomic / collision specialists 为 GPT-5.6-sol | `/tmp/iph-real-model-nodes07-10-20260814/evidence.json` (`13c4e7e7d8576ca1215d9aea280580cf7b4434ad5fd13622f417e7cbc2e357e3`) |
| 11–16 | SYNTHESIZE_COLLISION → OUTPUT_CLAIM_BIND → EVIDENCE_VALIDATE → N0_AUDIT → CLAIM_FREEZE → VALIDITY_AUDIT → INDEPENDENT_REVIEW | M3 | `/tmp/iph-real-model-nodes11-16-20260814/evidence.json` (`94a77f2e43834006ad231ff6bcd1461bce01a6db34af1fe8e9de7672a9709f1b`) |
| 17–22 | INDEPENDENT_REVIEW → DIRECTION_LOCK → COMPUTE → POSTCOMPUTE_CLAIM_FREEZE → FINAL_VALIDITY_AUDIT → FINAL_LOCK → COMPLETE | M3；Node 17/21 iph-reviewer / DeepSeek V4 Pro | `/tmp/iph-real-model-replay-20260814-resumed3/evidence.json` (`2e3737c047b8a55598022e1087fce4ebb2725ec26134cb2832134c4367efc7a6`) |

Node 3/4/5/6/7/9/10 均有认证 specialist session；Node 17/21 均有 DeepSeek V4 Pro
`model_change` 和真实 `iph_review`。Node 18 的用户授权只写入计算授权，不旁路 N0-4C/V3；Node 19
登记 S4；Node 20 建立 epoch+1；Node 21 复核新 bundle；Node 22 到 `COMPLETE`。

## 缺陷发现与修复重放

| 失败轨迹 | 观察 | 归因 | 修复与通过证据 |
|---|---|---|---|
| Node 4 初次真实回放 | frontier-auditor 发现未执行/未登记前后向引文图遍历，正向 runner 拒绝 `BLOCKED` | fixture 科学证据缺口；同时暴露“实质 FAIL”与 capability BLOCKED 的工具闭环缺失 | `037fc90`：补真实查询记录与 same-state specialist FAIL；Node 4 修复后 strict 0 |
| Node 6 初次真实回放 | CLI 已推进，但状态和新 L2 工件在工具返回后被恢复；runner 发现 state unchanged | OMP `write(path=xd://iph_advance)` 动态桥被防火墙误识别为任意写入 | `c47855b`：严格白名单识别 `xd://iph_*` 事务；Node 6 修复后 strict 0，L2 工件保留 |

失败证据没有被改写成 PASS。原始失败 manifest 分别保留在
`/tmp/iph-real-model-all-nodes-20260814/evidence.json` 的 Node 4，以及
`/tmp/iph-real-model-nodes05-10-20260814/evidence.json` 的 Node 6。

## 测试金字塔

完整真实 22 节点是发布级认证，不是每次提交的默认回归：科学 specialist 的一次独立审计可能需要
5–20 分钟，串行全跑通常需要 1–3 小时。

1. 每次提交：`bun run check`，再用 pinned PDF 跑 `bun run test:nodes`；目标是秒到分钟级。
2. 节点实现或 prompt 变化：`test:models --all-nodes --from-node N --to-node N`，只真实回放受影响边。
3. review/compute 控制面变化：运行默认 Node 17–22 连续流。
4. 模型路由、OMP lifecycle、插件装载或发布候选变化：运行完整 `--all-nodes`；可按互不共享状态的
   节点范围在 CI worker 分片，最后合并 evidence manifest。
5. 完整运行失败时首错即停，修复后从失败节点重放；不得清锁、跳态或为了得到全绿而覆盖失败证据。

## 边界

这里证明的是已定义的 22 个节点合同、当前故障矩阵和已配置模型路径均被实际执行；它不等价于对所有
未来 provider 故障、提示扰动或科研领域都给出数学意义上的完全可靠保证。原始 session JSONL 体积较大，
保留在上述本地 evidence 根，不进入 npm 包；本文件保存可复核的路径、摘要与内容哈希。
