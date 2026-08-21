// 登录网关：劫持 dsh 访问入口
//   用户访问网关端口 → 未认证则渲染登录页（dsh 风格 + 动画）
//   → 登录成功 Set-Cookie(JWT, HttpOnly) → 302 回到原始 URL（重定向兼容层）
//   → 已认证请求反向代理到上游 dsh（HTTP + WebSocket，Host 改写为上游地址）
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { createSecureContext } from 'node:tls';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import dns from 'node:dns';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type Duplex } from 'node:stream';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import express, { type Request, type Response } from 'express';
import type { PlatformConfig } from './config.js';
import { AuthService, AuthError, type RequestMeta } from './auth.js';
import { Database, type UserPermissionsRow, type MessageRow } from './db.js';
import {
  folderAllowed,
  isUploadRequest,
  isGitRequest,
  isAionuiFileRead,
  isAionuiFileWrite,
  isAionuiPanel,
  aionuiRootFrom,
  isWorkspaceWrite,
  isStaticAsset,
  isPollingRequest,
  isUsageAnchorRequest,
  WORKSPACE_ENDPOINT_RE,
  extractPathFromBody,
  collectIdPathPairs,
  extractWorkspaceId,
  findStringField,
  sandboxPresetRank,
  permissionPresetFromCommand,
  presetFromSettingsMutate,
  forceRejectApproval,
  SANDBOX_RANK,
  todayLocal,
} from './permissions.js';
import { findDshRoot, applyRemotePatch, restartDshWeb } from './patch.js';
import { t, resolveGatewayLang, type Lang } from './i18n.js';
import { assignWorkspace } from './workspace-assignment.js';
import { classifyGatewayRequest } from './request-policy.js';
import { UserConnectionRegistry } from './connection-registry.js';
import { authorizeFilesystemPath } from './path-policy.js';
import { markGatewayProxyHeaders } from './local-access.js';
import { readCookie } from './cookie.js';
import { classifyGatewayPath } from './gateway-path.js';
import { sanitizeJsonStrings, sanitizeText } from './content-sanitization.js';
import { sshHostRequestAllowed } from './ssrf-policy.js';

/** 网关内部扩展请求：权限执行时把用户/权限附在 req 上，供后续中间件与代理读取 */
type Req = Request & {
  dshAccessUser?: number;
  dshAccessPerms?: UserPermissionsRow;
};

export interface GatewayHooks {
  /** Register or idempotently resolve the canonical directory in DSH. */
  ensureWorkspace?: (root: string) => Promise<boolean | void>;
  /** Remove a workspace created by a failed account/permission transaction. */
  removeWorkspace?: (root: string) => Promise<void>;
}

const COOKIE_NAME = 'dsh_gateway_token';
/** 语言偏好 cookie（用户在登录页手动切换后持久化） */
const LANG_COOKIE = 'dsh-access-lang';

/** 解析页面语言：?lang → cookie → dsh 设置(locale.preference) → 浏览器语言 → zh */
function langOf(req: Request): Lang {
  return resolveGatewayLang({
    queryLang: req.query.lang,
    cookieLang: readCookie(req.headers.cookie, LANG_COOKIE),
    acceptLanguage: req.headers['accept-language'],
  });
}

/**
 * 注入 dsh HTML 的兼容脚本：
 * crypto.randomUUID 是 Web Crypto API，只在安全上下文（HTTPS / localhost）
 * 存在；明文 HTTP 部署下 dsh 前端的 RPC id 生成（如加载 Agent 预设）会报
 * "crypto.randomUUID is not a function"。这里用 getRandomValues（HTTP 下
 * 可用）实现 UUID v4 补齐。
 */
const INJECT_SCRIPT = `<script>
(function () {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function') {
    crypto.randomUUID = function () {
      var b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var h = Array.prototype.map.call(b, function (x) {
        return x.toString(16).padStart(2, '0');
      }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
  }
})();
</script>
<script>
(function () {
  var redirected = false;
  var redirect = function (reason) {
    if (redirected) return;
    redirected = true;
    window.location.assign('/gateway/login?reason=' + reason);
  };
  var poll = window.setInterval(function () {
    fetch('/gateway/api/me', { headers: { accept: 'application/json' } })
      .then(function (response) {
        if (response.ok) return;
        return response.json().catch(function () { return {}; }).then(function (body) {
          var reason = body.code === 'ACCOUNT_BANNED' ? 'banned'
            : body.code === 'ACCOUNT_DELETED' ? 'deleted'
              : 'credential-changed';
          redirect(reason);
        });
      })
      .catch(function () {});
  }, 1000);
  window.addEventListener('pagehide', function () { window.clearInterval(poll); });
})();
</script>`;

/**
 * 防开放重定向：next 只允许站内路径。
 * 拒绝一切浏览器可能解析成跨域的形式：
 *   - 反斜杠（浏览器按 '/' 解析：/\evil.com → //evil.com 协议相对跳转）
 *   - 解码后以 // 开头（%2F%2F 解码后成 //）
 *   - 非 / 开头、控制字符/空白
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return '/';
  }
  if (decoded.includes('\\')) return '/';
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/';
  if (/[\u0000-\u0020\u007f]/.test(decoded)) return '/';
  return decoded;
}

// ── CSRF（double-submit token）────────────────────────────────
// 登录/配置表单：GET 渲染时下发 Cookie + 表单隐藏域同一随机值，
// POST 时恒定时间比对。无服务端会话也能防跨站表单伪造。
const CSRF_COOKIE = 'dsh_csrf';

function newCsrfToken(): string {
  return randomBytes(16).toString('hex');
}

function csrfMatches(cookieValue: string | null, fieldValue: string): boolean {
  if (!cookieValue || cookieValue.length !== fieldValue.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(fieldValue));
}

function setCsrfCookie(res: Response, token: string, secure: boolean): void {
  res.setHeader(
    'Set-Cookie',
    `${CSRF_COOKIE}=${token}; Path=/gateway; HttpOnly; SameSite=Lax; Max-Age=3600${
      secure ? '; Secure' : ''
    }`,
  );
}

// ── 主题同步：合理化跟随 dsh 主题 ─────────────────────────────
// dsh 的主题偏好持久化在 <dsh home>/settings.yaml 的 ui-theme.preference
// （light|dark|system，默认 system）。网关在渲染登录/配置页时读取该文件，
// 注入引导脚本在浏览器端解析（system 走 prefers-color-scheme，与 dsh 的
// boot-theme 逻辑一致）。文件不可读时回退 system；可用 MCP_DSH_SETTINGS_FILE
// 显式指定 dsh 设置文件路径（网关与 dsh 不同机时用）。
type ThemePreference = 'light' | 'dark' | 'system';

function readDshThemePreference(): ThemePreference {
  const explicit = process.env.MCP_DSH_SETTINGS_FILE?.trim();
  const dshHome = process.env.DSH_HOME?.trim();
  const candidates: string[] = explicit
    ? [explicit]
    : [
        ...(dshHome ? [path.join(dshHome, 'settings.yaml')] : []),
        path.join(os.homedir(), '.dsh', 'settings.yaml'),
      ];
  for (const file of candidates) {
    try {
      const text = readFileSync(file, 'utf8');
      // settings.yaml 为扁平结构：顶层命名空间键 + 缩进字段（注释可跟在行尾）
      const block = text.match(/^ui-theme\s*:\s*(?:#.*)?$/m);
      if (!block || block.index === undefined) continue;
      const rest = text.slice(block.index);
      const hit = rest.match(/^\s+preference\s*:\s*["']?(light|dark|system)["']?\s*(?:#.*)?$/m);
      if (hit) return hit[1] as ThemePreference;
    } catch {
      // 文件不存在/不可读：继续尝试下一个候选，最终回退 system
    }
  }
  return 'system';
}

/** 主题引导脚本：在 <head> 内尽早设置 data-theme 与 color-scheme，避免闪烁 */
function themeBootScript(preference: ThemePreference): string {
  return `<script>(function(){var pref=${JSON.stringify(preference)};var mq=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');function apply(){var dark=pref==='dark'||(pref==='system'&&mq&&mq.matches);document.documentElement.setAttribute('data-theme',dark?'dark':'light');document.documentElement.style.colorScheme=dark?'dark':'light';}apply();if(pref==='system'&&mq){try{mq.addEventListener('change',apply)}catch(e){mq.addListener(apply)}}})();</script>`;
}

/**
 * 登录/配置页共享样式：完全采用 dsh 设计令牌（design-platform.css）
 * - 浅色为默认（dsh 默认主题 = 简约白色）：bg #fff、主文字 rgb(15,17,21)、
 *   品牌蓝 rgb(65,118,230)（deepseek-500）、边框 rgba(0,0,0,.1) 等
 * - html[data-theme=dark] 覆盖为 dsh 暗色令牌（neutral-bluish-950 等）
 * - 输入框修复：-webkit-autofill 会把输入栏刷成白色/黄色（粘贴触发布局），
 *   用 inset 大阴影 + text-fill-color 回压为当前主题输入底色
 * - 动画只动 transform/opacity/box-shadow，并尊重 prefers-reduced-motion
 */
