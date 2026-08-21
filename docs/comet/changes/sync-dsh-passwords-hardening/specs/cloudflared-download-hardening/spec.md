# cloudflared 下载可靠性规格

- 优先使用 PATH 与既有有效缓存；缓存缺失时，同一 home 的并发调用复用一次下载事务。
- 每次下载有总超时并传播调用方取消；响应体流式写入唯一临时文件，不把完整二进制缓冲在内存。
- 下载顺序为 Cloudflare 官方源，其后为 `DSH_ACCESS_CLOUDFLARED_MIRRORS` 显式配置的 HTTPS 镜像；不内置第三方代理，错误不回显完整 URL 或 query。
- 每个来源失败后清理半截文件；小于 1 MiB 的下载视为无效。
- tgz 只解压到隔离临时目录；候选文件须通过类型、权限和 `cloudflared --version` 验证。
- 仅在全部验证通过后原子替换正式缓存；失败不得删除或破坏此前有效缓存。
- 不实现 Range 并发下载、动态 Homebrew bottle 发现、自动更新或独立公网 PIN。
