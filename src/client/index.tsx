// dsh 浏览器侧插件：在设置页"插件"列表里注册 dsh-passwords 卡片。
// 卡片内容：
//   - 远程设置补丁状态 + "重载补丁"按钮（任何登录用户可触发；补丁强制启用）
//   - 用户管理（改密/改名/子用户） → fetch /api/dsh-passwords/*（网关
//     JWT cookie 鉴权）
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { DshPasswordsCard } from './card';
import { ChatLauncher } from './chat';
import { TokenReporter } from './token';
import { AccountMenu } from './account';
import { MobileNavigation } from './mobile';
import { zh, en } from './locales';

/** 卡片样式：全部使用 dsh 设计令牌（--dsw-alias-*），颜色/主题与官方 PluginCard 完全一致 */
const CSS = `
.dshpw-card{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;font-size:13px;line-height:1.5;overflow:hidden}
.dshpw-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dshpw-card.open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dshpw-header{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;background:none;border:0;border-radius:12px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dshpw-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dshpw-head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dshpw-title{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dshpw-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dshpw-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dshpw-chevron.open{transform:rotate(180deg)}
.dshpw-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 14px;display:flex;flex-direction:column;gap:14px}
.dshpw-section{display:flex;flex-direction:column;gap:8px}
.dshpw-label{display:block;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshpw-input{width:100%;box-sizing:border-box;min-width:0;padding:7px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .15s,box-shadow .15s}
.dshpw-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.dshpw-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshpw-btn{appearance:none;border:0;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;font-weight:500;background:var(--dsw-alias-brand-primary);color:#fff;cursor:pointer}
.dshpw-btn:hover:not(:disabled){filter:brightness(1.1)}
.dshpw-btn:disabled{opacity:.4;cursor:default}
.dshpw-btn.danger{background:none;border:1px solid var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
.dshpw-btn.danger:hover:not(:disabled){filter:none;background:color-mix(in srgb,var(--dsw-alias-label-error) 10%,transparent)}
.dshpw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dshpw-gateway-port{display:grid;gap:6px;margin-top:10px}.dshpw-gateway-port .dshpw-input{width:auto;flex:1 1 160px}
.dshpw-limit-field{min-width:0;flex:1 1 220px;display:flex;flex-direction:column;gap:5px}
.dshpw-limit-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);line-height:1.4}
.dshpw-user-block{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshpw-user{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0}
.dshpw-user-toggle{appearance:none;min-width:0;flex:1;border:0;background:transparent;color:inherit;padding:0;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer;font:inherit}
.dshpw-user-identity{min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dshpw-user-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshpw-card-user-search{margin-bottom:2px}
.dshpw-perm{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.dshpw-user-permission-editor{margin:0 0 10px 0}
.dshpw-perm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshpw-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshpw-check input{accent-color:var(--dsw-alias-brand-primary)}
.dshpw-input select,.dshpw-input.multi{height:auto;min-height:36px}
.dshpw-input[multiple]{height:auto;min-height:72px}
.dshpw-badge{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);margin-left:6px;white-space:nowrap}
.dshpw-badge.admin{border-color:var(--dsw-alias-label-warning,#f7ad31);color:var(--dsw-alias-label-warning,#f7ad31)}
.dshpw-error{color:var(--dsw-alias-label-error);font-size:12px}
.dshpw-ok{color:var(--dsw-alias-label-success,#22c55e);font-size:12px}
.dshpw-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dshpw-account-wrap{position:relative;width:100%}
.dshpw-account-trigger{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}
.dshpw-account-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshpw-account-trigger.rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}
.dshpw-account-icon{flex:none}
.dshpw-account-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpw-account-popover{position:fixed;z-index:2100;width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 40px rgba(0,0,0,.22)}
.dshpw-account-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
.dshpw-account-role{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshpw-account-warning{margin-top:10px;padding:8px;border-radius:8px;background:color-mix(in srgb,#f59e0b 14%,transparent);color:var(--dsw-alias-label-warning,#f59e0b);font-size:12px}
.dshpw-account-summary{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 10px;margin:12px 0;font-size:12px}
.dshpw-account-summary dt{color:var(--dsw-alias-label-tertiary)}
.dshpw-account-summary dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dshpw-account-summary dd.dshpw-account-workspace{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.dshpw-account-logout{width:100%;margin-top:12px;padding:8px;border:1px solid var(--dsw-alias-label-error,#ef4444);border-radius:8px;background:transparent;color:var(--dsw-alias-label-error,#ef4444);cursor:pointer}
.dshpw-account-logout:hover:not(:disabled){background:rgba(239,68,68,.1)}
.dshpw-account-logout:disabled{opacity:.5;cursor:default}
.dshpw-account-manage{width:100%;margin-top:12px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.dshpw-admin-overlay{position:fixed;inset:0;z-index:2200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)}
.dshpw-admin-panel{width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary)}
.dshpw-admin-head,.dshpw-admin-section-title,.dshpw-admin-user-head,.dshpw-directory-head,.dshpw-directory-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshpw-admin-section-toggle{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;padding:0;cursor:pointer;font:inherit;text-align:left}
.dshpw-admin-section-toggle h3{margin:0}.dshpw-admin-section-toggle span{color:var(--dsw-alias-label-tertiary);font-size:14px}
.dshpw-admin-user-list{max-height:min(52vh,560px);overflow:auto;padding:2px 4px 2px 0;display:flex;flex-direction:column;gap:9px}
.dshpw-admin-user-search{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1)}
.dshpw-admin-user-list .dshpw-admin-user{margin-top:0}
.dshpw-admin-user-toggle{appearance:none;min-width:0;flex:1;border:0;background:transparent;color:inherit;padding:0;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer;font:inherit}
.dshpw-admin-user-identity{min-width:0;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dshpw-admin-user-summary{max-width:360px;color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpw-admin-user-last-login{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.dshpw-admin-user-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshpw-admin-user-delete{appearance:none;flex:none;border:1px solid var(--dsw-alias-label-error,#ef4444);border-radius:8px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-error,#ef4444);font-size:13px;cursor:pointer}
.dshpw-admin-user-delete:hover:not(:disabled){background:rgba(239,68,68,.1)}
.dshpw-admin-user-delete:disabled{opacity:.4;cursor:default}
.dshpw-admin-user-details{padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:9px}
.dshpw-admin-user-workspace{overflow-wrap:anywhere;word-break:break-word}
.dshpw-admin-head h2,.dshpw-admin-section h3{margin:0}.dshpw-admin-head p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshpw-admin-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:24px;line-height:1;cursor:pointer}
.dshpw-admin-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:10px}
.dshpw-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.dshpw-directory-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.dshpw-admin-user{margin-top:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:9px;background:var(--dsw-alias-bg-layer-2)}
.dshpw-directory-picker{position:fixed;inset:8vh 8vw;z-index:2300;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:12px}
.dshpw-directory-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpw-directory-list{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.dshpw-directory-list button{padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshpw-tabs{display:flex;gap:22px;margin-top:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dshpw-tab{appearance:none;border:0;border-bottom:2px solid transparent;padding:9px 1px 11px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-weight:500;cursor:pointer}
.dshpw-tab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.dshpw-tab-panel{display:flex;flex-direction:column;gap:14px}
.dshpw-remote-panel{display:flex;flex-direction:column;gap:14px;padding-top:2px}
.dshpw-remote-status{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dshpw-remote-status.ready{background:color-mix(in srgb,var(--dsw-alias-label-success,#22c55e) 12%,transparent);color:var(--dsw-alias-label-primary)}
.dshpw-remote-dot{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dshpw-remote-status.ready .dshpw-remote-dot{background:var(--dsw-alias-label-success,#22c55e)}
.dshpw-remote-card{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:13px;background:var(--dsw-alias-bg-layer-2)}
.dshpw-remote-card-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.dshpw-remote-public-card .dshpw-remote-card-head{min-height:112px}
.dshpw-remote-card-head h3{margin:0;font-size:14px}.dshpw-remote-card-head p{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshpw-remote-badge{padding:4px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}
.dshpw-remote-badge.ready{background:color-mix(in srgb,var(--dsw-alias-label-success,#22c55e) 12%,transparent);color:var(--dsw-alias-label-success,#22c55e)}
.dshpw-remote-lan,.dshpw-remote-public{display:grid;grid-template-columns:112px minmax(0,1fr);gap:13px;align-items:center;margin-top:11px}
.dshpw-remote-qr{width:112px;height:112px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:#fff}.dshpw-remote-qr.small{width:112px;height:112px}
.dshpw-remote-copy{min-width:0}.dshpw-remote-copy>p{margin:0 0 8px}.dshpw-remote-url{display:flex;align-items:center;gap:8px;margin:8px 0}
.dshpw-remote-url code{min-width:0;flex:1;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dshpw-btn.ghost{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}
.dshpw-remote-switch{appearance:none;display:inline-block;flex:none;width:43px;height:25px;padding:3px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:999px;background:var(--dsw-alias-fill-tertiary,#d1d5db);cursor:pointer}.dshpw-remote-switch span{display:block;width:19px;height:19px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(0,0,0,.12);transition:transform .18s}.dshpw-remote-switch.on{background:var(--dsw-alias-brand-primary,#4f6ef7)}.dshpw-remote-switch.on span{transform:translateX(18px)}.dshpw-remote-switch:disabled{opacity:.5;cursor:default}
.dshpw-remote-empty{padding-top:12px}
@media(max-width:640px){.dshpw-admin-grid{grid-template-columns:1fr}.dshpw-directory-picker{inset:16px}.dshpw-admin-overlay{padding:10px}.dshpw-remote-lan,.dshpw-remote-public{grid-template-columns:1fr}.dshpw-remote-qr{margin:0 auto}.dshpw-remote-url{align-items:stretch;flex-direction:column}.dshpw-remote-card-head{align-items:flex-start}.dshpw-tabs{gap:16px}}
@media(max-width:640px){
  html,body,#root{max-width:100%;overflow-x:hidden}
  [class*="_sidebar"]{position:fixed!important;z-index:2050!important;top:0!important;bottom:0!important;left:0!important;max-width:min(86vw,320px)!important;transform:translateX(-105%);transition:transform .2s ease;background:var(--dsw-alias-bg-layer-1)!important;box-shadow:0 18px 48px rgba(0,0,0,.28)}
  html[data-dshpw-mobile-nav-open] [class*="_sidebar"]{transform:translateX(0)}
  [class*="_main"],[class*="_content"],[class*="_conversation"]{min-width:0!important;max-width:100%!important}
  [class*="_main"],[class*="_content"],[class*="_conversation"],[class*="_settings"]{padding-left:max(12px,env(safe-area-inset-left))!important;padding-right:max(12px,env(safe-area-inset-right))!important;padding-bottom:max(12px,env(safe-area-inset-bottom))!important}
  [class*="_composer"]{max-width:100%!important;padding-bottom:max(8px,env(safe-area-inset-bottom))!important}
  button,input,select,textarea{min-height:44px}
  .dshpw-mobile-toggle{position:fixed;z-index:2070;left:max(12px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));width:44px;height:44px;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.2);font-size:20px;cursor:pointer}
  .dshpw-mobile-backdrop{position:fixed;z-index:2040;inset:0;border:0;background:rgba(0,0,0,.38)}
}

`;