const PAGE_STYLE = `
:root{
  --bg:rgb(255,255,255);
  --card:rgba(255,255,255,.94);
  --field:rgb(255,255,255);
  --txt:rgb(15,17,21);
  --sub:rgb(97,102,107);
  --muted:rgb(129,133,140);
  --caption:rgb(173,178,184);
  --border:rgba(0,0,0,.1);
  --border-soft:rgba(0,0,0,.06);
  --border-strong:rgba(0,0,0,.16);
  --brand:rgb(65,118,230);
  --brand-hi:rgb(86,134,254);
  --danger:rgb(242,90,90);
  --danger-soft:rgba(242,90,90,.08);
  --danger-border:rgba(242,90,90,.3);
  --ok:rgb(34,197,94);
  --warn:rgb(247,173,49);
  --warn-soft:rgba(247,173,49,.1);
  --warn-border:rgba(247,173,49,.35);
  --ring:rgba(65,118,230,.16);
  --glow-a:rgba(77,147,248,.18);
  --glow-b:rgba(103,65,217,.09);
  --glow-c:rgba(96,165,250,.11);
  --grid-line:rgba(15,17,21,.03);
  --shadow-card:0 24px 48px -24px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.05);
  --shadow-field:0 1px 2px rgba(15,23,42,.05);
  --shadow-btn:0 4px 14px -4px rgba(65,118,230,.5);
}
html[data-theme=dark]{
  --bg:rgb(21,21,23);
  --card:rgba(35,35,36,.92);
  --field:rgb(44,44,46);
  --txt:rgb(249,250,251);
  --sub:rgb(207,211,214);
  --muted:rgb(173,178,184);
  --caption:rgb(129,133,140);
  --border:rgba(255,255,255,.12);
  --border-soft:rgba(255,255,255,.06);
  --border-strong:rgba(255,255,255,.2);
  --brand:rgb(86,134,254);
  --brand-hi:rgb(103,158,254);
  --danger:rgb(242,90,90);
  --danger-soft:rgba(242,90,90,.14);
  --danger-border:rgba(242,90,90,.35);
  --ok:rgb(34,197,94);
  --warn:rgb(247,173,49);
  --warn-soft:rgba(247,173,49,.12);
  --warn-border:rgba(247,173,49,.4);
  --ring:rgba(86,134,254,.28);
  --glow-a:rgba(86,134,254,.15);
  --glow-b:rgba(103,65,217,.13);
  --glow-c:rgba(96,165,250,.09);
  --grid-line:rgba(255,255,255,.025);
  --shadow-card:0 24px 60px -20px rgba(0,0,0,.6);
  --shadow-field:0 1px 2px rgba(0,0,0,.3);
  --shadow-btn:0 4px 18px -4px rgba(86,134,254,.5);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;-webkit-font-smoothing:antialiased}
.orbs{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.orbs i{position:absolute;border-radius:50%;filter:blur(80px);will-change:transform;animation:drift 22s ease-in-out infinite}
.orbs .a{width:46vw;height:46vw;max-width:520px;max-height:520px;left:-12vw;top:-14vh;background:radial-gradient(circle,var(--glow-a),transparent 68%)}
.orbs .b{width:40vw;height:40vw;max-width:440px;max-height:440px;right:-10vw;bottom:-12vh;background:radial-gradient(circle,var(--glow-b),transparent 68%);animation-delay:-7s}
.orbs .c{width:30vw;height:30vw;max-width:320px;max-height:320px;right:16vw;top:-16vh;background:radial-gradient(circle,var(--glow-c),transparent 68%);animation-delay:-13s}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(4vw,3vh) scale(1.08)}66%{transform:translate(-3vw,2vh) scale(.95)}}
.grid{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse 90% 70% at 50% 40%,#000 25%,transparent 78%);mask-image:radial-gradient(ellipse 90% 70% at 50% 40%,#000 25%,transparent 78%)}
.card{position:relative;z-index:10;width:100%;max-width:400px;margin:0 16px;background:var(--card);border:1px solid var(--border-soft);border-radius:16px;padding:32px 32px 28px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:var(--shadow-card);animation:enter .55s cubic-bezier(.22,1,.36,1) both}
@keyframes enter{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.logo{width:48px;height:48px;margin:0 auto 16px;border-radius:14px;background:linear-gradient(135deg,var(--brand-hi),var(--brand));display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px -6px var(--shadow-btn);position:relative}
.logo::after{content:"";position:absolute;inset:-4px;border-radius:18px;border:1px solid var(--ring);opacity:0;animation:ping 4s ease-out infinite}
@keyframes ping{0%{opacity:.7;transform:scale(.92)}55%{opacity:0;transform:scale(1.18)}100%{opacity:0}}
h1{font-size:20px;font-weight:600;letter-spacing:-.01em;text-align:center}
.sub{margin-top:8px;font-size:13px;color:var(--muted);text-align:center;line-height:1.5}
label{display:block;margin-top:14px}
label span{display:block;margin-bottom:6px;font-size:12px;font-weight:500;color:var(--sub)}
input,button{font-family:inherit}
input{width:100%;padding:10px 14px;font-size:14px;line-height:20px;color:var(--txt);background:var(--field);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-field);transition:border-color .16s,box-shadow .16s;caret-color:var(--brand)}
input::placeholder{color:var(--caption)}
input::selection{background:var(--ring)}
input:hover{border-color:var(--border-strong)}
input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--ring),var(--shadow-field)}
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus{-webkit-text-fill-color:var(--txt);-webkit-box-shadow:0 0 0 1000px var(--field) inset;box-shadow:0 0 0 1000px var(--field) inset;caret-color:var(--txt);transition:background-color 999999s ease-in-out 0s}
button{margin-top:22px;width:100%;padding:10px 16px;font-size:14px;font-weight:500;color:#fff;background:linear-gradient(135deg,var(--brand-hi),var(--brand));border:none;border-radius:10px;cursor:pointer;box-shadow:var(--shadow-btn);transition:transform .16s,box-shadow .16s,filter .16s}
button:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.06);box-shadow:0 6px 22px -4px var(--shadow-btn)}
button:active:not(:disabled){transform:translateY(0) scale(.99);filter:brightness(.96)}
button:disabled{opacity:.7;cursor:default}
.error-bar{display:none;margin-top:14px;padding:8px 12px;font-size:12px;color:var(--danger);background:var(--danger-soft);border:1px solid var(--danger-border);border-radius:8px;animation:shake .4s}
.db-hint{margin-top:14px;padding:8px 12px;font-size:12px;color:var(--warn);background:var(--warn-soft);border:1px solid var(--warn-border);border-radius:8px}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
.rules{margin-top:12px;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--caption)}
.rules span{display:inline-flex;align-items:center;gap:4px}
.rules span.on{color:var(--ok)}
.strength{height:4px;margin-top:10px;border-radius:999px;background:var(--field);border:1px solid var(--border-soft);overflow:hidden}
.strength i{display:block;height:100%;width:0;border-radius:999px;background:var(--danger);transition:width .32s cubic-bezier(.22,1,.36,1),background .32s}
.lang-switch{position:absolute;top:14px;right:16px;display:flex;gap:12px;font-size:12px}
.lang-switch a{color:var(--caption);text-decoration:none;transition:color .15s}
.lang-switch a:hover{color:var(--sub)}
.lang-switch a.on{color:var(--brand);font-weight:600}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/** 语言切换链接：中文 / English（当前语言高亮，点击带 ?lang= 走同一个登录路径） */
function langSwitch(lang: Lang, next: string): string {
  const query = next === '' ? '' : `?next=${encodeURIComponent(next)}`;
  const mk = (id: Lang, label: string) =>
    `<a${lang === id ? ' class="on"' : ''} href="/gateway/login${query}${query === '' ? '?' : '&'}lang=${id}">${label}</a>`;
  return `<div class="lang-switch">${mk('zh', '中文')}${mk('en', 'English')}</div>`;
}

/** 页面骨架：共享 head（主题引导 + 样式）+ 背景动画层 + 卡片容器 */
function pageShell(params: { lang: Lang; title: string; body: string; script?: string }): string {
  return `<!doctype html>
<html lang="${params.lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${params.title}</title>
${themeBootScript(readDshThemePreference())}
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="orbs" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i></div>
<div class="grid" aria-hidden="true"></div>
<div class="card">${params.body}</div>
${params.script ?? ''}
</body>
</html>`;
}

function renderLoginPage(params: { lang: Lang; next: string; error?: string; dbHealthy: boolean; csrf: string }): string {
  const tr = (key: string, tp?: Record<string, string | number>) => t(params.lang, key, tp);
  const errorBlock = params.error
    ? `<div class="error-bar" id="error-bar">${escapeHtml(params.error)}</div>`
    : '';
  const dbHint = params.dbHealthy
    ? ''
    : `<div class="db-hint">${escapeHtml(tr('gw.dbHint'))}</div>`;
  const body = `
  <div class="logo">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="white" stroke-width="1.6"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  <h1>${tr('gw.loginTitle')}</h1>
  <p class="sub">${tr('gw.loginSub1')}<br/>${tr('gw.loginSub2')}</p>
  <form method="POST" action="/gateway/login" id="login-form">
    <input type="hidden" name="csrf" value="${escapeHtml(params.csrf)}" />
    <input type="hidden" name="next" value="${escapeHtml(params.next)}" />
    <label><span>${tr('gw.username')}</span><input type="text" name="username" placeholder="${tr('gw.usernamePlaceholder')}" autocomplete="username" required /></label>
    <label><span>${tr('gw.password')}</span><input type="password" name="password" placeholder="${tr('gw.passwordPlaceholder')}" autocomplete="current-password" required /></label>
    <button type="submit" id="submit-btn">${tr('gw.login')}</button>
  </form>
  ${errorBlock}
  ${dbHint}`;
  return pageShell({
    lang: params.lang,
    title: tr('gw.titleLogin'),
    body,
    script: `<script>
  const err = document.getElementById('error-bar');
  if (err) { setTimeout(() => { err.style.display = 'block'; }, 50); }
  document.getElementById('login-form').addEventListener('submit', () => {
    const btn = document.getElementById('submit-btn');
    btn.textContent = ${JSON.stringify(tr('gw.loggingIn'))};
    btn.disabled = true;
  });
</script>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 首次配置页（平台未初始化时显示；预设密钥 + 用户名 + 密码） ──
function renderSetupPage(params: { lang: Lang; error?: string; csrf: string }): string {
  const tr = (key: string, tp?: Record<string, string | number>) => t(params.lang, key, tp);
  const errorBlock = params.error
    ? `<div class="error-bar" id="error-bar">${escapeHtml(params.error)}</div>`
    : '';
  const body = `
  <div class="logo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="white" stroke-width="1.6"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  ${langSwitch(params.lang, '')}
  <h1>${tr('gw.setupTitle')}</h1>
  <p class="sub">${tr('gw.setupSub1')}<br/>${tr('gw.setupSub2')}</p>
  <form method="POST" action="/gateway/setup" id="setup-form">
    <input type="hidden" name="csrf" value="${escapeHtml(params.csrf)}" />
    <label><span>${tr('gw.setupKey')}</span><input type="password" name="setupKey" placeholder="${tr('gw.setupKeyPlaceholder')}" required /></label>
    <label><span>${tr('gw.username')}</span><input type="text" name="username" placeholder="${tr('gw.usernameRule')}" autocomplete="username" required /></label>
    <label><span>${tr('gw.password')}</span><input type="password" name="password" id="pw" placeholder="${tr('gw.passwordRule')}" autocomplete="new-password" required /></label>
    <div class="strength"><i id="pw-bar"></i></div>
    <div class="rules" id="pw-rules">
      <span data-r="len">○ ${tr('gw.ruleLen')}</span>
      <span data-r="up">○ ${tr('gw.ruleUp')}</span>
      <span data-r="low">○ ${tr('gw.ruleLow')}</span>
      <span data-r="num">○ ${tr('gw.ruleNum')}</span>
      <span data-r="sym">○ ${tr('gw.ruleSym')}</span>
    </div>
    <label><span>${tr('gw.confirmPassword')}</span><input type="password" name="confirm" placeholder="${tr('gw.confirmPlaceholder')}" autocomplete="new-password" required /></label>
    <button type="submit" id="submit-btn">${tr('gw.initPlatform')}</button>
  </form>
  ${errorBlock}`;
  return pageShell({
    lang: params.lang,
    title: tr('gw.titleSetup'),
    body,
    script: `<script>
  const err = document.getElementById('error-bar');
  if (err) { setTimeout(() => { err.style.display = 'block'; }, 50); }
  const pw = document.getElementById('pw');
  const bar = document.getElementById('pw-bar');
  const COLORS = ['#f25a5a', '#f7ad31', '#f59e0b', '#4d93f8', '#22c55e'];
  pw.addEventListener('input', () => {
    const v = pw.value;
    const rules = {
      len: v.length >= 12, up: /[A-Z]/.test(v), low: /[a-z]/.test(v),
      num: /[0-9]/.test(v), sym: /[^A-Za-z0-9]/.test(v),
    };
    let n = 0;
    document.querySelectorAll('#pw-rules span').forEach((el) => {
      const ok = rules[el.dataset.r];
      if (ok) n++;
      el.className = ok ? 'on' : '';
      el.textContent = (ok ? '✓ ' : '○ ') + el.textContent.replace(/^[✓○] /, '');
    });
    const pct = Math.max(20, (n / 5) * 100);
    bar.style.width = pct + '%';
    bar.style.background = COLORS[Math.max(0, n - 1)];
  });
  document.getElementById('setup-form').addEventListener('submit', (e) => {
    const pwv = pw.value;
    const confirm = document.querySelector('input[name=confirm]').value;
    if (pwv !== confirm) {
      e.preventDefault();
      const err = document.getElementById('error-bar');
      err.textContent = ${JSON.stringify(tr('gw.passwordMismatch'))};
      err.style.display = 'block';
      err.style.animation = 'none';
      void err.offsetWidth;
      err.style.animation = 'shake .4s';
      return;
    }
    const btn = document.getElementById('submit-btn');
    btn.textContent = ${JSON.stringify(tr('gw.initializing'))};
    btn.disabled = true;
  });
</script>`,
  });
}

type ResponseCompression = 'br' | 'gzip';

export function requestedCompression(req: Pick<IncomingMessage, 'headers'>): ResponseCompression | null {
  const accepted = new Map<string, number>();
  for (const raw of String(req.headers['accept-encoding'] ?? '').toLowerCase().split(',')) {
    const [name, ...parameters] = raw.trim().split(';');
    if (!name) continue;
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const value = quality ? Number(quality.trim().slice(2)) : 1;
    accepted.set(name, Number.isFinite(value) ? value : 0);
  }
  if ((accepted.get('br') ?? 0) > 0) return 'br';
  if ((accepted.get('gzip') ?? 0) > 0) return 'gzip';
  return null;
}

