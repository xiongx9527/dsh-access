# Harden Multi-User Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `dsh-passwords-ext` 扩展为可在单个 DSH 实例前提供可管理账号、即时会话撤销、单目录工作区隔离、角色化设置权限和明确登录身份/退出入口的网关。

**Architecture:** 保持 DSH `127.0.0.1:3080` 原样运行，所有多用户控制集中在网关。把账号状态和工作区分配作为 SQLite 中的唯一事实源；每个 HTTP/WS/SSE 请求都重新验证账号、`banned` 和凭据版本；路径访问统一经过真实路径边界策略；客户端通过网关自有 API 获取身份和账户管理数据，并只做表现层隐藏，安全拒绝始终由服务端完成。

**Tech Stack:** Node.js 22、TypeScript、Express、`node:sqlite`、JWT、React 18、esbuild、Node `node:test` + `tsx`。

**Spec:** `docs/comet/changes/harden-multi-user-gateway/specs/multi-user-gateway/spec.md`

## Global Constraints

- 不修改 DeepSeek Harness 源码，`3080` 保持 loopback 管理入口。
- 网关上游必须保持 loopback；页面不可将上游配置为对外监听。
- 每个子用户必须且只能拥有一个规范化工作区根目录；空列表不再代表全部允许。
- 使用现有 `user_permissions.banned` 作为唯一可逆停用字段，不新增 `enabled`。
- Admin 不能删除、封禁或降级自己；系统始终保留至少一个有效 Admin。
- 删除用户不删除工作区文件；改名不移动已有工作区目录。
- 隔离为网关逻辑隔离，不宣称操作系统、容器或独立实例级硬隔离。
- SQLite 迁移必须幂等并兼容原版 `dsh-passwords` 数据。

---

### Task 1: 测试基线与安全领域模型

**Files:**
- Modify: `package.json`
- Create: `tests/helpers.ts`
- Create: `tests/database.test.ts`
- Create: `tests/path-policy.test.ts`
- Create: `src/path-policy.ts`

**Interfaces:**
- Produces: `resolveAuthorizedRoot(input): AuthorizedRootResult`
- Produces: `authorizePath(root, candidate, options): Promise<PathAuthorizationResult>`
- Produces: 数据库中的 `remark`、`workspace_mode`、`workspace_root`、`credential_version`

- [ ] 写数据库迁移、单根目录约束、真实路径边界、编码穿越、相似前缀和符号链接逃逸的失败测试。
- [ ] 运行 `npm test -- tests/database.test.ts tests/path-policy.test.ts`，确认因字段/模块缺失而失败。
- [ ] 实现最小迁移和路径策略，使测试通过。
- [ ] 运行定向测试和 `npm run build`。

### Task 2: 账号生命周期和即时会话撤销

**Files:**
- Modify: `src/db.ts`
- Modify: `src/auth.ts`
- Create: `src/session-registry.ts`
- Create: `tests/auth-lifecycle.test.ts`
- Create: `tests/session-registry.test.ts`

**Interfaces:**
- Consumes: Task 1 的账号字段和唯一工作区分配。
- Produces: `AuthService.resolveSession(token)`，返回实时用户、角色、状态和权限。
- Produces: `SessionRegistry.track(userId, connection)` / `revoke(userId, reason)`。

- [ ] 写删除、封禁、解封、改密、改名和旧 token 失效测试。
- [ ] 确认测试先失败。
- [ ] 取消会掩盖状态变化的 30 秒授权缓存，统一每请求校验账号存在、`banned`、凭据版本。
- [ ] 实现按用户索引的 WS/SSE 连接注册和即时关闭。
- [ ] 验证 Admin 自保护规则与审计记录。

### Task 3: 单目录工作区分配和迁移

**Files:**
- Modify: `src/config.ts`
- Modify: `src/db.ts`
- Modify: `src/auth.ts`
- Modify: `src/plugin.ts`
- Create: `src/workspace-assignment.ts`
- Create: `tests/workspace-assignment.test.ts`

**Interfaces:**
- Produces: `assignUsernameWorkspace(user, baseRoot)` 和 `assignSpecifiedWorkspace(user, path)`。
- Produces: `workspace_mode: 'username' | 'specified' | 'repair-required'`。

