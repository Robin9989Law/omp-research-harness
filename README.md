# 科研 Harness V0.0.1

把 [innovation-proposition-hunting](https://github.com/Robin9989Law/innovation-proposition-hunting)
的 Schema 3.0 状态机接入 Oh My Pi，使 E2 创新立题与 E3 方案冻结成为默认、可恢复、
可机器阻断的科研工作流。Python validator 是唯一裁决源；本插件不复制任何校验逻辑。

## 交付内容

- `extensions/iph.ts`：BOOT 初始化、8 个 iph CLI 工具、状态注入、STOP 验证、计算门和
  state/review 防篡改 hook。
- `agents/*.md`：原子观点、碰撞综合、独立 V3/V4 reviewer，按 `@atomic`、
  `@collision`、`@review` 路由。
- `commands/*.md`：`/iph`、`/iph-status`、`/iph-review`。
- `SYSTEM.md`：全局科研人格与工作流纪律。
- `schemas/lifecycle_state.schema.json`：只含活动阶段和阶段指针的生命周期薄包装。

## 运行前提

- omp `>=17.2.15`
- Bun `>=1.3.14`
- Python 3
- authoritative iph checkout；推荐显式设置：

```bash
export IPH_SKILL_DIR=/absolute/path/to/innovation-proposition-hunting
```

未设置时依次检查 `~/.agents/skills/innovation-proposition-hunting`、
`~/.codex/skills/innovation-proposition-hunting`、
`~/.claude/skills/innovation-proposition-hunting`。当前 harness 锁定上游提交
`13fc4ec865be42beba2dac9e035ca478ab2e9435`，并在每次调用前核对核心说明和全部 Python
脚本的 SHA-256；HEAD 或内容不一致即 BLOCKED。缺失时同样 BLOCKED，不使用内置副本或
降级 validator。升级上游必须显式更新并评审 `config/iph-lock.json`。

## 开发联调

```bash
cd /path/to/科研harness
bun install --frozen-lockfile
bun run check
omp plugin link .
omp plugin doctor @robinlaw/omp-research-harness
```

设计要求隔离开发，因此仓库本身不会自动修改 `~/.omp/agent/`。准备上线时运行：

```bash
./scripts/install-user-config.sh install --dry-run
./scripts/install-user-config.sh install
./scripts/install-user-config.sh status
```

安装器会把已有 `SYSTEM.md`、安装前 model roles 和受管角色集合写进本次 transaction
manifest；任一步失败都会恢复两者。卸载默认拒绝覆盖安装后被用户修改的受管值，确认后可
使用 `--force`：

```bash
./scripts/install-user-config.sh uninstall --dry-run
./scripts/install-user-config.sh uninstall
# 仅在 status 显示受管值漂移且确定要恢复安装前值时：
./scripts/install-user-config.sh uninstall --force
```

上述命令只管理用户配置，不隐式安装或删除插件。
插件仍需通过 `omp plugin link .`（开发）或 `omp plugin install <package>`（发布）安装。

## 模型角色

```yaml
modelRoles:
  default: minimax-code-cn/MiniMax-M3:high
  atomic: openai/gpt-5.6-sol:high
  collision: openai/gpt-5.6-sol:high
  review: deepseek/deepseek-v4-pro:high
  commit: deepseek/deepseek-v4-flash:high
```

角色只是路由；对应 provider 凭据不可用时必须 BLOCKED，不能换模型伪造独立复核。

## 两种模式

引导模式：当前目录没有 `workflow_state.json`。确认成果类型与稳定 workflow ID 后调用
`iph_bootstrap`；它只创建合法 BOOT state 与 lifecycle pointer，不选创新路径、不推进。

研究模式：从当前目录向上选择最近的 `workflow_state.json` 作为研究根，所以在
`analysis/`、`src/` 等子目录工作仍共享唯一状态。每轮把机器 state 注入 system
prompt；只执行当前 `active_state` 的
`next_required_action`。状态推进只能调用 `iph_advance`。session 停止前自动 strict
validate；失败时只注入一项恢复动作。

## 安全边界

- `write`/`edit`/shell 不得直接改 `workflow_state.json`。
- 只有由 OMP task lifecycle 证明的 `iph-reviewer` 会话能封印 review；agent/thread ID
  由运行时注入，调用方不能提交。已登记产物不可再改，下一 epoch 只能新建文件。
- 所有非 `iph_*` 工具执行前后都会对 state 与 review 工件做快照；即使经由 eval、
  Node 脚本或自定义工具绕过命令正则，修改也会回滚并把工具结果标成错误。
- `lifecycle_state.json` 必须满足 schema、规范指针和由 iph state 推导的活动阶段；漂移
  时只允许检查或运行 `iph_validate`；该工具先重建派生薄指针，再由 Python 独立裁决
  研究 state，避免 lifecycle 与 workflow 同时异常时形成恢复死锁。
- 未获计算权时拦截研究脚本、明显数值/ML inline Python 和实验动词。validator 仍是
  未登记计算与探索数字泄漏的最终兜底。
- `iph_*` 工具输出保留 Python CLI 的 stdout、stderr、退出码及
  READY/INVALID/BLOCKED/MIGRATION_REQUIRED 语义。

## 验收

```bash
bun run check
bun run release:check
```

该命令执行严格 TypeScript 检查、单元/安全测试、真实 OMP extension loader + 工具/hook
E2E、隔离配置目录中的安装/故障回滚/卸载 E2E、用 authoritative iph 对新建 BOOT state
做 strict 验证，并检查插件、代理、命令、schema 和配置交付物齐全。`release:check` 还
生成并解包 npm tarball，验证公开 provenance 配置、runtime-only 文件清单、解包后的真实
OMP loader 和安装器。GitHub CI 会从固定 commit checkout 上游并运行其完整 pytest 回归
套件。

实际发布只通过手动触发的 `release` workflow：默认 `dry_run=true`，显式关闭后仍需
`npm-release` environment 审批，并拒绝覆盖 registry 中已存在的版本；workflow 使用
npm trusted publishing/OIDC 附加 provenance，并在打包前把 `repository.url` 精确绑定到
实际运行 workflow 的公开 GitHub 仓库。当前仓库不会因普通 push 或 tag 自动发布。

npm 首次发布前还不存在 package，因而无法预先建立 trusted publisher：仅第一次在
`npm-release` environment 临时配置具备 publish 权限的 granular `NPM_TOKEN`；发布后立即
在 npm package settings 中把 `release.yml`、该 GitHub 仓库和 `npm-release` environment
登记为 trusted publisher，删除 secret，后续即走纯 OIDC。workflow 未配置 token 时不会
写入空 `_authToken`，避免阻断 OIDC exchange。