function decodeResponseBody(body: Buffer, encoding: string): Buffer {
  const normalized = encoding.toLowerCase();
  if (normalized.includes('gzip')) return zlib.gunzipSync(body);
  if (normalized.includes('br')) return zlib.brotliDecompressSync(body);
  if (normalized.includes('deflate')) return zlib.inflateSync(body);
  return body;
}

function isCompressibleText(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes('application/json') || normalized.startsWith('text/');
}

function addVary(headers: Record<string, string | string[] | undefined>, value: string): void {
  const existing = headers.vary;
  const values = Array.isArray(existing) ? existing.join(',') : String(existing ?? '');
  if (!values.split(',').some((item) => item.trim().toLowerCase() === value.toLowerCase())) {
    headers.vary = values === '' ? value : `${values}, ${value}`;
  }
}

/** Compress a complete response after all gateway filtering and rewriting. */
export function compressResponseBody(
  req: Pick<IncomingMessage, 'headers'>,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): { headers: Record<string, string | string[] | undefined>; body: Buffer } {
  const outputHeaders = { ...headers };
  const contentType = String(outputHeaders['content-type'] ?? '');
  const existingEncoding = String(outputHeaders['content-encoding'] ?? '');
  const encoding = requestedCompression(req);
  if (encoding && existingEncoding === '' && isCompressibleText(contentType)) addVary(outputHeaders, 'Accept-Encoding');
  if (
    body.length < 1024 ||
    !encoding ||
    existingEncoding !== '' ||
    !isCompressibleText(contentType) ||
    contentType.toLowerCase().includes('text/event-stream')
  ) {
    outputHeaders['content-length'] = String(body.length);
    return { headers: outputHeaders, body };
  }
  try {
    const compressed = encoding === 'br' ? zlib.brotliCompressSync(body) : zlib.gzipSync(body);
    if (compressed.length >= body.length) {
      outputHeaders['content-length'] = String(body.length);
      return { headers: outputHeaders, body };
    }
    delete outputHeaders['content-length'];
    outputHeaders['content-encoding'] = encoding;
    outputHeaders['content-length'] = String(compressed.length);
    addVary(outputHeaders, 'Accept-Encoding');
    return { headers: outputHeaders, body: compressed };
  } catch {
    outputHeaders['content-length'] = String(body.length);
    return { headers: outputHeaders, body };
  }
}

export function shouldBufferForCompression(req: Pick<IncomingMessage, 'headers'>, headers: Record<string, string | string[] | undefined>): boolean {
  if (!requestedCompression(req) || String(headers['content-encoding'] ?? '') !== '') return false;
  const contentType = String(headers['content-type'] ?? '');
  if (!isCompressibleText(contentType) || contentType.toLowerCase().includes('text/event-stream')) return false;
  const contentLength = Number(headers['content-length'] ?? 0);
  return !Number.isFinite(contentLength) || contentLength === 0 || contentLength >= 1024;
}

