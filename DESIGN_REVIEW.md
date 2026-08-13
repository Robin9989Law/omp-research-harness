# V0.0.1 设计评审结论

结论：通过。实现基线以 2026-08-13 的
`Robin9989Law/innovation-proposition-hunting@13fc4ec865be42beba2dac9e035ca478ab2e9435`
和本机 omp 17.2.15 为准。

## 已关闭问题

1. `SYSTEM.md` 保留 omp 的文件、工具、委派和内部 URL 基建；科研人格与 iph 纪律
   覆盖默认编码人格。删除基建会使状态机无法可靠调用工具。
2. `IPH_SKILL_DIR` 是显式运行时合同。未设置时只检查用户目录下的标准技能位置，
   不写死开发机绝对路径；找不到时返回 `BLOCKED`，不猜测或复制 validator。
3. iph 原有 8 个子命令逐一注册为工具。另加 `iph_bootstrap`，因为权威 CLI 没有
   init 子命令，而引导模式必须能创建合法 BOOT state。
4. `session_stop` 的同一失败指纹只自动续跑一次；state 或验证结果改变后才再次续跑。
   这避免 omp 的 8 次 continuation 上限被同一错误空耗，同时保留唯一恢复动作。
5. reviewer 由专用 `iph-reviewer` 子代理写产物，主代理不可写。`iph review` 登记后，
   review 文件对所有会话变为不可变；身份与 bundle 一致性仍由权威 validator 裁决。
6. `lifecycle_state.json` 只保存 `active_stage` 与阶段指针。E2/E3 的真实子状态始终来自
   `workflow_state.json`；包装层不得形成第二套判定逻辑。

## 验收条件

- 插件包可被 `omp plugin link` 识别且 doctor 无 error。
- BOOT state 可被远端同提交的 `iph validate --strict-new-checks` 判为 READY。
- 8 个 CLI wrapper 保留 stdout、stderr 与四退出码语义。
- 直接修改 state、主代理写 reviewer 产物、未授权高信号计算均被 hook 拦截。
- 研究模式每轮注入唯一状态；引导模式只提示 bootstrap，不自行选路径。