if (typeof document !== 'undefined') {
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

export const inject = ['slots', 'locale'] as const;

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        id: 'dsh-passwords',
        order: 55,
        locale: 'dshpw',
        inject: () => ({}),
      },
      DshPasswordsCard,
    ),
  );

  // 只有通过登录网关访问时才注册账号入口；3080 直连没有 /gateway/api/me，保持原生界面。
  // 3088 网关中的 Admin 与子用户都 shadow DSH 原生设置入口；3080 直连保持原生设置。
  ctx.effect(() => {
    let active = true;
    const disposers: Array<() => void> = [];
    void fetch('/gateway/api/me', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ me?: { role?: string } }>;
      })
      .then((data) => {
        const role = data?.me?.role;
        if (!active || (role !== 'admin' && role !== 'user')) return;
        const account = ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'dsh-passwords-account',
              order: 10_000,
              locale: 'dshpw',
              inject: () => ({}),
            },
            AccountMenu,
          ),
        );
        if (typeof account === 'function') disposers.push(account);
        const settings = ctx.slots.inject('sidebar.settings', () =>
          ctx.slots.register(
            { name: 'sidebar.settings', priority: -100 },
            () => null,
          ),
        );
        if (typeof settings === 'function') disposers.push(settings);
      })
      .catch(() => { /* 3080 直连或网关会话失效：不注册账号入口 */ });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
    };
  }, 'dsh-passwords: gateway account and role chrome');

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-passwords-mobile-nav', order: 95, locale: 'dshpw', inject: () => ({}) },
      MobileNavigation,
    ),
  );

  // 全局聊天入口：左下角圆形按钮 + 居中弹窗（shell.overlay 槽，root 作用域）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'dsh-passwords-chat',
        order: 100,
        locale: 'dshpw',
        inject: () => ({}),
      },
      ChatLauncher,
    ),
  );

  // 不可见 token 上报器：会话作用域（conversation.composer.dock 供应 useProjection），
  // 读取 dsh 的 tokenUsage 投影并把增量上报给密码门，用于子用户每小时 token 配额。
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'dsh-passwords-token', order: 90 },
      TokenReporter,
    ),
  );

  // 双语词典（zh/en）：卡片文字跟随 dsh 设置里的语言
  // （设置 → 通用 → 语言 / Settings → General → Language），切换即时生效
  ctx.effect(() => ctx.locale.register('dshpw', { zh, en }), 'dsh-passwords: dicts');
}
