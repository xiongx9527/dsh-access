# Outcome

补齐上一 change 留下的运行验证：使用既有原账号，验证 `dsh-access` 网关与 DSH Web、LAN、远程 HTTP/SSE/WebSocket API 的完整链路；只修复验证中发现的 `dsh-access` 问题。

# Scope

- 使用既有数据库副本和原账号启动当前 `dsh-access` 候选，不重置账号、会话或数据库结构。
- 验证原账号可以通过访问管理网关登录，并保持既有账号身份、权限和会话行为。
- 验证本机 DSH Web 上游、可用 LAN 地址以及远程访问链路均经过访问管理网关，而不是绕过网关直连 DSH 上游。
- 验证登录后的 HTTP、SSE 和 WebSocket 请求可以到达 DSH Web；验证未登录请求不能绕过认证。
- 若验证发现 `dsh-access` 实现问题，补充最小修复和回归测试；若仅为环境限制，记录实际证据，不伪造通过结果。

# Non-goals

- 不重新处理已经完成的包名、插件名、API 前缀、UI 文案和许可证重命名。
- 不改变数据库文件、表结构、账号字段、SETUP_KEY 派生值、密码策略或既有远程访问语义。
- 不修改旧 fork，不推送 GitHub，不修改远程仓库。
- 不把无可用 LAN 网卡、未登录外部隧道服务或其他明确环境限制伪装成实现通过。

# Acceptance examples

- A1：使用既有数据库副本启动 `dsh-access` 后，原账号可以在网关登录页完成登录；数据库结构和原账号记录与启动前快照一致。
- A2：未登录访问网关保护的 DSH Web/API 时进入认证边界；原账号登录后访问本机 DSH Web 可以获得预期页面和会话响应。
- A3：远程状态返回的 LAN 地址使用访问管理网关端口；从可用 LAN 地址访问时仍先经过登录，并且登录后 DSH Web/API 请求可用，不直接暴露上游端口。
- A4：经访问管理网关的已认证 HTTP、SSE 和 WebSocket 请求可以到达 DSH Web；未认证请求被拒绝或重定向，不能绕过访问管理策略。
- A5：`npm test`、`npm run build` 和必要的本地安装/启动 smoke 检查通过；新增修复有对应回归测试。
- A6：候选变更只包含本 change 的实现、测试和正式产物，提交在 `comet/dsh-access-followup`；归档时只合并到本地 `main`，不执行 GitHub push。

# Constraints and invariants

- 已归档的 `rename-to-dsh-access` change 保持不变。
- 保持 `dsh-access@1.0.0`、`dsh-access` CLI、`/api/dsh-access/` 路由和“访问管理”用户可见品牌。
- 保持既有数据库、账号、权限、会话撤销、网关端口和远程访问配置兼容。
- 外部 Cloudflare/公网隧道能力仅在当前环境可运行时验证；不能用环境缺失替代实现证据。

# Decisions

- 使用新 change `dsh-access-followup`，不重新打开已归档的 `rename-to-dsh-access`。
- 本 change 的目标是补齐原账号完整运行链路验证，并对验证发现的问题做最小修复。
- 运行链路范围包含本机 DSH Web、LAN 入口和经网关转发的 HTTP/SSE/WebSocket API。
- 本地验证完成后仅允许合并到本地 `main`，不推送 GitHub。

# Open questions

- 无。用户已确认执行上述后续运行链路范围。

# Verification expectations

- 先检查当前 DSH Web、dsh-access 包和既有数据库/账号运行前状态，保存脱敏快照。
- 运行 `npm test`、`npm run build`，并执行可重复的网关启动、原账号登录、上游页面、LAN 和协议转发 smoke 检查。
- 对 HTTP、SSE、WebSocket 以及未登录边界分别记录实际响应和退出状态；外部环境限制单独标注。
- 验证工作区、候选提交和本地 `main` 收尾范围；不运行 GitHub push。
