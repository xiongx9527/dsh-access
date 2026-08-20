---
generated_from_state_version: 91
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 12
- Verifier attempt: 1
- Completed: 2026-08-20T13:20:53.879Z
- Summary: 第12轮第1次独立只读 Verifier：Admin 通过真实 dsh-access Host route 完成隔离 profile 插件 GET、install、disable、enable、remove 生命周期，最终 dependencies/bundles 恢复干净；Provider/API Key/global Permission、真实网关回滚、跨进程 SSE/WebSocket、HTML失效轮询和浏览器双角色证据保持通过。A1-A66 全部 66 项 passed，0 failed，0 blocked。npm test 129 passed/0 failed，build、tsc、pack 55 files、diff-check 通过。整体 verdict=pass。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：通过网关登录后，侧边栏常驻显示当前用户名和角色；点击账户入口可查看权限摘要并退出，退出后返回登录页且旧 Cookie 不再放行。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A2 | passed | brief.md | A2：Admin 通过网关入口访问时，DSH 原生设置按钮保持可见且完整设置可用；子用户通过网关访问时设置按钮不可见，直接进入设置页面或调用设置写接口被拒绝；本机 `127.0.0.1:3080` 访问保持原行为。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A3 | passed | brief.md | A3：网关 Admin 可以添加、删除或修改模型 Provider、API Key、插件和全局 Permission；网关子用户只能读取页面初始化所需的主题、语言和已有模型列表并选择已有模型，不能执行这些全局设置写入。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A4 | passed | brief.md | A4：Admin 可在账户中心创建子用户并选择“按用户名”或“指定目录”；未选择分配方式、指定模式未选目录或试图选择多个目录时不能保存。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A5 | passed | brief.md | A5：按用户名创建 `alice` 时，系统在配置根目录下创建 `alice` 目录、注册 DSH Workspace，并将该规范化目录保存为 Alice 唯一允许区域。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A6 | passed | brief.md | A6：指定目录模式保存后，该规范化目录成为用户唯一允许区域；目录不存在、不可访问或无法规范化时保存失败且原权限不变。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A7 | passed | brief.md | A7：子用户登录后，工作区列表、会话列表和目录浏览只显示其根目录及子目录；Admin 仍可查看全部工作区和会话。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A8 | passed | brief.md | A8：区域外绝对路径、`..` 穿越、编码后的穿越路径和通过符号链接逃逸均被 Host/网关拒绝，返回明确的 `403`，且不执行目标操作。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A9 | passed | brief.md | A9：子用户不能在区域外创建或分叉会话、读取或写入文件、上传文件或执行 Git 下载；未知的高风险写入入口对受限用户默认拒绝。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A10 | passed | brief.md | A10：Admin 可把网关配置为仅本机、局域网或指定监听地址，并修改网关端口；DSH 上游保持 loopback 且不可在页面中改成对外监听，失败应用自动恢复上一份可用配置。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A11 | passed | brief.md | A11：旧子用户若已有一个合法允许目录，则保留为“指定目录”；没有合法单目录分配的旧用户必须先完成分配才可进入工作区，不再把空列表解释为允许全部。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A12 | passed | brief.md | A12：删除用户不会删除其工作区文件；用户名变更默认保留原工作区路径并在 UI 中明确提示。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A13 | passed | brief.md | A13：在当前 Node/DSH 环境完成构建、自动化测试和本地双入口验证：`3080` 仅 loopback，网关入口执行账户、目录和设置限制。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A14 | passed | brief.md | A14：Admin 删除或封禁子账号后，该账号的所有后续 HTTP 操作立即被拒绝，活跃 WebSocket/SSE 被关闭，已打开页面显示“账号已被删除或已停用，当前登录已失效”并跳转登录页；Admin 收到成功提示。已经开始运行的 DSH 任务不回滚，但该账号不能继续查看或控制。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A15 | passed | brief.md | A15：主账号不能通过网关删除、封禁或降级自己，系统始终保留一个有效主账号；主账号改名或改密码后，全部旧登录和长连接立即失效，所有页面提示“管理员凭据已变更，请重新登录”并跳转登录页。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A16 | passed | brief.md | A16：Admin 可为每个子账号维护可选备注并切换现有 `banned` 状态；备注仅 Admin 可见。`banned = true` 后该账号立即不能登录或继续操作，全部旧认证和长连接失效并收到停用提示；恢复为 `false` 后只能通过新登录恢复。主账号不能被标记为 `banned`。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A17 | passed | specs/multi-user-gateway/spec.md | 系统在单个 DSH Host 前提供一个登录网关。角色分为主用户 Admin 和子用户。Admin 通过网关管理账号、网关配置以及 DSH 全局设置；子用户通过网关使用 Admin 已配置好的 DSH 能力。DSH 本机上游入口同样保留模型、凭据、插件和全局设置管理。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A18 | passed | specs/multi-user-gateway/spec.md | DSH 上游必须监听 loopback，默认 `127.0.0.1:3080`。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A19 | passed | specs/multi-user-gateway/spec.md | 网关监听配置支持：仅本机 `127.0.0.1`、局域网 `0.0.0.0`、或一个经过验证的指定本机地址。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A20 | passed | specs/multi-user-gateway/spec.md | 网关端口可由 Admin 配置；当前默认体验端口为 `3088`。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A21 | passed | specs/multi-user-gateway/spec.md | 上游地址在网关管理页面只读，不能配置为非 loopback。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A22 | passed | specs/multi-user-gateway/spec.md | 监听配置变更先验证并保存上一版本，再重启网关；新配置启动失败必须恢复上一版本。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A23 | passed | specs/multi-user-gateway/spec.md | HTTP 局域网模式显示明文传输警告。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A24 | passed | specs/multi-user-gateway/spec.md | 网关页面常驻显示当前用户名和角色。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A25 | passed | specs/multi-user-gateway/spec.md | 账户菜单展示当前工作区、沙盒、上传/Git 开关和配额摘要。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A26 | passed | specs/multi-user-gateway/spec.md | 账户菜单提供退出登录；退出必须清除网关认证 Cookie 并跳转登录页。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A27 | passed | specs/multi-user-gateway/spec.md | Admin 账户菜单提供子用户、工作区分配、权限和网络配置管理。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A28 | passed | specs/multi-user-gateway/spec.md | 子用户只能修改自己的密码，不能管理其他用户或网络设置。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A29 | passed | specs/multi-user-gateway/spec.md | Admin 删除或封禁子用户时，网关立即使该用户的现有认证失效，关闭其活跃 WebSocket/SSE，并向已打开页面发送账号失效提示后跳转登录页。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A30 | passed | specs/multi-user-gateway/spec.md | Admin 删除成功后看到明确反馈。已经由 DSH 接受并开始运行的任务不回滚或自动取消，但被删除用户不能继续查看、控制或发起操作。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A31 | passed | specs/multi-user-gateway/spec.md | 主账号不能通过网关删除、封禁或降级自己，系统不能进入无有效主账号状态。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A32 | passed | specs/multi-user-gateway/spec.md | 主账号修改用户名或密码时，全部旧认证与活跃长连接立即失效；发起变更的页面和其他设备均显示管理员凭据已变更提示并跳转登录页。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A33 | passed | specs/multi-user-gateway/spec.md | 每个子账号具有可选管理备注，并继续使用现有 `banned` 作为账号停用状态。备注仅 Admin 可读写，不参与登录身份、目录路径或权限判断。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A34 | passed | specs/multi-user-gateway/spec.md | 子账号默认 `banned = false`；Admin 设置 `banned = true` 后，网关立即拒绝其登录和后续请求、关闭活跃 WebSocket/SSE，并显示账号已停用提示。恢复为 `false` 不恢复旧会话，用户必须重新登录。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A35 | passed | specs/multi-user-gateway/spec.md | 主账号不能被设置为 `banned = true`。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A36 | passed | specs/multi-user-gateway/spec.md | 每个子用户必须且只能拥有一个授权根目录。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A37 | passed | specs/multi-user-gateway/spec.md | 创建或编辑子用户时，Admin 选择“按用户名”或“指定目录”。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A38 | passed | specs/multi-user-gateway/spec.md | 按用户名模式使用 `<configured-root>/<username>`，创建缺失目录，规范化真实路径，注册或复用 DSH Workspace，并保存为唯一授权根目录。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A39 | passed | specs/multi-user-gateway/spec.md | 默认用户工作区根目录为数据库目录旁的 `workspaces/`，可由部署配置覆盖。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A40 | passed | specs/multi-user-gateway/spec.md | 指定模式通过目录选择控件选择一个目录。目录必须存在、可访问且可规范化；系统注册或复用对应 Workspace 后保存为唯一授权根目录。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A41 | passed | specs/multi-user-gateway/spec.md | 指定模式不能多选，任何模式都不能保存空授权。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A42 | passed | specs/multi-user-gateway/spec.md | 旧用户恰有一个合法允许目录时迁移为指定模式；空目录、多个目录或非法目录状态需要 Admin 修复，修复前不能访问工作区。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A43 | passed | specs/multi-user-gateway/spec.md | 用户改名不自动移动目录；删除用户不删除目录、Workspace 文件或会话日志。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A44 | passed | specs/multi-user-gateway/spec.md | Admin 的工作区和会话列表不受过滤。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A45 | passed | specs/multi-user-gateway/spec.md | 子用户只接收授权根目录及其子目录对应的 Workspace、Session 和文件树条目。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A46 | passed | specs/multi-user-gateway/spec.md | 区域外 Workspace、Session、搜索结果和目录条目不得先下发再由 UI 隐藏。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A47 | passed | specs/multi-user-gateway/spec.md | 目录浏览根固定在授权根目录，不能导航到父目录。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A48 | passed | specs/multi-user-gateway/spec.md | 所有路径在授权前进行 URL 解码、平台规范化和真实路径边界判断。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A49 | passed | specs/multi-user-gateway/spec.md | 已存在目标以真实路径判断；新目标以最近存在父目录的真实路径判断。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A50 | passed | specs/multi-user-gateway/spec.md | `..`、编码穿越、相似前缀目录和符号链接逃逸必须拒绝。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A51 | passed | specs/multi-user-gateway/spec.md | 子用户区域外的新建/分叉会话、Workspace 变更、文件读取/写入/上传、Git 下载和高风险工具操作返回 `403`，且不得部分执行。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A52 | passed | specs/multi-user-gateway/spec.md | 子用户不能将沙盒权限提升到高于 Admin 分配的级别。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A53 | passed | specs/multi-user-gateway/spec.md | 对受限用户无法安全分类的新写入或执行入口默认拒绝；只读静态资源和页面初始化流量可放行。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A54 | passed | specs/multi-user-gateway/spec.md | 网关页面按角色控制 DSH 原生设置入口：Admin 保持可见并拥有完整设置能力；子用户隐藏设置入口。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A55 | passed | specs/multi-user-gateway/spec.md | Admin 通过网关可以管理模型 Provider、凭据、API Key、插件和全局 Permission。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A56 | passed | specs/multi-user-gateway/spec.md | 子用户可以读取主题、语言、模型列表和页面初始化所需的非敏感设置，并在会话中选择 Admin 已配置的模型。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A57 | passed | specs/multi-user-gateway/spec.md | 子用户调用设置写入、模型 Provider 增删改、凭据 set/unset、API Key 修改、插件安装/卸载/启停或全局 Permission 修改时，网关返回 `403`。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A58 | passed | specs/multi-user-gateway/spec.md | 子用户直接进入设置页面或通过直链触发设置 UI 时，网关返回首页或明确的无权访问提示。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A59 | passed | specs/multi-user-gateway/spec.md | `dsh-access` 自身的账户与网关管理使用独立账户入口，不依赖子用户不可见的 DSH 原生设置页面。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A60 | passed | specs/multi-user-gateway/spec.md | 网关为明文 HTTP 时，Admin 设置页面必须醒目提示模型凭据和会话数据传输未加密。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A61 | passed | specs/multi-user-gateway/spec.md | 继续使用现有 SQLite 用户、认证、权限、用量和审计数据。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A62 | passed | specs/multi-user-gateway/spec.md | 新增工作区分配模式、根目录和账号备注需支持幂等迁移，并保持合法单目录权限和现有 `user_permissions.banned` 状态不变；不新增第二套停用真值。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A63 | passed | specs/multi-user-gateway/spec.md | 配置、目录、Workspace 和权限更新使用可恢复顺序；失败时恢复旧权限或记录明确待修复状态。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A64 | passed | specs/multi-user-gateway/spec.md | 原版 dsh-access 数据库可在不重建账号的情况下升级使用。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A65 | passed | specs/multi-user-gateway/spec.md | 认证校验不能只依赖 JWT 有效期；每个请求和新建实时连接都要确认账号仍存在、未封禁且凭据版本有效。网关维护按用户索引的活跃长连接，以支持删除和封禁时即时断开。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |
| A66 | passed | specs/multi-user-gateway/spec.md | 该能力提供网关层工作区访问控制，不提供操作系统级租户隔离。它不保证防御本机用户直连 loopback 上游、第三方未受控进程/MCP 或 Host 进程攻破。完全不可信租户需要独立系统账号、容器或独立 DSH 实例。 | 真实 Chrome/HTTP/DSH、自动化回归、真实故障注入、跨进程连接和插件生命周期证据一致，未发现硬失败。 |

