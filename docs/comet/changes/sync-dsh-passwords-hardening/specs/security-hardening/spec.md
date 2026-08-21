# 安全增强规格

- Gateway 与 Plugin 使用一致的 Cookie 解析：仅剥 ASCII space/tab，按第一个 `=` 分割，名称精确匹配并保留值内其余 `=`；Unicode 空白不得参与认证。
- 登录门和代理分派前规范化并校验路径；编码、双编码、压平和未知 `/gateway` 变形路由必须 fail-closed，合法 Gateway API 与 3080 本机入口不变。
- session history 与聊天写入在模型输入边界清洗隐藏 Unicode 和危险 HTML/CSS，保留正常文本、换行、比较符；文件 `read/raw/download` 不改写。
- dsh-ssh 主机地址按 socket 语义识别 IPv4/IPv6、inet_aton 变体和 mapped/compatible IPv6；拒绝回环、私网、链路本地、未指定地址。hostname 解析失败或任一结果不安全时拒绝。
- 任何响应过滤、净化或重压缩都必须清理失效的 Content-Length、Transfer-Encoding 与 Content-Encoding 组合。
- session ownership、workspace 过滤、sandbox 降级和权限撤销复用 `harden-multi-user-gateway`，仅补回归场景，不增加平行状态或授权路径。