- [ ] 写按用户名创建目录、指定目录、非法路径原子失败、旧单目录迁移、空/多目录待修复测试。
- [ ] 确认测试先失败。
- [ ] 实现默认工作区根配置和幂等迁移。
- [ ] 通过 Host `workspaceRegistry` 注册/复用工作区；失败时回滚数据库权限。
- [ ] 验证删除不删文件、改名不移动目录。

### Task 4: 网关请求、设置和路径授权策略

**Files:**
- Modify: `src/permissions.ts`
- Modify: `src/gateway.ts`
- Create: `src/request-policy.ts`
- Create: `tests/request-policy.test.ts`
- Create: `tests/gateway-access.test.ts`

**Interfaces:**
- Consumes: `authorizePath` 和实时会话解析。
- Produces: `classifyRequest(method, pathname, body): RequestDecision`。

- [ ] 写 Admin/子用户设置读写矩阵、未知高风险写入默认拒绝、工作区/会话/文件/Git/上传路径授权测试。
- [ ] 确认测试先失败。
- [ ] 实现设置写接口、Provider/凭据/API Key/插件/全局 Permission 的 403 策略。
- [ ] 将所有目标路径统一交给真实路径授权，不再以空 `allowed_folders` 表示无限制。
- [ ] 在发送响应前过滤 Workspace、Session、搜索和目录数据。
- [ ] 验证沙盒不能超过 Admin 分配等级。

### Task 5: 网关账户中心、当前身份和退出登录

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/client/index.tsx`
- Modify: `src/client/card.tsx`
- Modify: `src/client/locales.ts`
- Create: `src/client/account.tsx`
- Create: `tests/gateway-account-api.test.ts`

**Interfaces:**
- Produces: `GET /gateway/api/me`、`POST /gateway/api/logout`。
- Produces: Admin 独立账户中心 API，包含备注、`banned`、工作区模式和根目录。

- [ ] 写当前用户、权限摘要、退出后旧 Cookie 失效、Admin 自保护、备注仅 Admin 可见测试。
- [ ] 确认测试先失败。
- [ ] 实现侧边栏常驻账号入口、用户名/角色/权限摘要和退出操作。
- [ ] Admin 显示账户中心；子用户不依赖 DSH 设置页完成账户操作。
- [ ] 子用户隐藏 DSH 设置入口；Admin 保持原生设置入口。
- [ ] 明文 HTTP 下为 Admin 显示醒目的凭据传输风险提示。

### Task 6: 网关监听配置与可恢复应用

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Modify: `src/gateway.ts`
- Create: `src/gateway-config.ts`
- Create: `tests/gateway-config.test.ts`

**Interfaces:**
- Produces: 本机/LAN/指定本地 IP 三种绑定模式及端口配置。
- Produces: 原子配置写入、启动探测、失败回滚。

- [ ] 写监听地址验证、端口冲突、上游 loopback 不可修改和回滚测试。
- [ ] 确认测试先失败。
- [ ] 实现 Admin 配置 API 和页面。
- [ ] 先验证新地址/端口可绑定，再原子持久化并重启；失败恢复旧配置。
- [ ] 验证 `3080` 仅 loopback、网关按配置监听。

### Task 7: 完整构建、回归和 Native Builder handoff

**Files:**
- Modify: `README.md`
- Modify: `README_en.md`
- Modify: `.env.example`
- Modify: `docs/comet/changes/harden-multi-user-gateway/brief.md`（仅当实现暴露需同步的用户可见限制）

**Interfaces:**
- Consumes: Tasks 1-6 的全部实现。
- Produces: 可供独立 Verifier 验收的 Builder candidate。

- [ ] 运行 `npm test`、`npm run build`。
- [ ] 用临时数据库执行 setup、Admin/子用户登录、禁用/删除即时撤销、工作区越界 403、退出登录和设置权限接口回归。
- [ ] 启动本机双入口，确认 `127.0.0.1:3080` 保持管理能力，网关入口按配置工作。
- [ ] 记录未能自动验证的局域网外部设备条件，不将本机自请求等同于真实 LAN 验证。
- [ ] 生成 Builder handoff JSON，逐项列出已覆盖验收项、检查结果和已知限制。
- [ ] 通过 `comet native next harden-multi-user-gateway --runner-input <file>` 提交候选，随后启动全新的只读 Verifier subagent。
