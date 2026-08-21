# Outcome

在 `harden-multi-user-gateway` 已建立的多用户安全边界之上，把本机已知最新 `dsh-passwords` (`7704b59` / `v2.5.1`) 的定向加固和 `dsh-pocket` (`a0b953f`) 的 cloudflared 下载可靠性行为独立实现到 `dsh-access`。增强 Cookie、路径、模型输入、SSRF、dsh rc.7 兼容、工作区/聊天体验和远程组件安装可靠性，不替换 dsh-access 的账号、权限、网关或隧道架构。

# Scope

- 统一 Gateway 与 Plugin 的 Cookie 精确解析：只剥 ASCII OWS、精确匹配名称并保留值中的 `=`。
- 在登录门和代理分派前拒绝编码、双编码、压平及未知的 `/gateway` 变形路径。
- 在模型输入边界净化隐藏 Unicode 和危险 HTML/CSS：覆盖 session history 与聊天写入；文件 `read/raw/download` 保持原始内容。
- 加固 dsh-ssh/远程主机 SSRF 防护：覆盖 IPv4、IPv6、inet_aton 变体、IPv4-mapped/compatible IPv6、链路本地和 hostname 解析。
- 核验并修复代理响应改写后的 Content-Length、Transfer-Encoding 和 Content-Encoding 一致性。
- 兼容 dsh 0.1.0-rc.6 与 rc.7 的 slot key、namespace 白名单变化、workspace 搜索补丁和可选目标缺失。
- 优化 workspace/session 搜索无结果状态、浏览器自动填充、聊天 `since` 增量轮询、请求重叠和数据库重置基线。
- 增加按账号隐藏聊天入口、位置持久化、头像/气泡、乐观发送、错误恢复、动画与渐进触感反馈。
- 独立实现 cloudflared 下载超时/取消、下载单飞、流式临时文件、尺寸校验、隔离解压、验证后原子安装和安全镜像回退。
- 使用 dsh-passwords 的 ownership 场景补强 `harden-multi-user-gateway` 回归测试，不新建第二套 session ownership 实现。

# Non-goals

- 不重新实现账号生命周期、workspace assignment、session ownership、权限撤销、服务端 session/workspace 过滤或 request-policy 基础架构。
- 不整体合并 dsh-passwords 或 dsh-pocket，不替换 package/plugin 名称、数据库、3088 Gateway、3080 本机服务或 `/api/dsh-access/*` 路由。
- 不修改文件 `read/raw/download` 的原始内容。
- 不引入 dsh-pocket 的独立公网 PIN。
- 不引入流式 gzip/brotli、Range 并发下载、自动更新服务或内置第三方下载代理。
- 不动态发现清华 Homebrew bottle，不扩大默认二进制供应链信任范围。
- 不复制 dsh-pocket GPL v2 代码或注释；只根据行为独立实现。

# Acceptance examples

- A1：Cookie 名称精确匹配，只剥 ASCII space/tab，值中的 `=` 被保留；Unicode 空白伪造 Cookie 不能认证，Gateway 与 Plugin 行为一致。
- A2：编码、双编码、压平和未知 `/gateway` 变形路径不能绕过登录门或代理到上游；合法 Gateway API 与本机 3080 行为不变。
- A3：session history 和聊天写入中的隐藏 Unicode、危险 HTML/CSS 在模型输入边界被净化，普通文本、换行和数学比较符保留；文件 `read/raw/download` 保真。
- A4：dsh-ssh 主机操作拒绝回环、私网、链路本地、未指定地址、IPv4 变体、mapped/compatible IPv6，以及任一解析结果为私网的 hostname；公网地址正常放行，DNS 失败时拒绝。
- A5：被过滤、净化或重新压缩的响应不同时发送 Content-Length 与 Transfer-Encoding，也不保留失效 Content-Encoding；透明响应无回归。
- A6：既有多用户架构继续保证 session ownership、workspace 响应隔离、sandbox 降级和权限撤销；本 change 不增加平行 ownership 表或判断路径。
- A7：dsh rc.6/rc.7 下 slot 和 patch 状态判断正确；rc.7 缺少旧白名单时不误报 missing，可选 workspace 目标缺失不阻塞核心补丁。
- A8：workspace/session 搜索无结果可通过外部点击收起清空，浏览器自动填充不会污染搜索字段。
- A9：聊天轮询使用 since 增量且不重叠；空数据库建立稳定基线，数据库重置或 ID 回退后重建基线且不产生 phantom 未读。
- A10：聊天入口默认显示并可按当前账号隐藏/恢复，隐藏不删除消息；拖动位置按账号持久化且不误触打开。
- A11：聊天消息支持头像、发送者元信息、现有标签和乐观发送；失败可恢复并显示错误，动画/触感遵守减少动画偏好。
- A12：cloudflared 下载支持总超时/取消和同一 home 单飞，按官方源后显式 HTTPS 镜像顺序回退，日志不泄露完整镜像 URL。
- A13：cloudflared 响应流式写入唯一临时文件，小于 1 MiB、解压失败或 `--version` 验证失败均被清理；仅验证成功后原子替换，既有有效缓存不被失败下载破坏。
- A14：认证、Admin/Guest、ownership、远程访问、3088/3080、WebSocket/SSE 的现有测试无回归，完整测试与构建通过。

# Constraints and invariants

- 来源基线暂为本机已知的 `dsh-passwords@7704b59` 与 `dsh-pocket@a0b953f`；GitHub 拉取超时，网络恢复后在验收前重新 fetch 并复核差异。
- `harden-multi-user-gateway` 是账号、workspace、session ownership 与 request policy 的唯一权威实现。
- 新安全拒绝必须 fail-closed，但不得误拒 Admin、本机 3080 或合法 Guest workspace。
- 模型输入边界净化不得静默修改用户读取或下载的文件内容。
- dsh rc.7 兼容必须同时兼容 rc.6。
- 聊天显示偏好按访问管理账号隔离；位置仅作为按账号命名的本地 UI 偏好。
- cloudflared 默认只信任 Cloudflare 官方源；部署者显式配置的 HTTPS 镜像排在官方源后。
- dsh-passwords BSD-3-Clause 来源须保留所需版权声明；dsh-pocket GPL v2 仅作行为参考，不复制实现。

# Decisions

- 本 change 是 `harden-multi-user-gateway` 之后的增量 change，删除旧探索实现中的重复 ownership 数据库和授权路径。
- 内容净化采用“模型输入边界净化”：session history 与聊天净化，`read/raw/download` 保真。
- dsh-pocket 只纳入 cloudflared 下载可靠性；流式压缩另开 change。
- 下载源采用官方源加用户显式配置镜像，不内置第三方代理、TUNA bottle 或 Range 下载。
- 安全边界先于 UI 和下载可靠性实施；每项行为按测试先行实现。

# Open questions

# Verification expectations

- 在独立 worktree 运行定向测试、`npm test` 和 `npm run build`。
- 新增 Cookie/path、净化与文件保真、SSRF/DNS、rc.7 patch、workspace search、chat polling/preference/UI、cloudflared 安装事务测试。
- 运行既有 ownership、权限撤销、认证、远程访问、3088/3080、WebSocket/SSE 回归测试。
- 静态检查没有 dsh-passwords 旧名称/路由或 dsh-pocket PIN/GPL 实现进入产品。
