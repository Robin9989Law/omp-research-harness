# V0.0.1 设计评审结论

结论：通过。实现基线以 2026-08-13 的
`Robin9989Law/innovation-proposition-hunting@13fc4ec865be42beba2dac9e035ca478ab2e9435`
和本机 omp 17.2.15 为准。

## 已关闭问题

1. `SYSTEM.md` 保留 omp 的文件、工具、委派和内部 URL 基建；科研人格与 iph 纪律
   覆盖默认编码人格。删除基建会使状态机无法可靠调用工具。
2. `IPH_SKILL_DIR` 是显式运行时合同。未设置时只检查用户目录下的标准技能位置，
   不写死开发机绝对路径；找不到时返回 `BLOCKED`。运行时还对固定上游 commit 的核心
   文档与全部 Python 脚本逐文件验 SHA-256，不猜测、复制或静默升级 validator。
3. iph 原有 8 个子命令逐一注册为工具。另加 `iph_bootstrap`，因为权威 CLI 没有
   init 子命令，而引导模式必须能创建合法 BOOT state。
4. `session_stop` 的同一失败指纹只自动续跑一次；state 或验证结果改变后才再次续跑。
   这避免 omp 的 8 次 continuation 上限被同一错误空耗，同时保留唯一恢复动作。
5. reviewer 由专用 `iph-reviewer` 子代理写产物，主代理不可写。`iph_review` 只接受
   与当前 session file 匹配的 OMP lifecycle 身份，运行时注入 agent/thread ID；登记后
   review 文件不可修改，下一 epoch 只能追加新文件，最终仍由权威 validator 裁决。
6. `lifecycle_state.json` 只保存 `active_stage` 与阶段指针。E2/E3 的真实子状态始终来自
   `workflow_state.json`；包装层不得形成第二套判定逻辑。schema、规范指针或派生阶段
   漂移时 STOP；`iph_validate` 先重建完全派生的薄状态，再由 Python 独立裁决权威 state，
   防止两个文件同时异常时出现恢复死锁。
7. session 位于研究子目录时向上选择最近的 `workflow_state.json`；工具、hook、快照、
   lifecycle 和 session-stop 均使用同一研究根，避免 cwd 漂移形成第二份状态。

## 验收条件

- 插件包可被 `omp plugin link` 识别且 doctor 无 error。
- BOOT state 可被远端同提交的 `iph validate --strict-new-checks` 判为 READY。
- 8 个 CLI wrapper 保留 stdout、stderr 与四退出码语义。
- 直接修改 state、主代理写 reviewer 产物、未授权高信号计算均被 hook 拦截；非
  `iph_*` 工具另有执行后快照回滚，覆盖 eval/Node/自定义工具旁路。
- 研究模式每轮注入唯一状态；引导模式只提示 bootstrap，不自行选路径。
- `tsc --strict`、真实 OMP loader/tool/hook E2E、插件 doctor 与上游完整 pytest 进入 CI。
- 用户配置安装以 manifest 为事务边界，失败自动回滚 SYSTEM/model roles；卸载检测受管
  值漂移并保留无关的后续配置；五个 harness 模型角色支持文件/CLI 自定义及事务化重配置。
  公开包在 prepack 重跑全检查并启用 npm provenance。
