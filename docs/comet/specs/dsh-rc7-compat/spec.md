# dsh rc.6/rc.7 兼容规格

- slot 注册提供新版要求的稳定 key，同时保持 rc.6 行为。
- settings/whitelist 补丁探测 rc.6 的 `WEB_SETTINGS_NAMESPACES` 和 rc.7 移除该常量两种结构。
- rc.7 缺少旧 namespace 白名单时，状态视为已满足而不是 missing。
- workspace 搜索粘滞态和自动填充补丁为可选补丁；目标文件不存在时不阻塞核心 host/settings 补丁。
