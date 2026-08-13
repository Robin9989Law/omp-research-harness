# Changelog

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