## Checks

_No Runtime checks were recorded._

## Blockers

_None._

## Risks and skipped work

- 插件 install/remove/enable/disable 已真实完成，所有操作返回 restartRequired=true；实际 DSH 宿主运行时生效需要按提示重启宿主。
- 当前候选工作区保持未提交，未执行 GitHub push。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A2, A9, A10, A12, A13, A14, A15, A16, A19, A20, A22, A24, A25, A27, A29, A32, A34, A41, A46, A51, A53, A54, A58, A63 | FAIL：A1-A66 已逐项判定；passed=41，failed=24，blocked=1。独立 npm test 为 114 passed/0 failed；tsc --noEmit、npm pack --dry-run 通过；Native runner 的 npm test 与 3080/3088 环境 smoke 通过，但 live smoke 使用的是 ~/.dsh 外部安装包，因此 A13 仍 blocked。当前 change 不能进入 Archive，应回 Build 修复 failed 项。 | 2026-08-19T11:48:59.499Z |
| 1 | 2 | 1 | fail | A9, A13, A14, A15, A16, A19, A22, A27, A29, A32, A34, A41, A46, A51, A63 | Second verification confirms the first repair fixed Admin settings visibility, unknown mutation policy, default 3088, multi-folder input, role display and direct settings routing. Remaining failures are session boundaries, listener host configuration, invalidation UX/revocation, admin network entry and transactional rollback. | 2026-08-19T12:49:15.473Z |
| 1 | 3 | 1 | fail | A9, A10, A13, A14, A15, A16, A22, A27, A28, A29, A32, A34, A46, A51, A63, A65 | Independent read-only verification: 50 passed, 6 failed, 10 blocked. npm test (117 passed), build and pack are successful, but they do not establish complete gateway boundary coverage or all live revocation/rollback behavior. Do not archive; return to Build for failed items and add the blocked integration checks. | 2026-08-19T13:50:49.086Z |
| 1 | 4 | 1 | execution-error | — | 第4轮 Verifier 从 2026-08-19T14:03:43.975Z 起持续显示 running，但本机 Runtime 没有新增检查日志、checks 仍为空，也没有可见的 Verifier 进程或返回结果。为避免无限等待，按执行异常处理并请求 Runtime 安全重试；当前候选代码和主工作区未修改。 | 2026-08-19T14:49:23.752Z |
| 1 | 4 | 2 | fail | A1, A2, A3, A9, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A44, A46, A51, A54, A55, A56, A58, A60, A63, A65 | 当前候选不能通过验收：A9、A46、A51、A63 有源码可确认的安全或事务缺口；其余部分主要缺少真实运行、浏览器、双入口、失败回滚或长连接证据。 | 2026-08-19T15:03:25.048Z |
| 1 | 5 | 1 | fail | A1, A2, A3, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A44, A46, A54, A55, A56, A58, A60, A63, A65 | FAIL：npm test 独立复核 122 passed/0 failed；A9、A51 修复有网关回归测试证据。A10、A46、A63 存在源码可确认缺口；其余缺少真实浏览器、双入口、跨进程长连接或真实 DSH Host 证据的上一轮项目判为 blocked。 | 2026-08-19T15:40:05.261Z |
| 1 | 5 | 1 | recovery | — | 继续当前 harden 目标，按第5轮独立 Verifier 的源码缺口返回 Build：修复 Admin 网关配置入口的 directLocal 限制；将 session.search 响应过滤统一接入真实 realpath/symlink 授权；补齐 legacy /api/dsh-access/permissions 的 Workspace 注册与失败补偿。保留 A1/A2 等端到端验证项为待后续独立运行验收，不改变用户已确认的子账户设置隔离和 Admin 账户管理边界。 | 2026-08-19T15:40:30.452Z |
| 1 | 6 | 1 | blocked | A1, A2, A3, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A44, A54, A55, A56, A58, A60, A63, A65 | 第6轮源码修复已确认 A46 的真实路径过滤接入三类列表接口；A10 已移除 directLocal 限制并保留 Admin guard、host/port 校验、loopback upstream 与回滚路径；A63 已加入 WorkspaceRegistry 补偿，但 legacy 路由和补偿失败闭环缺少直接集成证据。当前无自动化测试失败，但仍有25项 blocked，故整体 verdict 为 blocked。 | 2026-08-19T15:57:17.303Z |
| 1 | 6 | 1 | recovery | — | Verifier 指出 legacy Workspace 补偿失败被静默吞掉；补充明确的 manual-repair 日志，并保持旧权限恢复或 repair-required 逻辑。按 Native 边界返回 Build 重新提交候选。 | 2026-08-19T16:05:00.158Z |
| 1 | 7 | 1 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A21, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A58, A60, A63, A65 | 只读复核结果：npm test 为 122 passed/0 failed；npm run build 通过；npm pack --dry-run 显示 53 files；git diff --check 通过。当前 42 项 passed、0 项 failed、24 项 blocked，因此整体 verdict 为 blocked。A10 的 directLocal、Admin guard、host/port 校验、loopback upstream 与回滚路径已核对，并计入提供的 3081/3099 运行证据，但缺少真实失败回滚；A46 三类列表已接入 realpath/symlink 过滤且回归测试通过；A63 已保留 WorkspaceRegistry、旧权限恢复、repair-required 和 manual-repair 日志，但缺少 legacy 补偿失败的直接运行证据。 | 2026-08-19T16:16:17.289Z |
| 1 | 7 | 3 | execution-error | — | Native Verifier response was invalid: Native Verifier verdict is invalid | 2026-08-20T01:08:14.797Z |
| 1 | 7 | 4 | execution-error | — | Native Verifier response was invalid: Native Verifier summary must be non-empty text | 2026-08-20T01:18:15.506Z |
| 1 | 7 | 5 | execution-error | — | 第7轮第5次 Verifier 从 2026-08-20T01:19:50.382Z 起持续显示 running，但本机 Runtime checks 仍为空、没有新增检查日志，也没有可见的独立 Verifier 进程或结果。按执行异常处理，当前候选代码和主分区未修改。 | 2026-08-20T02:06:28.308Z |
| 1 | 7 | 6 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A58, A60, A65 | 第7轮第6次独立只读 Verifier：npm test 122 passed/0 failed，TypeScript noEmit、npm pack --dry-run（53 files）和 git diff --check 通过；A46、A51、A63 的代码与回归通过，A21 的 gateway/config GET/POST 及 3111 占用 409、3099 保持、remote status 3099 证据通过。无代码硬缺口，42 项 passed、24 项 blocked、0 项 failed；阻塞项集中在真实浏览器双角色、跨进程长连接和真实启动失败回滚证据缺失。 | 2026-08-20T02:18:37.465Z |
| 1 | 7 | 7 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A58, A60, A65 | dsh-access main 工作区只读复核完成。fresh npm test 为 122 passed/0 failed，tsc --noEmit、npm pack --dry-run（53 files）和 git diff --check 均通过，Verifier 未引入文件变更。A1-A66 共 42 项 passed、0 项 failed、24 项 blocked。blocked 仅来自缺真实浏览器双角色、跨进程长连接和失败启动回滚三类验收证据；未发现应判 failed 的源码硬缺口。整体 verdict=blocked，当前不应 Archive。 | 2026-08-20T02:27:33.731Z |
| 1 | 7 | 8 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A58, A60, A65 | 第7轮第8次只读 Verifier 复核完成。fresh npm test 为 122 passed/0 failed，tsc --noEmit、npm pack --dry-run（53 files）和 git diff --check 均通过，Verifier 未引入文件变更。A1-A66 共 42 项 passed、0 项 failed、24 项 blocked。blocked 仅来自缺真实浏览器双角色、跨进程长连接和失败启动回滚三类验收证据；未发现应判 failed 的源码硬缺口。整体 verdict=blocked，当前不应 Archive。 | 2026-08-20T04:32:55.097Z |
| 1 | 7 | 9 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A60, A65 | 第7轮第9次只读 Verifier 完成：A1-A66 共 43 项 passed、0 项 failed、23 项 blocked。当前未发现应判 failed 的源码硬缺口；真实 HTTP E2E 已补强认证、角色隔离、设置重定向、写入拒绝和跨进程旧 Cookie 失效证据，但真实浏览器双角色、跨进程 WebSocket/SSE 即时撤销以及失败启动回滚证据仍不完整，因此整体 verdict=blocked，当前不应 Archive。 | 2026-08-20T05:41:13.892Z |
| 1 | 7 | 10 | blocked | A1, A2, A3, A7, A10, A13, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A58, A60, A65 | 第7轮第10次独立只读 Verifier：fresh npm test 为 122 passed/0 failed，tsc --noEmit、npm pack --dry-run 和 git diff --check 通过；未发现应判 failed 的代码硬缺口。A1-A66 判定为 42 项 passed、0 项 failed、24 项 blocked。阻塞集中在真实浏览器双角色/双入口、跨进程 WebSocket/SSE 即时撤销和真实监听失败回滚证据缺失。 | 2026-08-20T06:16:36.468Z |
| 1 | 7 | 11 | blocked | A1, A2, A3, A7, A10, A14, A15, A16, A22, A23, A24, A25, A27, A29, A30, A32, A34, A54, A55, A56, A60, A65 | 第7轮第11次独立只读 Verifier：真实 DSH 已在临时 DSH_HOME 运行于 127.0.0.1:3180；真实网关 3188 的 Admin/Guest HTTP 角色隔离、Guest 设置 302、设置写入 403、Admin 创建 Guest、第二网关进程旧 Cookie 删除后 401，以及同进程 SSE account-revoked 关闭均已验证。npm test 122 passed，build、tsc、pack 53 files、diff check 通过。A1-A66 判定为 44 项 passed、0 项 failed、22 项 blocked；未发现代码硬失败。 | 2026-08-20T06:28:54.165Z |
| 1 | 7 | 12 | blocked | A3, A7, A10, A14, A15, A16, A22, A29, A30, A32, A34, A55, A56, A65 | 第7轮第12次独立只读 Verifier：通过 Orca 控制真实 Chrome 完成 Admin/Guest 双角色登录；Admin 账户入口显示主账号、明文 HTTP 警告和账户管理，UI 创建 Guest 成功；Guest 入口显示子账号、工作区/沙盒/上传/Git 摘要，直达 settings 被拦截并保持 DSH 主界面。npm test 122 passed，build、tsc、pack 53 files、diff check 通过。A1-A66 判定为 52 项 passed、0 项 failed、14 项 blocked；未发现代码硬失败。 | 2026-08-20T08:57:08.120Z |
| 1 | 7 | 13 | blocked | A3, A10, A14, A15, A16, A22, A29, A30, A32, A34, A55, A65 | 第7轮第13次独立只读 Verifier：真实 Chrome Admin/Guest 双角色、账户管理 UI、明文 HTTP 警告、Guest 设置拦截、Guest 账户摘要、Guest Workspace/Session 列表真实过滤、真实模型选择器，以及真实 DSH 127.0.0.1:3180 均已验证。npm test 122 passed，build、tsc、pack 53 files、diff check 通过。A1-A66 判定为 54 项 passed、0 项 failed、12 项 blocked；未发现代码硬失败。 | 2026-08-20T09:01:09.511Z |
| 1 | 7 | 14 | blocked | A3, A10, A14, A15, A16, A22, A29, A30, A32, A34, A55, A65 | 第7轮第14次独立只读 Verifier：在隔离临时 DSH_HOME/SQLite 中，真实 Admin 通过网关完成 llm-pi-ai Provider displayName 更新、GPT_API_KEY credentials.set 和 llm.discoverModels，返回 21 个模型；原始 ~/.dsh 未修改。此前真实 Chrome 双角色、Workspace/Session 过滤、模型选择器、真实 DSH、HTTP/SSE 和跨进程旧 Cookie 证据保持。npm test 122 passed，build、tsc、pack 53 files、diff check 通过。A1-A66 判定为 54 项 passed、0 项 failed、12 项 blocked；未发现代码硬失败。 | 2026-08-20T09:20:18.261Z |
| 1 | 7 | 14 | recovery | — | 本轮在 Verify 发现真实跨进程 SSE 复现缺口：第二网关进程的现有 SSE 在共享 SQLite 封禁后未关闭。按用户继续要求返回 Build 修复。新增连接周期性实时复核：账号删除、封禁、credential_version 变化会在每个网关进程本地触发连接撤销；新增先红后绿跨进程 SSE 测试。未修改原始 ~/.dsh。 | 2026-08-20T10:15:22.460Z |
| 1 | 8 | 1 | blocked | A3, A10, A15, A22, A29, A30, A32, A34, A55 | 第8轮第1次独立只读 Verifier：共享 SQLite 下第二网关进程 SSE 的封禁撤销缺口已由周期性账号复核修复；先失败后通过的跨进程 SSE 回归测试加入。npm test 123 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。结合此前真实 Chrome 双角色、Workspace/Session 过滤、Provider/API Key 写入和模型发现证据，A1-A66 判定为 57 项 passed、0 项 failed、9 项 blocked；未发现代码硬失败。 | 2026-08-20T10:17:59.507Z |
| 1 | 8 | 1 | recovery | — | 第8轮继续修复 A10/A22：真实 DSH 插件双网关环境中验证了原端口 3198→3201 正常切换；随后通过竞态占用 3202 让新子网关实际启动失败，响应为 500 GATEWAY_RESTART_FAILED，旧端口 3198 恢复 200，配置与 .env 恢复 3198，临时占用端口释放后 3202 关闭。发现并修复端口探活误认外部监听器的问题：新增带 internal secret 和 service 标记的 /gateway/internal/health 探针，父进程只接受真实 dsh-access 子进程就绪。按当前 change 返回 Build 更新候选。 | 2026-08-20T10:28:43.117Z |
| 1 | 9 | 1 | blocked | A3, A15, A29, A30, A32, A34, A55 | 第9轮第1次独立只读 Verifier：真实 DSH 插件环境完成网关端口成功切换和竞态占用导致的启动失败回滚；500 GATEWAY_RESTART_FAILED 后旧端口、旧配置和旧进程恢复，目标端口释放后关闭。第8轮跨进程 SSE 周期性 SQLite 复核也保持通过。npm test 125 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。A1-A66 判定为 59 项 passed、0 项 failed、7 项 blocked；未发现代码硬失败。 | 2026-08-20T10:30:50.531Z |
| 1 | 9 | 2 | blocked | A3, A15, A30, A32, A34, A55 | 第9轮第2次独立只读 Verifier：真实双网关 WebSocket 101 握手和跨进程封禁关闭已通过；第8轮 SSE 复核、第9轮真实启动失败回滚也保持通过。npm test 125 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。A1-A66 判定为 60 项 passed、0 项 failed、6 项 blocked；未发现代码硬失败。 | 2026-08-20T10:35:27.282Z |
| 1 | 9 | 3 | blocked | A3, A15, A30, A32, A34, A55 | 第9轮第3次独立只读 Verifier：真实 Admin 通过网关完成全局 Permission defaultPreset 读写并恢复；Provider/API Key/model discovery、真实配置回滚、跨进程 SSE/WebSocket 撤销保持通过。npm test 125 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。A1-A66 判定为 60 项 passed、0 项 failed、6 项 blocked；未发现代码硬失败。 | 2026-08-20T10:41:01.537Z |
| 1 | 9 | 3 | recovery | — | 第10轮修复剩余浏览器失效反馈：网关 API 鉴权现在区分 ACCOUNT_BANNED、ACCOUNT_DELETED、CREDENTIAL_CHANGED；AccountMenu 除 SSE 外增加每秒 /gateway/api/me 轮询，SSE 中断时仍会按状态跳转 `/gateway/login?reason=...`。新增 UI 回归测试；全量 npm test 126 passed。按当前 change 返回 Build 更新候选。 | 2026-08-20T11:33:27.669Z |
| 1 | 10 | 1 | blocked | A3, A15, A30, A32, A34, A55 | 第10轮第1次独立只读 Verifier：API 失效分类和 AccountMenu 轮询跳转逻辑已加入并通过回归测试；真实 Provider/API Key/global Permission、配置回滚、跨进程 SSE/WebSocket 撤销保持通过。npm test 126 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。A1-A66 判定为 60 项 passed、0 项 failed、6 项 blocked；未发现代码硬失败。 | 2026-08-20T11:36:00.199Z |
| 1 | 10 | 1 | recovery | — | 第11轮增强最终页面失效保障：在网关向上游 HTML 注入一份独立于 DSH client bundle 的 account-revocation polling；每秒调用 /gateway/api/me，识别 ACCOUNT_BANNED/ACCOUNT_DELETED，SSE 中断时也会跳转对应登录 reason。新增 gateway HTML injection 回归测试；全量 npm test 127 passed。未修改原始 ~/.dsh。 | 2026-08-20T12:39:57.138Z |
| 1 | 11 | 1 | blocked | A3, A55 | 第11轮第1次独立只读 Verifier：新增网关 HTML 独立失效轮询后，删除/封禁/改密页面反馈相关 A15/A30/A32/A34 全部通过；Provider/API Key、全局 Permission、真实配置回滚、跨进程 SSE/WebSocket 撤销保持通过。A1-A66 判定为 64 项 passed、0 项 failed、2 项 blocked；剩余仅 A3/A55 的真实插件安装/卸载/启停管理闭环，当前 DSH pluginInventory Host API 明确为只读且无 mutation。npm test 127 passed/0 failed，build、tsc、pack 53 files、diff-check 通过。 | 2026-08-20T12:49:46.663Z |
| 1 | 11 | 1 | recovery | — | 第12轮完成 A3/A55 插件生命周期适配：新增 Admin-only `/api/dsh-access/plugins`，基于隔离 DSH Web profile package.json 管理插件 dependency 与 dsh.profile.bundles，支持 install/remove/enable/disable；安装/卸载使用 pnpm --ignore-scripts，所有变更返回 restartRequired=true；非 Admin 返回 403。临时真实 DSH 插件环境通过网关 Admin Cookie 完成 install→disable→enable→remove，最终 profile 恢复干净。新增 manifest 单测；全量 npm test 129 passed。按当前 change 返回 Build 更新候选。 | 2026-08-20T13:18:44.913Z |
| 1 | 12 | 1 | pass | — | 第12轮第1次独立只读 Verifier：Admin 通过真实 dsh-access Host route 完成隔离 profile 插件 GET、install、disable、enable、remove 生命周期，最终 dependencies/bundles 恢复干净；Provider/API Key/global Permission、真实网关回滚、跨进程 SSE/WebSocket、HTML失效轮询和浏览器双角色证据保持通过。A1-A66 全部 66 项 passed，0 failed，0 blocked。npm test 129 passed/0 failed，build、tsc、pack 55 files、diff-check 通过。整体 verdict=pass。 | 2026-08-20T13:20:53.879Z |

## Conclusion

第12轮第1次独立只读 Verifier：Admin 通过真实 dsh-access Host route 完成隔离 profile 插件 GET、install、disable、enable、remove 生命周期，最终 dependencies/bundles 恢复干净；Provider/API Key/global Permission、真实网关回滚、跨进程 SSE/WebSocket、HTML失效轮询和浏览器双角色证据保持通过。A1-A66 全部 66 项 passed，0 failed，0 blocked。npm test 129 passed/0 failed，build、tsc、pack 55 files、diff-check 通过。整体 verdict=pass。
