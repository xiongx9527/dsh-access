# Outcome

在 `dsh-access` 内提供统一的远程访问能力：Passwords 设置卡片保留公共状态与网关端口配置，并拆成“账号与权限”和“远程访问”两个 Tab；所有局域网二维码和 Cloudflare 临时隧道都指向 Passwords 登录网关，访问前必须登录，不再依赖或暴露独立的 Pocket 3081 入口。

# Scope

- 在现有 Passwords 设置卡片中加入两个 Tab：“账号与权限”和“远程访问”。
- “账号与权限”完整保留当前修改密码、修改用户名、子用户、权限、配额和工作区管理内容。
- “远程访问”展示统一入口状态、当前网关端口、局域网 IPv4、登录 URL、二维码、复制按钮和错误状态。
- 提供 Cloudflare 临时隧道的启动、停止、进度、错误、临时 HTTPS URL 和二维码。
- 保存网关端口后重启登录网关，自动切换到“远程访问”，并刷新状态条、LAN URL、二维码和隧道目标端口。
- 远程访问状态和隧道控制只允许 Admin；子用户不能读取管理状态或操作隧道。
- 为 LAN HTTP 场景保留并验证 `crypto.randomUUID` 兼容补丁，并实现适配窄屏 DSH 页面所需的移动端布局。
- 更新依赖、双语文案、安装/升级说明和停用独立 `dsh-pocket` 的迁移提示。

# Non-goals

- 不修改 DeepSeek Harness 核心源码或把 3080 改成对外监听。
- 不提供绕过 Passwords 登录的匿名入口。
- 不保留、启动或兼容独立的 Pocket 3081 代理进程。
- 不自动卸载用户已安装的 `dsh-pocket`。
- 不实现固定域名、Cloudflare 账号隧道、长期隧道或路由器端口映射。
- 不修复 Android VPN、AP 隔离、访客网络或其他局域网基础设施问题。
- 不重新设计账号、权限、配额、封禁和工作区模型。
- 不直接复制 `dsh-pocket` 的 GPL-2.0 服务端实现；远程服务按确认行为独立实现。

# Acceptance examples

- A1：Passwords 设置卡片显示“账号与权限”和“远程访问”两个 Tab，默认打开“账号与权限”。
- A2：“账号与权限”保留现有修改密码、修改用户名、子用户创建/搜索/删除、权限、配额和工作区管理行为，现有相关测试无回归。
- A3：网关端口、当前端口提示和“保存端口”位于两个 Tab 之外的公共区域，不在页面中重复出现。
- A4：Admin 打开“远程访问”时看到绿色统一入口状态条，内容包含当前网关端口和“访问前必须登录”。
- A5：Admin 能看到系统选出的 LAN IPv4、`http://<LAN_IP>:<gateway_port>` 登录 URL、对应二维码和复制按钮；无可用 LAN 地址时显示明确不可用状态而不是错误地址。
- A6：LAN IPv4 选择优先 RFC1918 私网物理网卡，排除 loopback、link-local，并降低 VPN/虚拟网卡优先级。
- A7：手机或另一台电脑打开 LAN URL 时，未登录请求进入 Passwords 登录页；登录后的 HTTP、SSE 和 WebSocket 继续经过现有账号与权限检查。
- A8：未登录用户和子用户调用远程访问状态、隧道启动或隧道停止接口时分别得到 `401` 或 `403`；Admin 可以调用。
- A9：远程访问状态只返回端口、LAN IP/URL/二维码和隧道公开状态，不包含密码、JWT、内部管理密钥或进程命令行秘密。
- A10：Admin 开启公网临时访问后，界面按“下载中、启动中、运行中、停止中、错误”展示状态；运行时显示 `trycloudflare.com` HTTPS URL、二维码和复制按钮。
- A11：Cloudflare 隧道始终指向当前 Passwords 网关端口，不能指向 3080 或 3081；关闭后 cloudflared 子进程退出且 URL 清空。
- A12：并发或重复启动隧道只创建一个启动流程；服务退出、网关端口切换或显式停止时不会遗留 cloudflared 进程。
- A13：保存新网关端口成功后，页面自动切换到“远程访问”，重新请求状态，并更新状态条、LAN URL、二维码和隧道目标端口。
- A14：新端口无效或重启失败时，页面显示错误且不把旧 URL/二维码伪装成新端口已生效。
- A15：经 LAN 明文 HTTP 访问时，`crypto.randomUUID` 缺失不会导致 DSH 客户端崩溃，兼容脚本不会重复注入。
- A16：320px 宽度下远程访问 Tab、二维码、URL、按钮和 DSH 主要会话界面无横向溢出，侧栏可通过移动端导航打开和关闭。
- A17：项目不引入或复制 Pocket 的 GPL-2.0 服务端源码；如复用 MIT 来源的移动端思想或素材，保留来源和许可证声明。
- A18：`npm test` 与 `npm run build` 通过；本机 3080 直连保持可用，局域网电脑可通过 Passwords 网关完成登录，公网隧道可完成登录和 WebSocket 流式通信。

# Constraints and invariants

- Node.js 版本要求保持 `>=22.5`。
- Passwords 网关是唯一远程入口；3080 保持 loopback，3081 不由本插件监听。
- 所有远程访问必须经过现有 JWT、凭据版本、封禁、删除、请求策略和连接撤销逻辑。
- 远程访问管理 API 使用 `/api/dsh-access/remote-access/*` 命名空间并仅允许 Admin。
- 网关端口仍由现有 `/api/dsh-access/gateway/config` 写入和 `GatewayRuntime.restart(port)` 应用。
- 远程模块必须与 `src/gateway.ts`、账号管理和工作区策略解耦，避免继续扩大核心代理文件。
- 二维码仅编码 URL，不承担认证功能。
- cloudflared 文件和运行状态只保存在 Passwords 数据目录内。
- 不修改用户本地网络、VPN、路由器或防火墙配置。

# Decisions

- 使用当前确认的双 Tab 原型；不新增独立“手机访问”侧边栏入口。
- 网关端口是两个 Tab 的公共配置；保存成功后自动刷新并切换到远程访问。
- 3088（或用户配置端口）统一承载局域网和公网登录流量。
- Cloudflare 临时隧道只连接 Passwords 网关，且控制权仅属于 Admin。
- `dsh-pocket` 不作为依赖；服务端能力独立实现，避免 GPL-2.0 代码混入 BSD-3-Clause 项目。
- 该需求紧密修改同一插件、网关生命周期和设置卡片，保持单一 Native change，不拆成 Supervisor Change。
- Comet Runtime 因现有 active change 强制使用独立 worktree，目标分支为 `feature/integrate-pocket-remote-access`。

# Open questions

- 无。用户已确认最终原型、双 Tab、账号内容保留、端口变化刷新行为，并明确要求在 `dsh-access` 中实现。

# Verification expectations

- 开发期按 TDD 增加 LAN 选择、状态刷新、隧道状态机、API 鉴权、端口切换和客户端结构测试。
- 每个任务完成后运行对应单测，并在候选提交前运行完整 `npm test` 和 `npm run build`。
- Verifier 逐项检查 A1-A18，不以 Builder 摘要代替源码、测试和运行证据。
- 手工运行验证至少覆盖：3080 本机直连、LAN 3088 登录、端口切换、Android/窄屏页面和 Cloudflare 隧道登录/流式通信；外部网络条件不可用时明确标记阻塞而不是伪造通过。
