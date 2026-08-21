---
generated_from_state_version: 17
---

# Verification

## Current result

- Result: **Failed**
- Assurance: **skill-coordinated**
- Goal cycle: 2
- Iteration: 3
- Verifier attempt: 1
- Completed: 2026-08-21T08:07:05.253Z
- Summary: The four previously reported repair areas improved substantially: mounted chat preference synchronization, capped optimistic rendering and direct atomic rename are fixed, and later callers can cancel their own singleflight wait. The candidate still fails semantic acceptance because absolute-form gateway dot-segment targets can fall through upstream, HTML file responses are not byte-preserving, initial chat polling is not baseline-first and rebuilds retain stale epoch messages, shared download cancellation remains coupled to the first caller, and an invalid executable PATH candidate prevents fallback to a valid cache.

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：Cookie 名称精确匹配，只剥 ASCII space/tab，值中的 `=` 被保留；Unicode 空白伪造 Cookie 不能认证，Gateway 与 Plugin 行为一致。 | src/cookie.ts performs shared exact-name parsing, trims only ASCII space/tab, splits at the first equals sign, preserves remaining equals, and is used by both Gateway and Plugin; targeted tests cover Unicode whitespace. |
| A2 | failed | brief.md | A2：编码、双编码、压平和未知 `/gateway` 变形路径不能绕过登录门或代理到上游；合法 Gateway API 与本机 3080 行为不变。 | Preserve and validate the raw path of absolute-form request targets before WHATWG URL normalization: classifyGatewayRequestTarget currently classifies absolute targets such as http://example.test/gateway/%2e%2e/api/session.list as upstream because rawPathOf loses the original /gateway claim. |
| A3 | failed | brief.md | A3：session history 和聊天写入中的隐藏 Unicode、危险 HTML/CSS 在模型输入边界被净化，普通文本、换行和数学比较符保留；文件 `read/raw/download` 保真。 | Exclude file-content read/raw/download responses from the generic text/html injection branch in src/gateway.ts; an HTML file returned by /aionui-panel/raw is currently modified by INJECT_SCRIPT, violating byte fidelity. |
| A4 | passed | brief.md | A4：dsh-ssh 主机操作拒绝回环、私网、链路本地、未指定地址、IPv4 变体、mapped/compatible IPv6，以及任一解析结果为私网的 hostname；公网地址正常放行，DNS 失败时拒绝。 | src/ssrf-policy.ts rejects required IPv4, inet_aton, IPv6 mapped/compatible, private, link-local and unspecified forms, fails closed on DNS errors or mixed-private answers, and Gateway rewrites an allowed hostname to its resolved public address. |
| A5 | passed | brief.md | A5：被过滤、净化或重新压缩的响应不同时发送 Content-Length 与 Transfer-Encoding，也不保留失效 Content-Encoding；透明响应无回归。 | headersForRewrittenBody removes stale length, transfer and content encodings, while compressResponseBody always removes Transfer-Encoding before assigning Content-Length; targeted header tests pass. |
| A6 | passed | brief.md | A6：既有多用户架构继续保证 session ownership、workspace 响应隔离、sandbox 降级和权限撤销；本 change 不增加平行 ownership 表或判断路径。 | The diff adds no parallel ownership table or authorization authority and retains existing workspace/session filtering, sandbox enforcement and active-connection revocation; the capability scan and full regressions passed. |
| A7 | passed | brief.md | A7：dsh rc.6/rc.7 下 slot 和 patch 状态判断正确；rc.7 缺少旧白名单时不误报 missing，可选 workspace 目标缺失不阻塞核心补丁。 | Stable slot keys were added, rc.6 whitelist entries are appended without replacement, rc.7 whitelist absence is satisfied, and missing optional workspace files do not block core patching. |
| A8 | passed | brief.md | A8：workspace/session 搜索无结果可通过外部点击收起清空，浏览器自动填充不会污染搜索字段。 | The optional workspace patch clears and collapses a completed zero-result search on outside interaction and adds autocomplete=off with a noncredential field name. |
| A9 | failed | brief.md | A9：聊天轮询使用 since 增量且不重叠；空数据库建立稳定基线，数据库重置或 ID 回退后重建基线且不产生 phantom 未读。 | Establish a nonempty baseline before using since: pollUrl emits ?since=0 while initialized is false, so databases with more than 300 visible messages load the oldest page first and count subsequent preexisting pages as unread. Initial polling should fetch the latest baseline and set the cursor to latestId. |
| A10 | passed | brief.md | A10：聊天入口默认显示并可按当前账号隐藏/恢复，隐藏不删除消息；拖动位置按账号持久化且不误触打开。 | The mounted launcher now listens for dsh-access-chat-enabled events, guards its initial fetch against races, and the settings page publishes both optimistic changes and rollback; visibility and drag position remain account-scoped without deleting messages. |
| A11 | passed | brief.md | A11：聊天消息支持头像、发送者元信息、现有标签和乐观发送；失败可恢复并显示错误，动画/触感遵守减少动画偏好。 | mergeById reserves capped history space for optimistic messages, and sending renders avatar/sender/tag metadata, replaces successful temporary messages, and restores draft/tags with an error on failure. |
| A12 | failed | brief.md | A12：cloudflared 下载支持总超时/取消和同一 home 单飞，按官方源后显式 HTTPS 镜像顺序回退，日志不泄露完整镜像 URL。 | Decouple the shared download transaction from only the first caller's AbortSignal, or reference-count waiters: aborting the first caller currently aborts ensureCloudflaredOnce and rejects later non-aborted callers sharing the same-home transaction. |
| A13 | passed | brief.md | A13：cloudflared 响应流式写入唯一临时文件，小于 1 MiB、解压失败或 `--version` 验证失败均被清理；仅验证成功后原子替换，既有有效缓存不被失败下载破坏。 | Downloads stream into per-attempt temporary directories, undersized or invalid candidates are cleaned, candidates are type/permission/version checked, and verified same-filesystem candidates replace the canonical cache with renameSync. |
| A14 | passed | brief.md | A14：认证、Admin/Guest、ownership、远程访问、3088/3080、WebSocket/SSE 的现有测试无回归，完整测试与构建通过。 | Reported runtime evidence passes npm test 169/169, production build, git diff --check, forbidden-boundary scan and package-notice-v2. |
| A15 | passed | specs/chat-experience/spec.md | 聊天入口默认显示，并允许当前访问管理账号在设置中隐藏/恢复；偏好由服务端按账号保存，消息数据不删除。 | Chat visibility defaults enabled, is stored under chat_enabled:<authenticated-user-id>, and now synchronizes immediately between the mounted settings section and launcher without modifying message records. |
| A16 | passed | specs/chat-experience/spec.md | 聊天气泡支持拖动，位置保存在按当前账号命名的本地 UI 偏好中；点击打开不能被拖动误触发。 | Pointer drag state uses a movement threshold to suppress opening and persists coordinates under dsh-access-chat-position:<account-id>. |
| A17 | passed | specs/chat-experience/spec.md | 消息气泡支持头像、发送者元信息、现有议题标签和乐观发送；发送失败恢复状态并显示错误。 | Messages render avatars, sender metadata and tags; capped-history optimistic messages remain visible, successful sends replace them, and failed sends restore composer state and expose the error. |
| A18 | failed | specs/chat-experience/spec.md | 保留 dsh-access 现有账号权限、消息 API、未读统计和移动端 safe-area/抽屉适配。 | Restore the prior unread baseline behavior for histories over 300 messages: starting with since=0 paginates old messages as if newly arrived, regressing unread statistics even though recipient filtering and mobile safe-area styling remain intact. |
| A19 | passed | specs/chat-experience/spec.md | 触感反馈和动画仅作渐进增强，并遵守 `prefers-reduced-motion`。 | Haptics are feature-detected and skipped under prefers-reduced-motion, whose CSS rule disables launcher, backdrop, panel and message animations/transitions. |
| A20 | failed | specs/cloudflared-download-hardening/spec.md | 优先使用 PATH 与既有有效缓存；缓存缺失时，同一 home 的并发调用复用一次下载事务。 | Fall through to verified cache candidates when an executable PATH entry fails cloudflared --version; ensureCloudflaredOnce currently throws immediately from verifyDownloadedExecutable(fromPath), preventing use of an existing valid cache. |
| A21 | failed | specs/cloudflared-download-hardening/spec.md | 每次下载有总超时并传播调用方取消；响应体流式写入唯一临时文件，不把完整二进制缓冲在内存。 | Make cancellation waiter-specific without allowing the first caller's signal to terminate the transaction for later active callers; the new race lets a later caller cancel its wait, but the shared operation still uses only the first caller's signal. |
| A22 | passed | specs/cloudflared-download-hardening/spec.md | 下载顺序为 Cloudflare 官方源，其后为 `DSH_ACCESS_CLOUDFLARED_MIRRORS` 显式配置的 HTTPS 镜像；不内置第三方代理，错误不回显完整 URL 或 query。 | Sources are ordered official Cloudflare first followed only by explicitly configured HTTPS mirrors, and failure messages use generic source labels without exposing hostnames, query strings or complete URLs. |
| A23 | passed | specs/cloudflared-download-hardening/spec.md | 每个来源失败后清理半截文件；小于 1 MiB 的下载视为无效。 | Each source has an isolated attempt directory removed in finally, stream errors remove partial files, and payloads below 1 MiB are rejected. |
| A24 | passed | specs/cloudflared-download-hardening/spec.md | tgz 只解压到隔离临时目录；候选文件须通过类型、权限和 `cloudflared --version` 验证。 | tgz processing occurs in an isolated transaction directory after unsafe pathname checks; the located candidate must be a regular file, is made executable and must pass cloudflared --version. |
| A25 | passed | specs/cloudflared-download-hardening/spec.md | 仅在全部验证通过后原子替换正式缓存；失败不得删除或破坏此前有效缓存。 | The repair no longer moves the canonical executable aside first; a fully verified candidate is renamed directly over the same-filesystem cache path, while failed attempts leave an existing valid cache untouched. |
| A26 | passed | specs/cloudflared-download-hardening/spec.md | 不实现 Range 并发下载、动态 Homebrew bottle 发现、自动更新或独立公网 PIN。 | No Range downloader, dynamic Homebrew discovery, automatic updater, public PIN or built-in third-party proxy was introduced; the forbidden-capability scan passed. |
| A27 | passed | specs/dsh-rc7-compat/spec.md | slot 注册提供新版要求的稳定 key，同时保持 rc.6 行为。 | Settings, account, overlay, chat and token registrations now provide stable keys while the rc.6 dependency build remains successful. |
| A28 | passed | specs/dsh-rc7-compat/spec.md | settings/whitelist 补丁探测 rc.6 的 `WEB_SETTINGS_NAMESPACES` 和 rc.7 移除该常量两种结构。 | whitelistPatchApplicable distinguishes rc.6 content containing WEB_SETTINGS_NAMESPACES from rc.7 content where it is absent, with fixtures for both. |
| A29 | passed | specs/dsh-rc7-compat/spec.md | rc.7 缺少旧 namespace 白名单时，状态视为已满足而不是 missing。 | patchStatus reports whitelist satisfied when WEB_SETTINGS_NAMESPACES is absent, and rc.7 patch application remains idempotent. |
| A30 | passed | specs/dsh-rc7-compat/spec.md | workspace 搜索粘滞态和自动填充补丁为可选补丁；目标文件不存在时不阻塞核心 host/settings 补丁。 | Workspace search/autofill patching is conditional on the optional target; absence reports workspaceSearch satisfied and does not block host-mode or whitelist work. |
| A31 | passed | specs/security-hardening/spec.md | Gateway 与 Plugin 使用一致的 Cookie 解析：仅剥 ASCII space/tab，按第一个 `=` 分割，名称精确匹配并保留值内其余 `=`；Unicode 空白不得参与认证。 | Gateway and Plugin import the same readCookie implementation, which enforces exact names, ASCII OWS only, first-equals splitting and Unicode-whitespace rejection. |
| A32 | failed | specs/security-hardening/spec.md | 登录门和代理分派前规范化并校验路径；编码、双编码、压平和未知 `/gateway` 变形路由必须 fail-closed，合法 Gateway API 与 3080 本机入口不变。 | Reject reserved paths before parsing absolute-form URLs with new URL(): dot-segment normalization currently erases the /gateway prefix and allows absolute-form /gateway/../... or /gateway/%2e%2e/... targets to be classified and proxied upstream. |
| A33 | failed | specs/security-hardening/spec.md | session history 与聊天写入在模型输入边界清洗隐藏 Unicode 和危险 HTML/CSS，保留正常文本、换行、比较符；文件 `read/raw/download` 不改写。 | Protect file fidelity explicitly in the response dispatcher: session history and chat are sanitized correctly, but the path-agnostic HTML injection branch can still rewrite HTML bytes returned by file raw/download endpoints. |
| A34 | passed | specs/security-hardening/spec.md | dsh-ssh 主机地址按 socket 语义识别 IPv4/IPv6、inet_aton 变体和 mapped/compatible IPv6；拒绝回环、私网、链路本地、未指定地址。hostname 解析失败或任一结果不安全时拒绝。 | The SSRF policy handles required socket-form IPv4/IPv6 inputs, rejects unsafe or failed DNS resolution, and permits tested public literals and all-public hostnames. |
| A35 | passed | specs/security-hardening/spec.md | 任何响应过滤、净化或重压缩都必须清理失效的 Content-Length、Transfer-Encoding 与 Content-Encoding 组合。 | Successful filtered, sanitized and recompressed response paths remove stale Transfer-Encoding, Content-Length and Content-Encoding combinations before emitting their replacement bodies. |
| A36 | passed | specs/security-hardening/spec.md | session ownership、workspace 过滤、sandbox 降级和权限撤销复用 `harden-multi-user-gateway`，仅补回归场景，不增加平行状态或授权路径。 | No new ownership schema or decision path appears; existing request policy, workspace/session isolation, sandbox downgrade and revocation mechanisms remain authoritative. |
| A37 | passed | specs/workspace-session-experience/spec.md | workspace 搜索无匹配后点击外部可以收起并清空搜索状态。 | The workspace patch changes outside-click handling so a completed nonempty search with no remote results clears its query and collapses. |
| A38 | passed | specs/workspace-session-experience/spec.md | 会话搜索输入关闭浏览器账号和密码自动填充。 | The session search input patch adds autoComplete: off and the dedicated name dsh-access-session-search. |
| A39 | failed | specs/workspace-session-experience/spec.md | 聊天消息轮询在建立基线后使用 `since` 增量，同一时刻至多一个请求。 | Use the full/latest endpoint while ChatPollState.initialized is false; current pollUrl uses since=0 before any baseline exists, contrary to the required baseline-then-incremental sequence and causing paged backlog unread errors. |
| A40 | failed | specs/workspace-session-experience/spec.md | 空数据库建立稳定基线；数据库重置或 ID 回退时只重新建立基线，不产生未读幻觉。 | Replace confirmed message history when rebuilding after an epoch change or ID rollback instead of mergeById-merging the full baseline into the prior epoch; otherwise old high-ID messages survive permanently even though unread is reset. |
| A41 | passed | specs/workspace-session-experience/spec.md | 组件卸载后不得由迟到的轮询响应更新状态。 | Polling cleanup marks the effect disposed, clears its interval, guards load entry and response-driven state updates, and prevents scheduled rebuild loads after unmount. |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| Full test suite | test | . | passed | 0 | 8376 ms |
| Production TypeScript and client build | run build | . | passed | 0 | 3256 ms |
| Git diff whitespace validation | diff --check main...HEAD | . | passed | 0 | 50 ms |
| Forbidden capability boundary scan | -lc set -o pipefail; if git diff main...HEAD -- . ':!docs/comet/changes/sync-dsh-passwords-hardening/**' \| rg -i 'session_owner\|ghproxy\.net\|gh\.ddlc\.top\|gh-proxy\.com\|range.*download\|dynamic.*homebrew\|public.*pin'; then echo 'forbidden capability marker found' >&2; exit 1; fi | . | passed | 0 | 68 ms |
| Published package retains third-party notice | -e const {execFileSync}=require('node:child_process');const p=JSON.parse(execFileSync('npm',['pack','--dry-run','--json'],{encoding:'utf8'}))[0];if(!p.files.some(f=>f.path==='THIRD_PARTY_NOTICES.md'))process.exit(1);console.log('notice included; files='+p.files.length) | . | passed | 0 | 1018 ms |

