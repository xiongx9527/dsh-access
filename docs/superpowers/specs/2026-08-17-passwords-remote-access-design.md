# DSH Passwords 远程访问整合设计

日期：2026-08-17

## 1. 背景

`dsh-access` 已经通过登录网关将远程请求转发到本机 DSH Web，并提供账号、封禁、会话撤销、子用户权限和工作区隔离。`dsh-pocket` 另行启动 3081 代理，提供局域网二维码、Cloudflare 临时隧道和移动端页面适配。

两个插件同时运行会形成两套远程入口：

- Passwords 网关：默认端口 3088，访问前需要登录。
- Pocket 代理：默认端口 3081，负责 Host/Origin 改写、二维码、隧道和移动端适配。

本变更把 Pocket 的远程访问能力整合进 Passwords，以 3088 Passwords 网关作为唯一远程安全入口，不再需要独立的 3081 代理。

## 2. 目标

1. 在现有 Passwords 设置卡片中提供两个 Tab：
   - `账号与权限`
   - `远程访问`
2. `账号与权限` 保留当前修改密码、修改用户名、子用户管理和权限编辑能力。
3. `远程访问` 展示：
   - 统一安全入口运行状态
   - 局域网二维码和登录 URL
   - Cloudflare 临时公网隧道开关、状态、URL 和二维码
4. 网关端口保存成功后，自动刷新远程访问状态、URL、二维码和隧道目标端口。
5. 在 Passwords 客户端独立实现移动端布局适配，并保留现有非安全上下文兼容补丁。
6. 局域网和公网访问都必须经过 Passwords 登录和权限检查。

## 3. 非目标

- 不保留或兼容独立的 Pocket 3081 代理进程。
- 不新增绕过 Passwords 登录的匿名访问模式。
- 不改变 3080 本机 DSH Web 的绑定策略。
- 不重新设计账号、权限、配额和工作区模型。
- 不自动修改路由器端口映射、AP 隔离、VPN 或手机网络设置。
- 不在本变更中实现固定域名、Cloudflare 账号隧道或长期隧道配置。

## 4. 用户界面

### 4.1 公共区域

Passwords 卡片顶部保留：

- `已启用 · 远程连接可用` 状态
- `重载补丁` 操作
- 网关端口输入框和 `保存端口` 按钮
- 当前端口和重启范围提示

端口配置属于两个 Tab 的公共配置，不重复放入任一 Tab。

### 4.2 Tab：账号与权限

默认显示现有内容，不改变已有信息结构：

- 修改密码
- 修改用户名
- 子用户创建、搜索和管理
- 权限、配额和工作区配置

现有 API 和交互行为保持兼容。

### 4.3 Tab：远程访问

页面结构以确认的原型为准：

1. 顶部绿色状态条
   - 文案：`统一安全入口已运行 · 端口 <port> · 访问前必须登录`
2. 局域网访问卡片
   - `可访问` 状态
   - 当前局域网 IPv4
   - 登录 URL：`http://<LAN_IP>:<gateway_port>`
   - URL 二维码
   - `复制地址` 按钮
   - 提示：扫码后先进入 Passwords 登录页，认证成功后再打开 DSH
3. 公网临时访问卡片
   - Cloudflare 临时隧道开关
   - 下载、启动、运行、停止和错误状态
   - 运行时展示 HTTPS URL、二维码和复制按钮
   - 提示临时 URL 会随隧道重启变化

### 4.4 端口变化后的刷新行为

保存端口的流程为：

1. 校验端口。
2. 调用现有网关端口保存 API。
3. 重启 Passwords 登录网关，保持 3080 本机 DSH Web 不变。
4. 新网关确认监听成功后，重新请求远程访问状态。
5. 更新：
   - 顶部统一入口端口
   - 局域网 URL
   - 局域网二维码
   - 公网隧道目标端口
6. 自动切换到 `远程访问` Tab，并显示刷新成功状态。

如果新端口启动失败，界面保留错误信息，不展示已经生效的假状态。

## 5. 架构

### 5.1 唯一入口

远程数据流统一为：

```text
手机 / 远程浏览器
        |
        v
Passwords 网关 :3088（或配置端口）
        |
        +-- 未登录 -> /gateway/login
        |
        +-- 已登录 -> 账号状态、权限与请求策略检查
                         |
                         v
                  DSH Web 127.0.0.1:3080
```

Cloudflare 临时隧道只指向 Passwords 网关：

```text
公网浏览器 -> trycloudflare HTTPS URL -> Passwords 网关 -> DSH Web
```

### 5.2 服务端模块

按确认行为在 Passwords 中独立实现的能力（不复制 Pocket GPL-2.0 服务端代码）：

- LAN IPv4 选择
- 二维码生成和缓存
- cloudflared 下载、启动、停止和 URL 解析
- 隧道状态机与错误信息
- 服务关闭时的子进程清理

