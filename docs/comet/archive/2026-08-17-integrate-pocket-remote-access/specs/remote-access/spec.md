# Passwords 统一远程访问规格

## 设置界面

- Passwords 设置卡片具有两个顶层 Tab：“账号与权限”和“远程访问”。
- 默认 Tab 是“账号与权限”。该 Tab 展示并保留完整的账号、用户名、密码、子用户、权限、配额和工作区管理能力。
- 卡片公共区域继续展示补丁状态、重载补丁操作、网关端口输入、保存按钮和当前端口提示。
- “远程访问”Tab 不重复显示端口输入框。
- “远程访问”Tab 依次展示统一入口状态条、局域网访问卡片和公网临时访问卡片。

## 统一入口状态

- 状态条显示 Passwords 网关是否运行、当前实际端口以及远程访问必须登录。
- 网关未运行或状态读取失败时显示明确错误，不展示“可访问”。
- 独立 Pocket 3081 入口不属于该能力，插件不得监听 3081。

## 局域网地址与二维码

- 系统从当前网络接口中选择最可能被手机访问的 IPv4。
- loopback、internal 和 `169.254.0.0/16` 地址不可选。
- RFC1918 私网地址优先；物理 Wi-Fi/Ethernet 接口优先；VPN 和虚拟接口降低优先级。
- 有可用地址时生成 `http://<LAN_IP>:<gateway_port>`。
- LAN URL 的二维码在本地生成，二维码内容仅为 URL。
- 无可用地址时 `lanIp`、`lanUrl` 和 `lanQr` 均为 `null`，客户端显示不可用原因。
- 复制按钮复制当前状态返回的 URL，不从旧端口或硬编码 IP 生成。

## 登录与权限边界

- LAN 和公网 URL 都进入 Passwords 网关。
- 未登录页面请求跳转到 `/gateway/login`。
- 登录后的页面、HTTP API、SSE 和 WebSocket 使用现有账号实时校验、封禁、删除、凭据版本、请求策略和连接撤销逻辑。
- 远程访问状态、隧道启动和隧道停止 API 仅允许 Admin。
- API 响应不得包含密码、JWT、内部管理密钥、数据库密钥或 cloudflared 私密启动参数。

## 远程访问 API

插件提供以下 exact 路由：

- `GET /api/dsh-access/remote-access/status`
- `POST /api/dsh-access/remote-access/tunnel/start`
- `POST /api/dsh-access/remote-access/tunnel/stop`

状态响应的完整公开模型为：

```ts
interface RemoteAccessStatus {
  gatewayPort: number;
  gatewayRunning: boolean;
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

- 状态读取是幂等操作。
- 重复启动复用同一 in-flight 启动，不创建多个 cloudflared 子进程。
- 停止操作可重复调用；空闲状态停止仍返回空闲状态。

## Cloudflare 临时隧道

- 隧道目标只能是本机 Passwords 网关的当前端口。
- 隧道不得直接连接 DSH 3080，也不得使用 Pocket 3081。
- cloudflared 可执行文件保存在 Passwords 数据目录的专用子目录。
- 下载和启动过程公开安全的阶段和错误摘要，不公开敏感命令行数据。
- 识别到 `https://*.trycloudflare.com` URL 后进入运行状态并生成二维码。
- 进程异常退出进入错误状态并清理 URL。
- 显式停止、插件卸载、宿主退出和端口切换均终止旧进程。

## 端口切换

- 端口继续通过现有网关配置 API校验、持久化和重启。
- 保存成功的定义是新网关已确认监听，而不是仅写入环境文件。
- 保存成功后客户端自动切到“远程访问”，重新请求状态并使用实际端口更新状态条、URL 和二维码。
- 如果隧道运行中，端口切换先停止旧隧道；客户端展示空闲状态，用户可重新开启指向新端口的隧道。
- 保存失败时保留上一份已确认可用的远程状态并显示错误。

## LAN HTTP 兼容与移动端

- DSH HTML 在缺少 `crypto.randomUUID` 的非安全上下文中注入一次兼容实现；已有实现时不覆盖。
- 兼容实现使用 `crypto.getRandomValues` 生成 UUID v4。
- 远程页面在 320px 宽度下没有水平溢出。
- 移动端能够打开/关闭侧栏，空会话和会话页均可访问导航入口。
- 主要内容、会话输出、输入区和设置页适配触控尺寸与安全区。
- 移动行为独立实现；不直接复制 `dsh-pocket` 的 GPL-2.0 服务端或组合代码。

## 兼容与迁移

- 安装 `dsh-access` 后不要求安装 `dsh-pocket`。
- 已安装 Pocket 时不自动卸载；文档提示停止或移除 Pocket 以避免重复入口和端口占用。
- 不迁移 Pocket 的临时隧道 URL、进程状态或缓存。
- 继续使用现有 Passwords SQLite、认证、权限和网关配置。
- Node.js 版本要求保持 `>=22.5`。

## 验证要求

- LAN 选择、二维码刷新、隧道状态机、Admin 鉴权、端口切换和客户端 Tab 行为具有自动化测试。
- 完整测试和构建命令分别为 `npm test` 与 `npm run build`。
- 运行验证覆盖本机 3080、LAN 网关登录、HTTP/SSE/WebSocket、端口切换和临时公网隧道。