## Blockers

_None._

## Risks and skipped work

_None reported._

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native target specification declarations changed | 2026-08-21T05:45:36.621Z |
| 2 | 1 | 1 | recovery | — | Independent review found important gaps; implementation changed after candidate b8d5431, invalidate that candidate and return to Build | 2026-08-21T06:08:41.845Z |
| 2 | 2 | 1 | execution-error | — | Independent verifier infrastructure did not execute the accepted task: Codex startup was blocked by a local hooks-review prompt, and the retry Gemini terminal remained at an empty input prompt for 30 minutes with no task transcript or response. No semantic acceptance result was produced. | 2026-08-21T07:25:53.378Z |
| 2 | 2 | 2 | fail | A10, A11, A12, A13, A15, A17, A21, A25 | Runtime quality gates all pass, including 166 tests, build, diff, boundary scan, and corrected package notice. Semantic verification nevertheless found four actionable defects represented by eight acceptance failures: chat visibility preference is not synchronized with the mounted launcher, optimistic messages disappear at the 200-message cap, later singleflight callers cannot cancel, and cloudflared cache replacement is not truly atomic. | 2026-08-21T07:40:04.506Z |
| 2 | 3 | 1 | fail | A2, A3, A9, A12, A18, A20, A21, A32, A33, A39, A40 | The four previously reported repair areas improved substantially: mounted chat preference synchronization, capped optimistic rendering and direct atomic rename are fixed, and later callers can cancel their own singleflight wait. The candidate still fails semantic acceptance because absolute-form gateway dot-segment targets can fall through upstream, HTML file responses are not byte-preserving, initial chat polling is not baseline-first and rebuilds retain stale epoch messages, shared download cancellation remains coupled to the first caller, and an invalid executable PATH candidate prevents fallback to a valid cache. | 2026-08-21T08:07:05.253Z |

## Conclusion

The four previously reported repair areas improved substantially: mounted chat preference synchronization, capped optimistic rendering and direct atomic rename are fixed, and later callers can cancel their own singleflight wait. The candidate still fails semantic acceptance because absolute-form gateway dot-segment targets can fall through upstream, HTML file responses are not byte-preserving, initial chat polling is not baseline-first and rebuilds retain stale epoch messages, shared download cancellation remains coupled to the first caller, and an invalid executable PATH candidate prevents fallback to a valid cache.