建议新增独立模块，避免继续扩大 `src/gateway.ts`：

- `src/remote-access.ts`：LAN 状态、二维码和统一状态快照
- `src/tunnel.ts`：cloudflared 生命周期
- `src/remote-access-routes.ts`：管理员 API 路由及输入校验

现有 `src/gateway.ts` 负责挂载路由、鉴权和将目标端口传给远程访问服务。

### 5.3 客户端模块

建议将远程 UI 独立为：

- `src/client/remote-access.tsx`
- `src/client/mobile/*`

`src/client/card.tsx` 只负责公共状态、端口配置、Tab 状态和组合两个页面。

移动端兼容范围包括：

- 窄屏侧栏抽屉
- 会话页全宽布局
- 移动端导航按钮和遮罩
- 安全区与触控尺寸适配
- `crypto.randomUUID` 非安全上下文兼容补丁

### 5.4 API

新增管理员 API，沿用 `/api/dsh-access/*` 命名空间：

- `GET /api/dsh-access/remote-access/status`
- `POST /api/dsh-access/remote-access/tunnel/start`
- `POST /api/dsh-access/remote-access/tunnel/stop`

状态响应包含：

```ts
interface RemoteAccessStatus {
  gatewayPort: number;
  lanIp: string | null;
  lanUrl: string | null;
  lanQr: string | null;
  tunnel: {
    phase: 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';
    detail: string;
    url: string | null;
    qr: string | null;
    startedAt: number | null;
  };
}
```

远程访问配置和隧道控制仅允许管理员。账号与权限 API 不改变。

## 6. 安全要求

1. LAN URL 和公网隧道都必须落到 Passwords 网关，不能直接转发到 3080。
2. 未登录请求必须进入 `/gateway/login`。
3. 登录后的 HTTP、SSE 和 WebSocket 请求继续使用现有身份、封禁、会话撤销和权限策略。
4. 隧道启动/停止和远程状态 API 只允许管理员。
5. 状态响应不得包含密码、JWT、内部管理密钥或 cloudflared 敏感参数。
6. 二维码只是 URL 的图形表示，不作为认证凭据。
7. cloudflared 下载文件必须限定到 Passwords 数据目录，并验证平台、文件类型和可执行权限。
8. 服务退出、网关重启和端口切换时必须清理旧隧道进程。
9. 继续显示 HTTP 明文警告；公网隧道使用 HTTPS，但最终仍必须登录。

## 7. Pocket 迁移与兼容

- 不直接复制 `dsh-pocket` 的 GPL-2.0 服务端或组合代码；远程访问服务按公开行为和本规格独立实现。
- 如直接复用 MIT 来源的移动端素材，只从原始 MIT 来源引入并保留许可证与版权声明。
- Passwords 安装后不再要求安装 `dsh-pocket`。
- 如果系统仍安装 Pocket，不自动卸载；文档提示停用或移除，避免重复功能和端口占用。
- 不读取或迁移 Pocket 的运行时状态；隧道 URL 本身是临时值。

## 8. 测试与验证

### 8.1 单元测试

- LAN IPv4 选择优先真实物理网卡并排除 VPN/虚拟网卡。
- 无可用 LAN IPv4 时返回 `null`。
- URL 和二维码随网关端口变化刷新。
- 隧道状态机覆盖启动、重复启动、停止、错误和进程退出。
- 管理员可访问远程 API；子用户和未登录请求被拒绝。
- 状态响应不泄露敏感信息。
- 移动端兼容补丁只注入一次。

### 8.2 集成测试

- `http://127.0.0.1:<port>` 和 `http://<LAN_IP>:<port>` 都进入 Passwords 登录页。
- 登录后 HTTP、SSE 和 WebSocket 可以正常使用。
- 封禁、删除或改密后，远程会话立即失效。
- 保存端口后旧端口停止、新端口可用，远程状态返回新 URL。
- Cloudflare 隧道指向当前网关端口，不指向 3080 或 3081。

### 8.3 UI 测试

- 两个 Tab 可切换，默认显示账号与权限。
- 账号与权限内容和行为无回归。
- 远程访问显示状态条、LAN 卡片和公网卡片。
- 保存端口后自动切到远程访问并刷新端口、URL 和二维码。
- 320px 窄屏无横向溢出，移动端侧栏和会话可操作。

### 8.4 完成验证

- `npm test`
- `npm run build`
- 本机 3080 直接访问不受影响
- 另一台局域网电脑访问 Passwords 网关成功
- Android 手机在允许局域网互访的网络上完成登录、会话浏览和操作
- 公网临时隧道完成登录、页面加载和 WebSocket 流式输出

## 9. 交付边界

本变更完成后，Password 插件具备 Pocket 的核心远程访问体验：二维码、临时公网隧道和移动端适配，同时所有远程访问都经过 Passwords 的认证与权限边界。独立 Pocket 插件不再是运行依赖。
