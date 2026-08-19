# Outcome

将当前访问管理插件从旧包名/旧仓库名完整重命名为 `dsh-access`，新包版本为 `1.0.0`。页面继续显示“访问管理”，技术标识、插件名、CLI、包名、设置 section、API 路径和文档统一使用 `dsh-access`；本 change 只提交本地候选并合并到本地 `main`，GitHub 推送延期到后续独立事项。旧 fork 保留，由用户手动删除。

# Scope

- `package.json` 的 package name、bin、exports、版本、仓库/homepage/bugs 地址改为 `dsh-access` / `xiongx9527/dsh-access`。
- 插件导出名、客户端 section id、slot id、运行时日志前缀和测试标识改为 `dsh-access`。
- 所有旧 API 路径改为 `/api/dsh-access/*`，客户端、网关策略、测试和文档同步更新。
- 旧环境变量 `DSH_PASSWORDS_ENV_FILE` 改为 `DSH_ACCESS_ENV_FILE`，安装脚本和运行说明同步更新。
- 用户可见名称统一为“访问管理” / “Access management”，不显示旧包名或旧仓库名。
- 新包版本固定为 `1.0.0`，更新 package-lock 和安装/升级说明。
- 在本地 change 分支提交候选，并在验收完成后合并到本地 `main`；本 change 不推送 GitHub。
- 保留数据库、`.env` 数据格式、网关端口、账号权限和远程访问行为。

# Non-goals

- 不改变账号、权限、配额、工作区、二维码、隧道或移动端行为。
- 不迁移或删除用户数据库、密钥、cloudflared 缓存或运行数据。
- 不自动删除旧 GitHub fork `xiongx9527/dsh-passwords-ext`。
- 不保留旧包名对应的 API、插件 ID、环境变量或 npm 包别名；这是一次明确的全量重命名。
- 不修改原上游仓库。
- 不在本 change 中创建 PR、推送 GitHub 或修改远程仓库；远程同步作为后续独立事项。
- 不把既有数据库的原账号登录、完整 DSH Web/LAN/远程 API 链路作为本 change 的硬验收项；仅记录已完成的包安装、数据库副本启动和网关 smoke。

# Acceptance examples

- A1：`package.json` 的 `name`、`version`、`bin`、exports、repository、homepage 和 bugs 全部指向 `dsh-access` / `1.0.0` / 新仓库。
- A2：源代码、客户端 bundle、测试、安装脚本和活跃文档中不再出现旧技术标识；历史 Git 提交不要求改写。
- A3：`/api/dsh-access/*` 路由可用，旧 API 路径不存在且不会被客户端引用。
- A4：插件导出名、settings section id、客户端注册 id、运行时环境变量和日志标识统一以 `dsh-access` 命名。
- A5：设置侧栏仍显示“访问管理”，页面两个 Tab 仍显示“账号权限”和“远程访问”；页面不出现旧包名。
- A6：登录页、未配置错误、HTTP 警告和文档中的用户可见品牌显示“访问管理” / “Access management”。
- A7：新包 `dsh-access@1.0.0` 可构建、可打包、可安装；`npm test` 和 `npm run build` 通过。
- A8：新包可安装并启动访问管理网关，使用既有数据库副本启动时数据库结构和账户数据保持不变；原账号登录及完整 DSH Web/LAN/远程 API 链路作为后续验证。
- A9：本地候选源代码、测试和包内容保持干净；候选已提交到 change 分支，并可在归档时合并到本地 `main`。
- A10：旧 fork `xiongx9527/dsh-passwords-ext` 不被本 change 修改或删除，用户可后续手动处理。

# Constraints and invariants

- 新 package version 必须是 `1.0.0`。
- UI 品牌名称固定为“访问管理” / “Access management”。
- 旧包名相关技术标识不保留兼容别名。
- 数据库、SETUP_KEY 派生密钥和现有 `.env` 数据不变。
- 本 change 不修改远程仓库；GitHub 仓库状态不作为本地归档前提。
- 当前 Native change 使用独立 worktree，目标分支为 `main`。

# Decisions

- canonical package/plugin/repository/CLI name: `dsh-access`。
- new package version: `1.0.0`。
- user-facing name: `访问管理`。
- old API and env aliases: removed, not retained。
- old fork: keep; user manually deletes it after inspecting the new repository。
- GitHub migration: defer remote push and repository synchronization to a later independent change; this change only merges the verified candidate into local `main`.

# Open questions

- 无。用户已确认 `dsh-access`、版本 `1.0.0`、旧 fork 保留并手动删除。

# Verification expectations

- 用 `git grep` 检查活跃源代码、测试和文档中的旧技术标识。
- 运行 `npm test`、`npm run build`、`npm pack --dry-run`。
- 在临时运行目录安装新包，验证 DSH 3080、访问管理网关和数据库登录。
- 验证 change 分支提交、工作区状态和本地 `main` 合并结果；不运行 GitHub push。
- 记录既有数据库完整登录链路尚未执行为已知限制，不阻塞本地归档。