export function createGatewayServer(
  config: PlatformConfig,
  auth: AuthService,
  db: Database,
  hooks: GatewayHooks = {},
): http.Server {
  const app = express();
  // 不泄露框架信息
  app.disable('x-powered-by');
  // 保留 /gateway 命名空间：编码/压平变形与未知自有路由不得落入上游 SPA fallback。
  app.use((req, res, next) => {
    if (classifyGatewayPath(req.url ?? '/') === 'reject') {
      res.status(404).type('text/plain').send('404 Not Found');
      return;
    }
    next();
  });
  // 仅解析 /gateway 表单请求；代理请求的 body 必须原样透传给上游
  // （全局 express.json/urlencoded 会消费掉请求流，导致上游收到空 body）
  app.use('/gateway', express.urlencoded({ extended: false }));

  // HTTPS 模式：全站 HSTS（浏览器强制后续走 HTTPS）+ 会话 Cookie 加 Secure
  //（Cookie 标志在登录处理器内按 config.gateway.tls 决定）
  if (config.gateway.tls !== null) {
    app.use((_req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      next();
    });
  }

  // 登录/配置页安全响应头（仅 /gateway/* 自有页面；代理的 dsh 响应不强制
  // CSP，避免破坏 dsh 前端）：禁嗅探、禁嵌入、无 Referrer、禁缓存、禁索引
  app.use('/gateway', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // 页面完全自包含（内联 CSS/JS、无外部资源）：可以上严格 CSP
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    next();
  });

  const upstream = new URL(config.gateway.upstream);
  const upstreamHost = upstream.hostname;
  const upstreamPort = Number(upstream.port || 80);

  // 上游连接池：复用与 dsh 的 TCP 连接（keep-alive），
  // 避免每个代理请求都新建一次 TCP 握手
  const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000 });

  const ensureWorkspace = hooks.ensureWorkspace ?? ((root: string) =>
    new Promise<boolean>((resolve, reject) => {
      const payload = JSON.stringify({
        type: 'client-request',
        rpcId: randomBytes(12).toString('hex'),
        method: 'workspace.create',
        payload: { path: root },
      });
      const request = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        path: '/api/workspace.create',
        method: 'POST',
        headers: {
          host: `${upstreamHost}:${upstreamPort}`,
          origin: `http://${upstreamHost}:${upstreamPort}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        agent: upstreamAgent,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              result?: { ok?: boolean; value?: { created?: boolean }; error?: { message?: string } };
            };
            if (response.statusCode !== 200 || body.result?.ok !== true) {
              reject(new Error(body.result?.error?.message ?? `workspace.create HTTP ${response.statusCode ?? 0}`));
              return;
            }
            resolve(body.result?.value?.created === true);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(payload);
    }));

  const removeWorkspace = hooks.removeWorkspace ?? (async (root: string): Promise<void> => {
    const payload = JSON.stringify({
      type: 'client-request',
      rpcId: randomBytes(12).toString('hex'),
      method: 'workspace.list',
      payload: {},
    });
    const workspaceId = await new Promise<string | null>((resolve, reject) => {
      const request = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        path: '/api/workspace.list',
        method: 'POST',
        headers: {
          host: `${upstreamHost}:${upstreamPort}`,
          origin: `http://${upstreamHost}:${upstreamPort}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        agent: upstreamAgent,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const paths = new Map<string, string>();
            collectIdPathPairs(body, paths);
            resolve([...paths.entries()].find(([, candidate]) => candidate === root)?.[0] ?? null);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(payload);
    });
    if (workspaceId === null) return;
    const deletePayload = JSON.stringify({
      type: 'client-request',
      rpcId: randomBytes(12).toString('hex'),
      method: 'workspace.delete',
      payload: { workspaceId },
    });
    await new Promise<void>((resolve, reject) => {
      const request = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        path: '/api/workspace.delete',
        method: 'POST',
        headers: {
          host: `${upstreamHost}:${upstreamPort}`,
          origin: `http://${upstreamHost}:${upstreamPort}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(deletePayload)),
        },
        agent: upstreamAgent,
      }, (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode !== 200) reject(new Error(`workspace.delete HTTP ${response.statusCode ?? 0}`));
          else resolve();
        });
      });
      request.on('error', reject);
      request.end(deletePayload);
    });
  });

  function collectWorkspaceSessionCounts(value: unknown, out: Map<string, number>): void {
    if (Array.isArray(value)) {
      for (const item of value) collectWorkspaceSessionCounts(item, out);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    const id = typeof obj.workspaceId === 'string' ? obj.workspaceId : obj.id;
    if (typeof id === 'string' && Array.isArray(obj.sessionIds)) out.set(id, obj.sessionIds.length);
    for (const nested of Object.values(obj)) collectWorkspaceSessionCounts(nested, out);
  }

  function collectSessionPathPairs(value: unknown, out: Map<string, string>): void {
    if (Array.isArray(value)) {
      for (const item of value) collectSessionPathPairs(item, out);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    const id = typeof obj.sessionId === 'string' ? obj.sessionId : obj.id;
    if (typeof id === 'string' && typeof obj.cwd === 'string') out.set(id, obj.cwd);
    for (const nested of Object.values(obj)) collectSessionPathPairs(nested, out);
  }

  // workspaceId → 规范路径 映射：从 workspace.list 响应里收集，供 session.create/delete 用 workspaceId 时解析路径
  const workspacePathById = new Map<string, string>();
  const workspaceSessionCountById = new Map<string, number>();
  const sessionPathById = new Map<string, string>();
  let workspacePathRefresh: Promise<void> | null = null;
  let sessionPathRefresh: Promise<void> | null = null;

  function refreshWorkspacePathMap(): Promise<void> {
    if (workspacePathRefresh !== null) return workspacePathRefresh;
    workspacePathRefresh = new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({
        type: 'client-request',
        rpcId: randomBytes(12).toString('hex'),
        method: 'workspace.list',
        payload: {},
      });
      const request = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        path: '/api/workspace.list',
        method: 'POST',
        headers: {
          host: `${upstreamHost}:${upstreamPort}`,
          origin: `http://${upstreamHost}:${upstreamPort}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        agent: upstreamAgent,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              result?: { ok?: boolean; error?: { message?: string } };
            };
            if (response.statusCode !== 200 || body.result?.ok !== true) {
              reject(new Error(body.result?.error?.message ?? `workspace.list HTTP ${response.statusCode ?? 0}`));
              return;
            }
            workspacePathById.clear();
            workspaceSessionCountById.clear();
            collectIdPathPairs(body, workspacePathById);
            collectWorkspaceSessionCounts(body, workspaceSessionCountById);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(payload);
    }).finally(() => {
      workspacePathRefresh = null;
    });
    return workspacePathRefresh;
  }

  function refreshSessionPathMap(): Promise<void> {
    if (sessionPathRefresh !== null) return sessionPathRefresh;
    sessionPathRefresh = new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({
        type: 'client-request',
        rpcId: randomBytes(12).toString('hex'),
        method: 'session.list',
        payload: {},
      });
      const request = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        path: '/api/session.list',
        method: 'POST',
        headers: {
          host: `${upstreamHost}:${upstreamPort}`,
          origin: `http://${upstreamHost}:${upstreamPort}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        agent: upstreamAgent,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              result?: { ok?: boolean; error?: { message?: string } };
            };
            if (response.statusCode !== 200 || body.result?.ok !== true) {
              reject(new Error(body.result?.error?.message ?? `session.list HTTP ${response.statusCode ?? 0}`));
              return;
            }
            sessionPathById.clear();
            collectSessionPathPairs(body, sessionPathById);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.end(payload);
    }).finally(() => {
      sessionPathRefresh = null;
    });
    return sessionPathRefresh;
  }

  /** 从 Cookie 实时校验会话；账号删除、封禁、改名或改密后下一请求立即失效。 */
  function sessionOf(req: Request): { userId: number; username: string; role: 'admin' | 'user' } | null {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    try {
      return auth.verifyToken(token);
    } catch {
      return null;
    }
  }

  /** 子用户权限：缺行时返回默认（全量允许、未封禁） */
  function effectivePermissions(userId: number): UserPermissionsRow {
    return (
      db.getPermissions(userId) ?? {
        user_id: userId,
        allowed_folders: [],
        hourly_token_limit: null,
        daily_minutes_limit: null,
        allow_upload: true,
        allow_git_download: true,
        banned: false,
        sandbox_mode: null,
        workspace_mode: 'repair-required',
        workspace_root: null,
        remark: '',
        updated_at: '',
      }
    );
  }

  function permissionPathAllowed(perms: UserPermissionsRow, candidate: string): boolean {
    if (perms.workspace_mode === 'repair-required' || perms.workspace_root === null) return false;
    if (perms.allowed_folders.length !== 1 || perms.allowed_folders[0] !== perms.workspace_root) return false;
    return authorizeFilesystemPath(perms.workspace_root, candidate, { allowMissing: true }).allowed;
  }

  /** Filter path-bearing response metadata through the same realpath boundary as requests. */
  function filterByAuthorizedPathField(value: unknown, perms: UserPermissionsRow, field: string): unknown {
    const pathFields = new Set([field, 'cwd', 'path', 'parent', 'root']);
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        if (item !== null && typeof item === 'object') {
          const candidate = (item as Record<string, unknown>)[field];
          if (typeof candidate === 'string' && candidate !== '' && !permissionPathAllowed(perms, candidate)) return [];
        }
        const filtered = filterByAuthorizedPathField(item, perms, field);
        return filtered === undefined ? [] : [filtered];
      });
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (
          pathFields.has(key) &&
          typeof nested === 'string' &&
          nested !== '' &&
          !permissionPathAllowed(perms, nested)
        ) continue;
        out[key] = filterByAuthorizedPathField(nested, perms, field);
      }
      return out;
    }
    return value;
  }

  const HOST_FILESYSTEM_ENDPOINT_RE = /^\/api\/host[.\/](listDirectory|createDirectory|openPath)$/;
  const HOST_LIST_DIRECTORY_RE = /^\/api\/host[.\/]listDirectory$/;
  const HOST_CREATE_DIRECTORY_RE = /^\/api\/host[.\/]createDirectory$/;
  const WORKSPACE_LIST_RE = /^\/api\/workspace[.\/]list$/;
  const WORKSPACE_DELETE_RE = /^\/api\/workspace[.\/]delete$/;
  const SESSION_CREATE_RE = /^\/api\/session[.\/]create$/;
  const SESSION_FORK_RE = /^\/api\/session[.\/]fork$/;
  const SESSION_SEARCH_RE = /^\/api\/session[.\/]search$/;
  const SESSION_SCOPED_RE = /^\/api\/session[.\/](?:prompt|history|rename|attachment|updateQueue|cancel)$/;

  function injectRpcPayloadPath(value: unknown, workspaceRoot: string): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (obj.payload !== null && typeof obj.payload === 'object' && !Array.isArray(obj.payload)) {
      return { ...obj, payload: { ...(obj.payload as Record<string, unknown>), path: workspaceRoot } };
    }
    return { ...obj, path: workspaceRoot };
  }

  function replaceRpcWorkspaceId(value: unknown, workspaceId: string): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (obj.payload !== null && typeof obj.payload === 'object' && !Array.isArray(obj.payload)) {
      return { ...obj, payload: { ...(obj.payload as Record<string, unknown>), workspaceId } };
    }
    return { ...obj, workspaceId };
  }

  function requestPathFromQuery(url: URL): string | null {
    for (const field of ['path', 'root', 'cwd', 'directory', 'workspace', 'target', 'targetPath']) {
      const value = url.searchParams.get(field);
      if (value !== null && value.length > 0) return value;
    }
    return null;
  }

  function sendRpcDenied(res: Response, body: unknown, code: string, message: string): void {
    const rpcId = findStringField(body, 'rpcId') ?? 'dsh-access-denied';
    res.status(200).json({
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code, message } },
    });
  }

  function restrictDirectoryListing(value: unknown, perms: UserPermissionsRow): unknown {
    if (Array.isArray(value)) {
      return value
        .filter((item) => {
          if (item === null || typeof item !== 'object') return true;
          const candidate = (item as Record<string, unknown>).path;
          return typeof candidate !== 'string' || permissionPathAllowed(perms, candidate);
        })
        .map((item) => restrictDirectoryListing(item, perms));
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(obj)) {
        out[key] = key === 'home' && perms.workspace_root !== null
          ? perms.workspace_root
          : restrictDirectoryListing(nested, perms);
      }
      return out;
    }
    return value;
  }

  /** 从会话 cookie 解析完整用户（含角色）；无会话/失效返回 null */
  function authedUser(req: Request): { userId: number; username: string; role: 'admin' | 'user' } | null {
    return sessionOf(req);
  }

  /** 统一 403 页面（封禁 / 权限拒绝） */
  function forbiddenPage(lang: Lang, message: string): string {
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403</title></head><body style="font-family:system-ui;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="margin:0 0 8px">403</h1><p style="margin:0;opacity:.7">${escapeHtml(message)}</p></div></body></html>`;
  }

  /** 用量节流：每 15 秒最多写一次活跃时间，返回当前用量（用于配额判定） */
  const usageThrottle = new Map<number, number>();
  function touchUsageThrottled(userId: number) {
    const now = Date.now();
    const day = todayLocal();
    const last = usageThrottle.get(userId) ?? 0;
    if (now - last >= 15000) {
      usageThrottle.set(userId, now);
      return db.touchUsage(userId, day, new Date().toISOString());
    }
    return db.getUsage(userId, day);
  }

  // ── 长连接与留言 / 聊天（SSE 广播） ───────────────────────
  const activeConnections = new UserConnectionRegistry();
  const CONNECTION_REVALIDATION_MS = 250;

  function connectionRevocationReason(userId: number, credentialVersion: number): string | null {
    const row = db.getUserById(userId);
    if (row === null) return 'account-deleted';
    if (row.role !== 'admin' && effectivePermissions(userId).banned) return 'account-banned';
    if (row.credential_version !== credentialVersion) return 'credential-changed';
    return null;
  }

  /**
   * Long connections may be owned by a different gateway process than the
   * one that changed the shared SQLite account state. Poll the same live
   * account fields used by request authentication so those connections are
   * revoked without requiring an in-process notification bus.
   */
  function watchConnection(userId: number, credentialVersion: number): () => void {
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      const reason = connectionRevocationReason(userId, credentialVersion);
      if (reason !== null) activeConnections.revoke(userId, reason);
    }, CONNECTION_REVALIDATION_MS);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  const chatClients = new Set<Response>();
  function broadcastMessage(msg: MessageRow): void {
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const client of chatClients) {
      try {
        client.write(payload);
      } catch {
        chatClients.delete(client);
      }
    }
  }

  // ── 登录页（GET）：平台未初始化时显示首次配置页 ─────────────
  app.get('/gateway/login', async (req, res) => {
    const next = safeNext(typeof req.query.next === 'string' ? req.query.next : undefined);
    const lang = langOf(req);
    const queryLang = typeof req.query.lang === 'string' ? req.query.lang : null;
    const [initialized, dbHealthy] = await Promise.all([
      auth.isInitialized().catch(() => false),
      db.health().catch(() => false),
    ]);
    // 每次渲染下发新 CSRF token（Cookie + 表单隐藏域）
    const csrf = newCsrfToken();
    setCsrfCookie(res, csrf, config.gateway.tls !== null);
    // 显式 ?lang= 选择持久化到 cookie（语言切换链接点出来的）。
    // 注意 Set-Cookie 头已由 CSRF 占用，这里用数组追加而不是 setHeader 覆盖。
    if (queryLang === 'zh' || queryLang === 'en') {
      const langCookie = `${LANG_COOKIE}=${queryLang}; Path=/gateway; SameSite=Lax; Max-Age=31536000${
        config.gateway.tls !== null ? '; Secure' : ''
      }`;
      const existing = res.getHeader('Set-Cookie');
      const prev: string[] = Array.isArray(existing)
        ? existing.map((value) => String(value))
        : existing
          ? [String(existing)]
          : [];
      res.setHeader('Set-Cookie', [...prev, langCookie]);
    }
    if (!initialized) {
      res.type('html').send(renderSetupPage({ lang, csrf }));
      return;
    }
    const reason = typeof req.query.reason === 'string' ? req.query.reason : '';
    const loginError = reason === 'credential-changed'
      ? t(lang, 'gw.credentialsChanged')
      : reason === 'banned' || reason === 'deleted'
        ? t(lang, 'gw.accountRevoked')
        : undefined;
    res.type('html').send(renderLoginPage({ lang, next, dbHealthy, csrf, error: loginError }));
  });

  // ── 首次配置提交（POST）→ 302 回登录页 ────────────────────────
  app.post('/gateway/setup', async (req, res) => {
    const setupKey = typeof req.body?.setupKey === 'string' ? req.body.setupKey : '';
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const meta: RequestMeta = { ip: req.ip, userAgent: req.headers['user-agent'] ?? null };

    // CSRF 校验（double-submit：Cookie 与表单域一致才放行）
    const csrfField = typeof req.body?.csrf === 'string' ? req.body.csrf : '';
    if (!csrfMatches(readCookie(req.headers.cookie, CSRF_COOKIE), csrfField)) {
      const csrf = newCsrfToken();
      setCsrfCookie(res, csrf, config.gateway.tls !== null);
      res
        .status(403)
        .type('html')
        .send(renderSetupPage({ lang: langOf(req), error: t(langOf(req), 'gw.csrfFailed'), csrf }));
      return;
    }

    try {
      await auth.setup({ setupKey, username, password }, meta);
      res.redirect(302, '/gateway/login');
    } catch (error) {
      // 真实状态码：409 已初始化 / 401 密钥错误 / 400 参数错误
      const status = error instanceof AuthError ? error.status : 400;
      const lang = langOf(req);
      const message =
        error instanceof AuthError
          ? error.localize(lang)
          : error instanceof Error
            ? error.message
            : t(lang, 'gw.initFailed');
      const csrf = newCsrfToken();
      setCsrfCookie(res, csrf, config.gateway.tls !== null);
      res.status(status).type('html').send(renderSetupPage({ lang, error: message, csrf }));
    }
  });

  // ── 登录提交（POST） → Set-Cookie + 302 重定向兼容层 ────────
  app.post('/gateway/login', async (req, res) => {
    const next = safeNext(typeof req.body?.next === 'string' ? req.body.next : undefined);
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const meta: RequestMeta = { ip: req.ip, userAgent: req.headers['user-agent'] ?? null };

    // CSRF 校验（double-submit：Cookie 与表单域一致才放行）
    const csrfField = typeof req.body?.csrf === 'string' ? req.body.csrf : '';
    if (!csrfMatches(readCookie(req.headers.cookie, CSRF_COOKIE), csrfField)) {
      const dbHealthy = await db.health().catch(() => false);
      const csrf = newCsrfToken();
      setCsrfCookie(res, csrf, config.gateway.tls !== null);
      res
        .status(403)
        .type('html')
        .send(
          renderLoginPage({ lang: langOf(req), next, error: t(langOf(req), 'gw.csrfFailed'), dbHealthy, csrf }),
        );
      return;
    }

    try {
      const { token } = await auth.login({ username, password }, meta);
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${
          config.gateway.tls !== null ? '; Secure' : ''
        }`,
      );
      res.redirect(302, next);
    } catch (error) {
      // 真实状态码：429 锁定 / 401 凭据错误 / 400 其他
      const status = error instanceof AuthError ? error.status : 400;
      const lang = langOf(req);
      const message =
        error instanceof AuthError
          ? error.localize(lang)
          : error instanceof Error
            ? error.message
            : t(lang, 'gw.loginFailed');
      const dbHealthy = await db.health().catch(() => false);
      const csrf = newCsrfToken();
      setCsrfCookie(res, csrf, config.gateway.tls !== null);
      res.status(status).type('html').send(renderLoginPage({ lang, next, error: message, dbHealthy, csrf }));
    }
  });

  // ── 登出 ─────────────────────────────────────────────────────
  app.get('/gateway/logout', (req, res) => {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (token) auth.revokeToken(token);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.redirect(302, '/gateway/login');
  });

  // ── 内部接口：dsh 插件通知网关重载远程设置补丁 ───────────────
  // 仅限本机 dsh 插件调用（恒定时间比对内部密钥；密钥由 SETUP_KEY 派生，
  // 泄漏面与安装密钥一致）。响应立即返回，补丁应用与 dsh 重启异步进行，
  // 让设置页的响应先刷给浏览器。补丁强制启用，无开关。
  app.get('/gateway/internal/health', (req, res) => {
    const secret = typeof req.headers['x-internal-secret'] === 'string' ? req.headers['x-internal-secret'] : '';
    const expected = config.internalSecret;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    res.status(200).json({ ok: true, service: 'dsh-access-gateway' });
  });

  app.post('/gateway/internal/patch', express.json({ limit: '4kb' }), (req, res) => {
    const secret = typeof req.headers['x-internal-secret'] === 'string' ? req.headers['x-internal-secret'] : '';
    const expected = config.internalSecret;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    res.status(202).json({ ok: true });
    setTimeout(() => {
      try {
        const root = findDshRoot(config.patch.dshRoot);
        if (!root) return;
        const result = applyRemotePatch(root);
        if (result === 'applied' && config.patch.restartService) {
          restartDshWeb(config.patch.restartService, 2500);
        }
      } catch (error) {
        console.error('[dsh-access] 补丁重载失败:', error);
      }
    }, 500);
  });

  app.post('/gateway/internal/revoke-user', express.json({ limit: '4kb' }), (req, res) => {
    const secret = typeof req.headers['x-internal-secret'] === 'string' ? req.headers['x-internal-secret'] : '';
    const expected = config.internalSecret;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const userId = Number(req.body?.userId);
    const reason = req.body?.reason;
    if (!Number.isInteger(userId) || userId <= 0 || !['account-banned', 'account-deleted', 'credential-changed'].includes(reason)) {
      res.status(400).json({ ok: false, error: 'invalid revocation' });
      return;
    }
    const closed = activeConnections.revoke(userId, reason);
    res.status(200).json({ ok: true, closed });
  });

  // ── 内部辅助：API 路由的输入清洗 ───────────────────────────
  const nullableInt = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  };
  const stringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];

  // 统一 API 鉴权：跨站拒绝 + 会话校验 + 可选主用户门控
  const apiAuth = (req: Request, res: Response, requireAdmin = false) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ ok: false, code: 'FORBIDDEN_CSRF', error: 'forbidden' });
      return null;
    }
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    let user: { userId: number; username: string; role: 'admin' | 'user' } | null = null;
    try {
      user = token === null ? null : auth.verifyToken(token);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'ACCOUNT_BANNED') {
        res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: '账号已停用' });
        return null;
      }
      let code = 'NOT_AUTHENTICATED';
      if (token !== null) {
        const payload = jwt.decode(token) as { sub?: string; username?: string; cv?: number } | null;
        const userId = Number(payload?.sub);
        const row = Number.isInteger(userId) && userId > 0 ? db.getUserById(userId) : null;
        if (row === null && Number.isInteger(userId) && userId > 0) code = 'ACCOUNT_DELETED';
        else if (row !== null && (row.credential_version !== payload?.cv || row.username !== payload?.username)) code = 'CREDENTIAL_CHANGED';
      }
      res.status(401).json({ ok: false, code, error: code === 'ACCOUNT_DELETED' ? '账号已删除' : code === 'CREDENTIAL_CHANGED' ? '管理员凭据已变更' : '未登录或会话已失效' });
      return null;
    }
    if (!user) {
      res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED', error: '未登录或会话已失效' });
      return null;
    }
    if (requireAdmin && user.role !== 'admin') {
      res.status(403).json({ ok: false, code: 'FORBIDDEN', error: '仅主用户可操作' });
      return null;
    }
    return user;
  };

  const jsonBody = express.json({ limit: '256kb' });

  // ── 当前账号与退出：独立于 DSH 设置页，所有登录用户可用 ──────
  app.get('/gateway/api/me', (req, res) => {
    const me = apiAuth(req, res);
    if (!me) return;
    if (me.role === 'admin') {
      res.json({ ok: true, me: { id: me.userId, username: me.username, role: me.role } });
      return;
    }
    const perms = effectivePermissions(me.userId);
    res.json({
      ok: true,
      me: {
        id: me.userId,
        username: me.username,
        role: me.role,
        workspaceMode: perms.workspace_mode,
        workspaceRoot: perms.workspace_root,
        sandboxMode: perms.sandbox_mode,
        allowUpload: perms.allow_upload,
        allowGitDownload: perms.allow_git_download,
        hourlyTokenLimit: perms.hourly_token_limit,
        dailyMinutesLimit: perms.daily_minutes_limit,
      },
    });
  });

  app.post('/gateway/api/logout', jsonBody, (req, res) => {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (token) auth.revokeToken(token);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true, redirect: '/gateway/login' });
  });

  // ── Admin 目录浏览：指定工作区时选择服务器上的一个目录 ──
  app.get('/gateway/api/directories', (req, res) => {
    const me = apiAuth(req, res, true);
    if (!me) return;
    const requested = typeof req.query.path === 'string' && req.query.path.trim() !== ''
      ? req.query.path.trim()
      : existsSync(config.workspaceRoot) ? config.workspaceRoot : os.homedir();
    try {
      const current = realpathSync.native(requested);
      if (!statSync(current).isDirectory()) throw new Error('not a directory');
      const parentCandidate = path.dirname(current);
      const parent = parentCandidate === current ? null : realpathSync.native(parentCandidate);
      const entries = readdirSync(current, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => {
          try {
            const childPath = realpathSync.native(path.join(current, entry.name));
            return statSync(childPath).isDirectory() ? { name: entry.name, path: childPath } : null;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { name: string; path: string } => entry !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500);
      res.json({ ok: true, current, parent, entries });
    } catch (error) {
      res.status(400).json({
        ok: false, code: 'DIRECTORY_UNREADABLE',
        error: error instanceof Error ? error.message : '目录不可访问',
      });
    }
  });

  // ── 独立账户中心：创建和删除子用户（仅 Admin） ─────────────
  app.post('/gateway/api/users', jsonBody, async (req, res) => {
    const me = apiAuth(req, res, true);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const workspaceMode = body.workspaceMode;
    if (workspaceMode !== 'username' && workspaceMode !== 'specified') {
      res.status(400).json({ ok: false, code: 'INVALID_WORKSPACE_MODE', error: '必须选择工作区分配方式' });
      return;
    }
    let workspaceCreated = false;
    let created: { id: number; username: string } | null = null;
    let assignedRoot: string | null = null;
    try {
      const assignment = assignWorkspace({
        mode: workspaceMode,
        username,
        baseRoot: config.workspaceRoot,
        specifiedRoot: typeof body.workspaceRoot === 'string' ? body.workspaceRoot : null,
      });
      assignedRoot = assignment.root;
      workspaceCreated = (await ensureWorkspace(assignment.root)) === true;
      created = await auth.addSubUser(me, username, password, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      db.setPermissions(created.id, {
        allowedFolders: [assignment.root],
        hourlyTokenLimit: nullableInt(body.hourlyTokenLimit),
        dailyMinutesLimit: nullableInt(body.dailyMinutesLimit),
        allowUpload: body.allowUpload === true,
        allowGitDownload: body.allowGitDownload === true,
        banned: false,
        sandboxMode:
          body.sandboxMode === 'read-only' ||
          body.sandboxMode === 'workspace-write' ||
          body.sandboxMode === 'danger-full-access'
            ? body.sandboxMode
            : 'workspace-write',
        workspaceMode: assignment.mode,
        workspaceRoot: assignment.root,
        remark: typeof body.remark === 'string' ? body.remark.trim().slice(0, 500) : '',
      });
      res.status(201).json({
        ok: true,
        user: { id: created.id, username: created.username, workspaceMode: assignment.mode, workspaceRoot: assignment.root },
      });
    } catch (error) {
      if (created !== null) {
        try { db.deleteUser(created.id); } catch { /* 保留原始失败，避免补偿掩盖原因 */ }
      }
      if (workspaceCreated && assignedRoot !== null) {
        await removeWorkspace(assignedRoot).catch((cleanupError) => {
          console.error('[dsh-access] Workspace compensation failed; manual repair may be required:', cleanupError);
        });
      }
      if (error instanceof AuthError) {
        res.status(error.status).json({ ok: false, code: error.code, error: error.localize(langOf(req)) });
        return;
      }
      res.status(400).json({
        ok: false,
        code: 'INVALID_WORKSPACE',
        error: error instanceof Error ? error.message : '工作区配置失败',
      });
    }
  });

  app.delete('/gateway/api/users/:id', (req, res) => {
    const me = apiAuth(req, res, true);
    if (!me) return;
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ ok: false, code: 'INVALID', error: 'userId 无效' });
      return;
    }
    const target = db.getUserById(userId);
    if (!target) {
      res.status(404).json({ ok: false, code: 'NO_SUCH_USER', error: '用户不存在' });
      return;
    }
    if (target.role === 'admin' || target.id === me.userId) {
      res.status(400).json({ ok: false, code: 'CANNOT_REMOVE_ADMIN', error: '不能删除主账号' });
      return;
    }
    void auth.removeUser(me, target.username, { ip: req.ip, userAgent: req.headers['user-agent'] })
      .then(() => {
        activeConnections.revoke(target.id, 'account-deleted');
        res.json({ ok: true });
      })
      .catch((error: unknown) => {
        if (error instanceof AuthError) {
          res.status(error.status).json({ ok: false, code: error.code, error: error.localize(langOf(req)) });
          return;
        }
        res.status(500).json({ ok: false, code: 'INTERNAL', error: '删除用户失败' });
      });
  });

  // ── 概览（仅主用户）：所有用户 + 权限 + 当日用量 ─────────────
  app.get('/gateway/api/overview', (req, res) => {
    const me = apiAuth(req, res, true);
    if (!me) return;
    const day = todayLocal();
    const users = db.listUsers().map((u) => {
      const perms = effectivePermissions(u.id);
      const usage = db.getUsage(u.id, day);
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        remark: perms.remark,
        lastLoginAt: u.last_login_at,
        workspaceMode: perms.workspace_mode,
        workspaceRoot: perms.workspace_root,
        permissions: {
          allowedFolders: perms.allowed_folders,
          hourlyTokenLimit: perms.hourly_token_limit,
          dailyMinutesLimit: perms.daily_minutes_limit,
          allowUpload: perms.allow_upload,
          allowGitDownload: perms.allow_git_download,
          banned: perms.banned,
          sandboxMode: perms.sandbox_mode,
        },
        usage: usage
          ? {
              day: usage.day,
              activeSeconds: usage.active_seconds,
              hourlyTokens: usage.hourly_tokens,
              firstSeenAt: usage.first_seen_at,
              lastActiveAt: usage.last_active_at,
            }
          : null,
      };
    });
    res.json({ ok: true, me: { id: me.userId, username: me.username, role: me.role }, users });
  });

  // ── 更新某子用户权限（仅主用户） ─────────────────────────────
  app.post('/gateway/api/permissions', jsonBody, async (req, res) => {
    const me = apiAuth(req, res, true);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ ok: false, code: 'INVALID', error: 'userId 无效' });
      return;
    }
    const target = db.getUserById(userId);
    if (!target) {
      res.status(404).json({ ok: false, code: 'NO_SUCH_USER', error: '用户不存在' });
      return;
    }
    if (target.role === 'admin') {
      res.status(400).json({ ok: false, code: 'FORBIDDEN', error: '不能修改主用户权限' });
      return;
    }
    const previous = effectivePermissions(userId);
    const workspaceMode = body.workspaceMode ?? previous.workspace_mode;
    if (workspaceMode !== 'username' && workspaceMode !== 'specified') {
      res.status(400).json({ ok: false, code: 'INVALID_WORKSPACE_MODE', error: '必须为子用户分配一个工作区' });
      return;
    }
    try {
      const requestedFolders = stringArray(body.allowedFolders);
      if (requestedFolders.length > 1) {
        res.status(400).json({ ok: false, code: 'MULTIPLE_WORKSPACES', error: '只能分配一个工作区域' });
        return;
      }
      const specifiedRoot =
        typeof body.workspaceRoot === 'string'
          ? body.workspaceRoot
          : requestedFolders.length === 1
            ? requestedFolders[0]
            : previous.workspace_root;
      const assignment = assignWorkspace({
        mode: workspaceMode,
        username: target.username,
        baseRoot: config.workspaceRoot,
        specifiedRoot,
      });
      const workspaceCreated = (await ensureWorkspace(assignment.root)) === true;
      const hourlyTokenLimit = nullableInt(body.hourlyTokenLimit);
      const dailyMinutesLimit = nullableInt(body.dailyMinutesLimit);
      const allowUpload = body.allowUpload !== false;
      const allowGitDownload = body.allowGitDownload !== false;
      const banned = body.banned === true;
      const rawSandbox = typeof body.sandboxMode === 'string' ? body.sandboxMode : '';
      const sandboxMode =
        rawSandbox === 'read-only' || rawSandbox === 'workspace-write' || rawSandbox === 'danger-full-access'
          ? rawSandbox
          : previous.sandbox_mode ?? 'read-only';
      const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 500) : previous.remark;
      try {
        db.setPermissions(userId, {
          allowedFolders: [assignment.root],
          hourlyTokenLimit,
          dailyMinutesLimit,
          allowUpload,
          allowGitDownload,
          banned,
          sandboxMode,
          workspaceMode: assignment.mode,
          workspaceRoot: assignment.root,
          remark,
        });
      } catch (error) {
        try {
          db.setPermissions(userId, {
            allowedFolders: previous.allowed_folders,
            hourlyTokenLimit: previous.hourly_token_limit,
            dailyMinutesLimit: previous.daily_minutes_limit,
            allowUpload: previous.allow_upload,
            allowGitDownload: previous.allow_git_download,
            banned: previous.banned,
            sandboxMode: previous.sandbox_mode,
            workspaceMode: previous.workspace_mode,
            workspaceRoot: previous.workspace_root,
            remark: previous.remark,
          });
        } catch {
          try {
            db.setPermissions(userId, {
              allowedFolders: [],
              hourlyTokenLimit: previous.hourly_token_limit,
              dailyMinutesLimit: previous.daily_minutes_limit,
              allowUpload: previous.allow_upload,
              allowGitDownload: previous.allow_git_download,
              banned: previous.banned,
              sandboxMode: previous.sandbox_mode,
              workspaceMode: 'repair-required',
              workspaceRoot: null,
              remark: previous.remark,
            });
          } catch { /* 数据库不可写时保留原始错误 */ }
        }
        if (workspaceCreated && assignment.root !== previous.workspace_root) {
          await removeWorkspace(assignment.root).catch((cleanupError) => {
            console.error('[dsh-access] Workspace compensation failed; manual repair may be required:', cleanupError);
          });
        }
        throw error;
      }
      db.audit('permissions_changed', {
        username: target.username,
        detail: JSON.stringify({
          workspaceMode: assignment.mode, workspaceRoot: assignment.root, hourlyTokenLimit, dailyMinutesLimit,
          allowUpload, allowGitDownload, banned, sandboxMode, remark,
        }),
      });
      if (!previous.banned && banned) activeConnections.revoke(userId, 'account-banned');
      res.json({ ok: true, workspaceMode: assignment.mode, workspaceRoot: assignment.root });
    } catch (error) {
      res.status(400).json({
        ok: false, code: 'INVALID_WORKSPACE', error: error instanceof Error ? error.message : '工作区配置失败',
      });
    }
  });

  // ── token 用量上报（客户端 liveTokenUsage 投影增量，所有登录用户） ──
  // 替代旧的 HTTP 响应正则计量：客户端复用 dsh 的 tokenUsage 投影（与
  // dsh-web-ui 同源），只上报「增量」，服务端按小时窗口累计并用于配额判定。
  app.post('/gateway/api/usage/report', jsonBody, (req, res) => {
    const me = apiAuth(req, res);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tokens = Number(body.tokens);
    if (!Number.isFinite(tokens) || tokens < 0 || tokens > 100_000_000) {
      res.status(400).json({ ok: false, code: 'INVALID', error: 'tokens 无效' });
      return;
    }
    const rounded = Math.round(tokens);
    if (rounded <= 0) {
      res.json({ ok: true });
      return;
    }
    db.addTokens(me.userId, todayLocal(), rounded, new Date().toISOString());
    res.json({ ok: true });
  });

  // ── 留言列表（所有登录用户；按收件人过滤） ─────────────────────
  app.get('/gateway/api/messages', (req, res) => {
    const me = apiAuth(req, res);
    if (!me) return;
    const all = db.listMessages(300);
    const mine = all.filter(
      (m) => m.recipient_id === null || m.recipient_id === me.userId || m.sender_id === me.userId,
    );
    res.json({ ok: true, me: { id: me.userId, username: me.username, role: me.role }, messages: mine });
  });

  // ── 发送留言（所有登录用户） ─────────────────────────────────
  app.post('/gateway/api/messages', jsonBody, (req, res) => {
    const me = apiAuth(req, res);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? sanitizeText(body.content) : '';
    if (content === '') {
      res.status(400).json({ ok: false, code: 'INVALID', error: '内容不能为空' });
      return;
    }
    if (content.length > 4000) {
      res.status(400).json({ ok: false, code: 'INVALID', error: '内容过长' });
      return;
    }
    const recipientId = nullableInt(body.recipientId);
    const tags = stringArray(body.tags).slice(0, 8);
    const msg = db.addMessage(me.userId, recipientId, content, tags);
    broadcastMessage(msg);
    res.json({ ok: true, message: msg });
  });

  // ── SSE 实时推送（所有登录用户） ─────────────────────────────
  app.get('/gateway/api/messages/stream', (req, res) => {
    const me = apiAuth(req, res);
    if (!me) return;
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    let credentialVersion = 0;
    try {
      credentialVersion = token === null ? 0 : auth.verifyToken(token).cv;
    } catch {
      res.status(401).end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'init', me: { id: me.userId, username: me.username, role: me.role } })}\n\n`);
    chatClients.add(res);
    const stopWatch = watchConnection(me.userId, credentialVersion);
    const untrack = activeConnections.track(me.userId, (reason) => {
      stopWatch();
      try {
        res.write(`event: account-revoked\ndata: ${JSON.stringify({ reason })}\n\n`);
      } finally {
        res.end();
      }
    });
    req.on('close', () => {
      stopWatch();
      chatClients.delete(res);
      untrack();
    });
  });

  // ── 认证门卫：非 /gateway 请求必须带有效会话 ─────────────────
  // 路径先用 WHATWG URL 规范化（. / .. / %2e%2e 均被归一），再做前缀判断——
  // 否则 /gateway/../api/xxx 会绕过前缀检查直达上游（dsh 侧 new URL 同样
  // 会归一化该路径，等于未认证调用任意 RPC）。解析失败一律按未认证处理，绝不 500。
  app.use(async (req, res, next) => {
    try {
      const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (parsed.pathname.startsWith('/gateway/')) return next();
      const user = sessionOf(req);
      if (!user) {
        if (parsed.pathname.startsWith('/api/dsh-access/remote-access/')) {
          res.status(401).json({ ok: false, code: 'NOT_AUTHENTICATED', error: '未登录或会话已失效' });
          return;
        }
        // 重定向兼容层：记录原始 URL，登录后跳回
        const nextUrl = encodeURIComponent(req.originalUrl);
        res.redirect(302, `/gateway/login?next=${nextUrl}`);
        return;
      }
      const row = db.getUserById(user.userId);
      if (!row) {
        res.redirect(302, `/gateway/login?next=${encodeURIComponent(req.originalUrl)}`);
        return;
      }
      if (row.role !== 'admin') {
        // Subusers cannot reach the native Settings surface by direct URL, even
        // when the request is a GET that would otherwise pass the RPC policy.
        if (parsed.pathname === '/settings' || parsed.pathname.startsWith('/settings/')) {
          res.redirect(302, '/');
          return;
        }
        const perms = effectivePermissions(user.userId);
        const lang = langOf(req);
        const requestDecision = classifyGatewayRequest(req.method, parsed.pathname, 'user');
        if (!requestDecision.allowed) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.settingsDenied')));
          return;
        }
        if (perms.banned) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.banned')));
          return;
        }
        if (WORKSPACE_LIST_RE.test(parsed.pathname) && perms.workspace_root !== null) {
          try {
            await ensureWorkspace(perms.workspace_root);
          } catch {
            res.status(502).type('html').send(forbiddenPage(lang, t(lang, 'gw.workspaceUnavailable')));
            return;
          }
        }
        if (!perms.allow_upload && isUploadRequest(req.method, parsed.pathname)) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.noUpload')));
          return;
        }
        if (!perms.allow_git_download && (isGitRequest(parsed.pathname) || isAionuiFileRead(req.method, parsed.pathname))) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.noGit')));
          return;
        }
        if (!perms.allow_upload && isAionuiFileWrite(req.method, parsed.pathname)) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.noUpload')));
          return;
        }
        if (isWorkspaceWrite(parsed.pathname)) {
          res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.workspaceDenied')));
          return;
        }
        // aionui-panel 文件树：GET/HEAD 的 root 在 query 里，直接校验白名单（拦截目录浏览/下载）
        if ((req.method === 'GET' || req.method === 'HEAD') && isAionuiPanel(parsed.pathname)) {
          const aionuiRoot = aionuiRootFrom(req.method, parsed.pathname, parsed.searchParams, null);
          if (aionuiRoot === null || !permissionPathAllowed(perms, aionuiRoot)) {
            res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.folderDenied')));
            return;
          }
        }
        if (!isStaticAsset(parsed.pathname) && !isPollingRequest(parsed.pathname)) {
          // 配额计时从子用户“说第一句话”（发消息锚点）才开始：
          // 未使用过的子用户（无当日记录且非锚点请求）不创建记录、不受配额限制
          const day = todayLocal();
          if (db.getUsage(user.userId, day) !== null || isUsageAnchorRequest(parsed.pathname)) {
            const usage = touchUsageThrottled(user.userId);
            if (usage) {
              if (perms.daily_minutes_limit !== null && usage.active_seconds >= perms.daily_minutes_limit * 60) {
                res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.timeLimit')));
                return;
              }
              if (perms.hourly_token_limit !== null && usage.hourly_tokens >= perms.hourly_token_limit) {
                res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.tokenLimit')));
                return;
              }
            }
          }
        }
        // 附上权限与用户，供后续文件夹限制中间件 / 代理 token 计量使用
        (req as Req).dshAccessUser = user.userId;
        (req as Req).dshAccessPerms = perms;
      }
      return next();
    } catch {
      res.redirect(302, '/gateway/login');
    }
  });

  // ── 反向代理（HTTP）→ 上游 dsh ──────────────────────────────
  app.use((req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    markGatewayProxyHeaders(headers);
    // 改写 Host 为上游地址（过 dsh 的 browser-trust fence 第 1 道：Host 检查）
    headers.host = `${upstreamHost}:${upstreamPort}`;
    // 改写 Origin 为上游地址（过第 3 道：Origin 必须与 Host 同 host——
    // 浏览器发来的是网关地址 origin，与改写后的 Host 不一致会被 403）
    if (typeof headers.origin === 'string') {
      headers.origin = `http://${upstreamHost}:${upstreamPort}`;
    }
    delete headers['content-length'];

    const parsedUrl = new URL(req.originalUrl, `http://${req.headers.host ?? 'localhost'}`);
    // 请求上挂的用户/权限（子用户才有）
    const reqAs = req as Req;
    // 请求上挂的用户/权限（子用户才有）
    const upstreamReq = http.request(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        // 规范化路径转发（与 dsh 的 new URL 解析行为一致，杜绝 ../ 混入上游）
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers,
        agent: upstreamAgent,
      },
      (upstreamRes) => {
        const contentType = String(upstreamRes.headers['content-type'] ?? '');
        const encoding = String(upstreamRes.headers['content-encoding'] ?? '');

        // ── HTML 响应：缓冲 + 注入兼容脚本（crypto.randomUUID polyfill 等） ──
        if (contentType.includes('text/html')) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              body = decodeResponseBody(body, encoding);
              const html = body.toString('utf8');
              const injected = html.replace(/<head[^>]*>/i, (match) => match + INJECT_SCRIPT);
              let out = Buffer.from(injected, 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              // 代理层补齐防嵌框头（dsh 应用自身未设置）：
              // 允许同源内嵌（dsh 内部如有同源 iframe 不受影响），禁止跨站嵌框
              respHeaders['x-frame-options'] = 'SAMEORIGIN';
              respHeaders['content-security-policy'] = "frame-ancestors 'self'";
              if (encoding.includes('gzip')) {
                out = zlib.gzipSync(out);
                respHeaders['content-encoding'] = 'gzip';
              }
              respHeaders['content-length'] = String(out.length);
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(out);
            } catch {
              res.destroy();
            }
          });
          upstreamRes.on('error', () => {
            res.destroy();
          });
          return;
        }

        // ── host.listDirectory 响应：把 Home/面包屑钉在授权根，避免展示或导航到父目录 ──
        if (
          reqAs.dshAccessPerms !== undefined &&
          req.method === 'POST' &&
          HOST_LIST_DIRECTORY_RE.test(parsedUrl.pathname)
        ) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              const enc = String(upstreamRes.headers['content-encoding'] ?? '');
              body = decodeResponseBody(body, enc);
              const parsed = JSON.parse(body.toString('utf8'));
              const restricted = restrictDirectoryListing(parsed, reqAs.dshAccessPerms!);
              const out = Buffer.from(JSON.stringify(restricted), 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              const encoded = compressResponseBody(req, respHeaders, out);
              res.writeHead(upstreamRes.statusCode ?? 200, encoded.headers);
              res.end(encoded.body);
            } catch {
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(Buffer.concat(chunks));
            }
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        // ── workspace.list 响应：收集 id→path 缓存 + 受限子用户过滤白名单外的工作区 ──
        if (req.method === 'POST' && /^\/api\/workspace[.\/]list$/.test(parsedUrl.pathname)) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              const enc = String(upstreamRes.headers['content-encoding'] ?? '');
              body = decodeResponseBody(body, enc);
              const parsed = JSON.parse(body.toString('utf8'));
              // 先缓存全量 workspaceId→path/session count，供 create/delete/session.create 授权。
              workspacePathById.clear();
              workspaceSessionCountById.clear();
              collectIdPathPairs(parsed, workspacePathById);
              collectWorkspaceSessionCounts(parsed, workspaceSessionCountById);
              const restricted =
                reqAs.dshAccessPerms !== undefined;
              const outBody = restricted
                ? filterByAuthorizedPathField(parsed, reqAs.dshAccessPerms!, 'path')
                : parsed;
              const out = Buffer.from(JSON.stringify(outBody), 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              const encoded = compressResponseBody(req, respHeaders, out);
              res.writeHead(upstreamRes.statusCode ?? 200, encoded.headers);
              res.end(encoded.body);
            } catch {
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(Buffer.concat(chunks));
            }
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        // ── session.list 响应过滤：受限子用户只看得到白名单内工作区的会话 ──
        if (
          reqAs.dshAccessPerms !== undefined &&
          req.method === 'POST' &&
          /^\/api\/session[.\/]list$/.test(parsedUrl.pathname)
        ) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              const enc = String(upstreamRes.headers['content-encoding'] ?? '');
              body = decodeResponseBody(body, enc);
              const parsed = JSON.parse(body.toString('utf8'));
              sessionPathById.clear();
              collectSessionPathPairs(parsed, sessionPathById);
              const filtered = filterByAuthorizedPathField(parsed, reqAs.dshAccessPerms!, 'cwd');
              const out = Buffer.from(JSON.stringify(filtered), 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              const encoded = compressResponseBody(req, respHeaders, out);
              res.writeHead(upstreamRes.statusCode ?? 200, encoded.headers);
              res.end(encoded.body);
            } catch {
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(Buffer.concat(chunks));
            }
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        // ── session.history：模型输入边界清洗隐藏 Unicode；文件 read/raw 不在此改写 ──
        if (req.method === 'POST' && /^\/api\/session[.\/]history$/.test(parsedUrl.pathname)) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              body = decodeResponseBody(body, String(upstreamRes.headers['content-encoding'] ?? ''));
              const cleaned = sanitizeJsonStrings(JSON.parse(body.toString('utf8')));
              const out = Buffer.from(JSON.stringify(cleaned), 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              delete respHeaders['transfer-encoding'];
              const encoded = compressResponseBody(req, respHeaders, out);
              res.writeHead(upstreamRes.statusCode ?? 200, encoded.headers);
              res.end(encoded.body);
            } catch {
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(Buffer.concat(chunks));
            }
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        // ── session.search 响应过滤：搜索结果也不能泄露区域外会话 ──
        if (
          reqAs.dshAccessPerms !== undefined &&
          req.method === 'POST' &&
          SESSION_SEARCH_RE.test(parsedUrl.pathname)
        ) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            try {
              let body: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
              const enc = String(upstreamRes.headers['content-encoding'] ?? '');
              body = decodeResponseBody(body, enc);
              const parsed = JSON.parse(body.toString('utf8'));
              const filtered = filterByAuthorizedPathField(parsed, reqAs.dshAccessPerms!, 'cwd');
              const out = Buffer.from(JSON.stringify(filtered), 'utf8');
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              delete respHeaders['content-length'];
              delete respHeaders['content-encoding'];
              const encoded = compressResponseBody(req, respHeaders, out);
              res.writeHead(upstreamRes.statusCode ?? 200, encoded.headers);
              res.end(encoded.body);
            } catch {
              const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
              res.writeHead(upstreamRes.statusCode ?? 200, respHeaders);
              res.end(Buffer.concat(chunks));
            }
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        // ── 非 HTML：原样流式转发 ───────────────────────────────────
        const respHeaders: Record<string, string | string[] | undefined> = { ...upstreamRes.headers };
        // dsh 对插件/静态资源返回 no-cache（或不给缓存头），浏览器每次
        // 进页面都要重新下载全部 ~30 个插件文件，导致卡在 "Loading plugins…"。
        // rev 参数/文件名都是内容哈希（换内容即换新 URL），可安全长缓存：
        const isHashedStatic =
          parsedUrl.pathname.startsWith('/assets/') ||
          (parsedUrl.pathname.startsWith('/plugins/') && parsedUrl.searchParams.has('rev'));
        if (isHashedStatic) {
          respHeaders['cache-control'] = 'public, max-age=31536000, immutable';
        }
        if (shouldBufferForCompression(req, respHeaders)) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            const encoded = compressResponseBody(req, respHeaders, Buffer.concat(chunks));
            res.writeHead(upstreamRes.statusCode ?? 502, encoded.headers);
            res.end(encoded.body);
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, respHeaders);
        upstreamRes.pipe(res);
        // 上游响应流中途断开：客户端侧直接中断（头已发，不能再写错误页）
        upstreamRes.on('error', () => {
          res.destroy();
        });
      },
    );
    upstreamReq.on('error', (error) => {
      if (res.headersSent) {
        // 响应已开始转发：只能中断连接，避免 ERR_HTTP_HEADERS_SENT 崩溃
        res.destroy();
        return;
      }
      res
        .status(502)
        .type('html')
        .send(`<h3>${escapeHtml(t(langOf(req), 'gw.upstreamDown'))}</h3><p>${escapeHtml(error.message)}</p>`);
    });
    // 客户端中途断开：中止上游请求，避免悬挂连接
    res.on('close', () => {
      if (!res.writableEnded) upstreamReq.destroy();
    });
    // 受限子用户的请求体缓冲检查（尽力而为）：
    //   1) 文件夹白名单：session.create/fork 的 cwd/workspaceId 必须在授权目录内
    //   2) 沙盒权限：settings.mutate 试图把 defaultPreset 切到高于授权级别 → 403
    const needsFolderCheck =
      reqAs.dshAccessPerms !== undefined &&
      (req.method === 'POST' || req.method === 'PUT') &&
      (WORKSPACE_ENDPOINT_RE.test(parsedUrl.pathname) ||
        HOST_FILESYSTEM_ENDPOINT_RE.test(parsedUrl.pathname) ||
        isAionuiPanel(parsedUrl.pathname) ||
        SESSION_SCOPED_RE.test(parsedUrl.pathname));
    const needsTransferCheck =
      reqAs.dshAccessPerms !== undefined &&
      (((req.method === 'POST' || req.method === 'PUT') &&
        (isUploadRequest(req.method, parsedUrl.pathname) || isGitRequest(parsedUrl.pathname))) ||
        ((req.method === 'GET' || req.method === 'HEAD') && isGitRequest(parsedUrl.pathname)));
    const needsSandboxCheck =
      reqAs.dshAccessPerms !== undefined &&
      reqAs.dshAccessPerms.sandbox_mode !== null &&
      (req.method === 'POST' || req.method === 'PUT') &&
      /^\/api\/settings[.\/]/.test(parsedUrl.pathname);
    // 沙盒切换的实际主路径是 /permission slash 命令：经 commands/execute RPC
    // （body { agentId, line }，line 形如 "/permission workspace-write"），
    // 而不是 settings.mutate。这里对受限子用户同样做越权预设检查。
    const needsCommandCheck =
      reqAs.dshAccessPerms !== undefined &&
      reqAs.dshAccessPerms.sandbox_mode !== null &&
      (req.method === 'POST' || req.method === 'PUT') &&
      /^\/api\/commands[.\/]execute$/.test(parsedUrl.pathname);
    // AI 提权审批：沙盒升级经 /api/respond（body { sessionId, approvalId, outcome }）。
    // 受限子用户（sandbox_mode 非空）即使点了“允许”，也强制改成 rejected，把 AI 的
    // 越权提权直接取消。ask_user_question 用的是 answer 字段，不会被这里误伤。
    const needsApprovalCheck =
      reqAs.dshAccessPerms !== undefined &&
      reqAs.dshAccessPerms.sandbox_mode !== null &&
      (req.method === 'POST' || req.method === 'PUT') &&
      /^\/api\/respond$/.test(parsedUrl.pathname);
    const needsSshHostCheck =
      (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') &&
      /^\/api\/dsh-ssh[.\/](hosts|test)([.\/]|$)/.test(parsedUrl.pathname);

    if (needsFolderCheck || needsTransferCheck || needsSandboxCheck || needsCommandCheck || needsApprovalCheck || needsSshHostCheck) {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const MAX_BODY = 64 * 1024;
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_BODY) {
          settled = true;
          upstreamReq.destroy();
          res.status(413).type('html').send(forbiddenPage(langOf(req), t(langOf(req), 'gw.folderDenied')));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (settled) return;
        settled = true;
        const lang = langOf(req);
        let bodyObj: unknown = null;
        let bodyRewritten = false;
        try {
          bodyObj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          bodyObj = null;
        }

        if (needsSshHostCheck) {
          const allowed = await sshHostRequestAllowed(req.method, parsedUrl.pathname, bodyObj, async (hostname) => {
            const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
            return addresses.map((address) => address.address);
          });
          if (!allowed) {
            upstreamReq.destroy();
            res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.folderDenied')));
            return;
          }
        }

        if (needsTransferCheck) {
          let transferPath = extractPathFromBody(bodyObj) ?? requestPathFromQuery(parsedUrl);
          if (transferPath === null && /^\/api\/session[.\/]export/.test(parsedUrl.pathname)) {
            const sessionId = findStringField(bodyObj, 'sessionId') ?? parsedUrl.searchParams.get('sessionId');
            if (sessionId !== null) {
              transferPath = sessionPathById.get(sessionId) ?? null;
              if (transferPath === null) {
                await refreshSessionPathMap().catch(() => undefined);
                transferPath = sessionPathById.get(sessionId) ?? null;
              }
            }
          }
          if (transferPath === null || !permissionPathAllowed(reqAs.dshAccessPerms!, transferPath)) {
            upstreamReq.destroy();
            res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.folderDenied')));
            return;
          }
        }

        if (needsFolderCheck) {
          let targetPath: string | null = null;
          if (bodyObj !== null) {
            if (isAionuiPanel(parsedUrl.pathname)) {
              const root = aionuiRootFrom(req.method, parsedUrl.pathname, parsedUrl.searchParams, bodyObj);
              const relativePath = findStringField(bodyObj, 'path');
              if (root !== null) {
                targetPath = relativePath !== null && !path.isAbsolute(relativePath)
                  ? path.resolve(root, relativePath)
                  : relativePath ?? root;
              }
            } else if (HOST_LIST_DIRECTORY_RE.test(parsedUrl.pathname)) {
              targetPath = extractPathFromBody(bodyObj);
              if (targetPath === null && reqAs.dshAccessPerms!.workspace_root !== null) {
                targetPath = reqAs.dshAccessPerms!.workspace_root;
                bodyObj = injectRpcPayloadPath(bodyObj, targetPath);
                bodyRewritten = true;
              }
            } else if (SESSION_SCOPED_RE.test(parsedUrl.pathname)) {
              const sessionId = findStringField(bodyObj, 'sessionId');
              targetPath = sessionId === null ? null : sessionPathById.get(sessionId) ?? null;
              if (targetPath === null && sessionId !== null) {
                await refreshSessionPathMap().catch(() => undefined);
                targetPath = sessionPathById.get(sessionId) ?? null;
              }
            } else if (HOST_CREATE_DIRECTORY_RE.test(parsedUrl.pathname)) {
              const parentPath = extractPathFromBody(bodyObj);
              const name = findStringField(bodyObj, 'name');
              targetPath = parentPath !== null && name !== null ? path.resolve(parentPath, name) : null;
              const assignedRank =
                SANDBOX_RANK[reqAs.dshAccessPerms!.sandbox_mode as keyof typeof SANDBOX_RANK] ?? 0;
              if (assignedRank < SANDBOX_RANK['workspace-write']) {
                upstreamReq.destroy();
                res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.sandboxDenied')));
                return;
              }
            } else {
              targetPath = extractPathFromBody(bodyObj);
              if (targetPath === null) {
                const wid = extractWorkspaceId(bodyObj);
                if (wid !== null) {
                  targetPath = workspacePathById.get(wid) ?? null;
                  if (targetPath === null) {
                    await refreshWorkspacePathMap().catch(() => undefined);
                    targetPath = workspacePathById.get(wid) ?? null;
                  }
                  if (
                    targetPath === null &&
                    SESSION_CREATE_RE.test(parsedUrl.pathname) &&
                    reqAs.dshAccessPerms!.workspace_root !== null
                  ) {
                    await ensureWorkspace(reqAs.dshAccessPerms!.workspace_root).catch(() => undefined);
                    await refreshWorkspacePathMap().catch(() => undefined);
                    const rootEntry = [...workspacePathById.entries()]
                      .find(([, workspacePath]) => workspacePath === reqAs.dshAccessPerms!.workspace_root);
                    if (rootEntry !== undefined) {
                      targetPath = rootEntry[1];
                      bodyObj = replaceRpcWorkspaceId(bodyObj, rootEntry[0]);
                      bodyRewritten = true;
                    }
                  }
                }
              }
              if (targetPath === null && SESSION_FORK_RE.test(parsedUrl.pathname)) {
                const sessionId = findStringField(bodyObj, 'sessionId');
                if (sessionId !== null) {
                  targetPath = sessionPathById.get(sessionId) ?? null;
                  if (targetPath === null) {
                    await refreshSessionPathMap().catch(() => undefined);
                    targetPath = sessionPathById.get(sessionId) ?? null;
                  }
                }
              }
            }
          }
          if (
            WORKSPACE_DELETE_RE.test(parsedUrl.pathname) &&
            targetPath !== null &&
            targetPath === reqAs.dshAccessPerms!.workspace_root
          ) {
            upstreamReq.destroy();
            sendRpcDenied(res, bodyObj, 'workspace-root-required', t(lang, 'gw.workspaceRootRequired'));
            return;
          }
          if (WORKSPACE_DELETE_RE.test(parsedUrl.pathname)) {
            const workspaceId = extractWorkspaceId(bodyObj);
            if (workspaceId !== null && (workspaceSessionCountById.get(workspaceId) ?? 0) > 0) {
              upstreamReq.destroy();
              sendRpcDenied(res, bodyObj, 'workspace-not-empty', t(lang, 'gw.workspaceNotEmpty'));
              return;
            }
          }
          if (targetPath === null || !permissionPathAllowed(reqAs.dshAccessPerms!, targetPath)) {
            upstreamReq.destroy();
            res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.folderDenied')));
            return;
          }
        }

        if (needsSandboxCheck && bodyObj !== null) {
          const preset = presetFromSettingsMutate(bodyObj);
          const assignedRank =
            SANDBOX_RANK[reqAs.dshAccessPerms!.sandbox_mode as keyof typeof SANDBOX_RANK] ?? 0;
          const targetRank = preset === null ? assignedRank : sandboxPresetRank(preset);
          if (targetRank > assignedRank) {
            res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.sandboxDenied')));
            return;
          }
        }

        if (needsCommandCheck && bodyObj !== null) {
          const line = findStringField(bodyObj, 'line');
          const preset = line === null ? null : permissionPresetFromCommand(line);
          if (preset !== null) {
            const assignedRank =
              SANDBOX_RANK[reqAs.dshAccessPerms!.sandbox_mode as keyof typeof SANDBOX_RANK] ?? 0;
            const targetRank = sandboxPresetRank(preset);
            if (targetRank > assignedRank) {
              res.status(403).type('html').send(forbiddenPage(lang, t(lang, 'gw.sandboxDenied')));
              return;
            }
          }
        }

        // 审批响应改写：受限子用户的 AI 提权审批一律强制 rejected（返回取消）
        let forwardBody = bodyRewritten
          ? Buffer.from(JSON.stringify(bodyObj), 'utf8')
          : Buffer.concat(chunks);
        if (needsApprovalCheck && bodyObj !== null && typeof bodyObj === 'object') {
          if (forceRejectApproval(bodyObj)) {
            forwardBody = Buffer.from(JSON.stringify(bodyObj), 'utf8');
          }
        }

        upstreamReq.end(forwardBody);
      });
      req.on('error', () => {
        if (!settled) {
          settled = true;
          upstreamReq.destroy();
        }
      });
    } else {
      req.pipe(upstreamReq);
    }
  });

  const hasTls = config.gateway.tls !== null;
  const server = hasTls
    ? https.createServer(
        {
          // 默认证书（启动时读一次）：不带 SNI 的客户端（如 https://127.0.0.1
          // 直连、插件→网关内部回环调用）不会触发 SNICallback，必须要有默认
          // cert/key 才能完成握手
          cert: readFileSync(config.gateway.tls!.cert),
          key: readFileSync(config.gateway.tls!.key),
          // 证书每次 TLS 握手时从文件动态读取：自动续期写入新文件后
          // 下一个连接即用新证书，无需重启进程
          SNICallback: (_servername, callback) => {
            try {
              callback(
                null,
                createSecureContext({
                  cert: readFileSync(config.gateway.tls!.cert),
                  key: readFileSync(config.gateway.tls!.key),
                  minVersion: 'TLSv1.2',
                }),
              );
            } catch (error) {
              callback(error as Error);
            }
          },
          // 仅允许 TLS 1.2+，拒绝老旧协议与弱套件协商
          minVersion: 'TLSv1.2',
        },
        app,
      )
    : http.createServer(app);

  // ── WebSocket 升级代理（dsh 前端依赖 WS 通信） ──────────────
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (classifyGatewayPath(req.url ?? '/') !== 'upstream') {
      socket.destroy();
      return;
    }
    // 认证检查（复用 Cookie）
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    let user: { userId: number; username: string; role: 'admin' | 'user'; cv: number } | null = null;
    if (token) {
      try {
        user = auth.verifyToken(token);
      } catch {
        user = null;
      }
    }
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 转发升级请求（Host/Origin 改写，同 HTTP 路径；路径已规范化）
    let upstreamSocket: net.Socket | null = null;
    const stopWatch = watchConnection(user.userId, user.cv);
    const untrack = activeConnections.track(user.userId, () => {
      stopWatch();
      socket.destroy();
      upstreamSocket?.destroy();
    });
    const connectedSocket = net.connect(upstreamPort, upstreamHost, () => {
      const lines: string[] = [
        `${req.method ?? 'GET'} ${url.pathname + url.search} HTTP/1.1`,
      ];
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === 'host') {
          lines.push(`Host: ${upstreamHost}:${upstreamPort}`);
        } else if (key.toLowerCase() === 'origin' && typeof value === 'string') {
          lines.push(`Origin: http://${upstreamHost}:${upstreamPort}`);
        } else if (value !== undefined) {
          lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
        }
      }
      lines.push('', '');
      connectedSocket.write(lines.join('\r\n'));
      if (head && head.length > 0) connectedSocket.write(head);
      socket.pipe(connectedSocket);
      connectedSocket.pipe(socket);
    });
    upstreamSocket = connectedSocket;
    connectedSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket?.destroy());
    socket.on('close', () => { stopWatch(); untrack(); upstreamSocket?.destroy(); });
    connectedSocket.on('close', () => { stopWatch(); untrack(); socket.destroy(); });
  });

  return server;
}

/**
 * HTTP→HTTPS 301 跳转服务器（仅 TLS 模式且配置了 redirectPort 时创建）。
 * 解决“网关裸奔在 80 明文”问题：80 不再提供任何页面内容，只做跳转。
 * 自动 HTTPS 模式下同时承载 ACME HTTP-01 挑战应答（/.well-known/acme-challenge/*）。
 */
export function createRedirectServer(
  config: PlatformConfig,
  challengeStore?: Map<string, string>,
): http.Server | null {
  if (config.gateway.tls === null || config.gateway.redirectPort === null) return null;
  return http.createServer((req, res) => {
    // ACME HTTP-01 挑战应答：优先于跳转处理（Let's Encrypt 校验走这里）
    if (challengeStore) {
      const pathname = (() => {
        try {
          return new URL(req.url ?? '/', 'http://localhost').pathname;
        } catch {
          return '/';
        }
      })();
      const prefix = '/.well-known/acme-challenge/';
      if (pathname.startsWith(prefix)) {
        const token = pathname.slice(prefix.length).split('/')[0];
        const keyAuthz =
          token !== '' && /^[A-Za-z0-9_-]{1,128}$/.test(token)
            ? challengeStore.get(token)
            : undefined;
        if (keyAuthz !== undefined) {
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(keyAuthz)),
            'Cache-Control': 'no-store',
            Connection: 'close',
          });
          res.end(keyAuthz);
          return;
        }
        res.writeHead(404, { 'Content-Length': '0', Connection: 'close' });
        res.end();
        return;
      }
    }
    // Host 头部可能带跳转端口或 :80 后缀，跳转目标去掉它们；空 Host 回退主端口
    const strip = new RegExp(`:(${config.gateway.redirectPort}|80)$`);
    const rawHost = (req.headers.host ?? '').replace(strip, '');
    // 防 Host 反射（HTTP/1.0 可伪造 Host: evil.com → Location: https://evil.com/）：
    // 自动 HTTPS 固定用证书域名；否则用配置的公网主机；再否则严格校验请求 Host 格式
    const candidate = config.gateway.domain || config.gateway.publicHost || rawHost;
    const host =
      /^[A-Za-z0-9.\-[\]:]+$/.test(candidate) && candidate !== ''
        ? candidate
        : `127.0.0.1:${config.gateway.port}`;
    const target = `https://${host}${req.url ?? '/'}`;
    res.writeHead(301, {
      Location: target,
      'Content-Length': '0',
      Connection: 'close',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end();
  });
}
