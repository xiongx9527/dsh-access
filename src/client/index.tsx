// dsh 浏览器侧插件：在设置页"插件"列表里注册 dsh-access 卡片。
// 卡片内容：
//   - 远程设置补丁状态 + "重载补丁"按钮（任何登录用户可触发；补丁强制启用）
//   - 用户管理（改密/改名/子用户） → fetch /api/dsh-access/*（网关
//     JWT cookie 鉴权）
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { AccessManagementSection } from './card';
import { ChatLauncher } from './chat';
import { TokenReporter } from './token';
import { AccountMenu } from './account';
import { MobileNavigation } from './mobile';
import { zh, en } from './locales';

/** 卡片样式：全部使用 dsh 设计令牌（--dsw-alias-*），颜色/主题与官方 PluginCard 完全一致 */
const CSS = `
.dsh-access-access-nav-icon{width:16px;height:16px;display:block;flex:none;color:currentColor}
.dsh-access-card{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;font-size:13px;line-height:1.5;overflow:hidden}
.dsh-access-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-access-card.open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-access-header{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;background:none;border:0;border-radius:12px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dsh-access-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-access-head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-access-title{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-access-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-access-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-access-chevron.open{transform:rotate(180deg)}
.dsh-access-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 14px;display:flex;flex-direction:column;gap:14px}
.dsh-access-section{display:flex;flex-direction:column;gap:8px}
.dsh-access-label{display:block;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsh-access-input{width:100%;box-sizing:border-box;min-width:0;padding:7px 10px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;transition:border-color .15s,box-shadow .15s}
.dsh-access-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.dsh-access-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-access-btn{appearance:none;border:0;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;font-weight:500;background:var(--dsw-alias-brand-primary);color:#fff;cursor:pointer}
.dsh-access-btn:hover:not(:disabled){filter:brightness(1.1)}
.dsh-access-btn:disabled{opacity:.4;cursor:default}
.dsh-access-btn.danger{background:none;border:1px solid var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
.dsh-access-btn.danger:hover:not(:disabled){filter:none;background:color-mix(in srgb,var(--dsw-alias-label-error) 10%,transparent)}
.dsh-access-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-access-gateway-port{display:grid;gap:6px;margin-top:10px}.dsh-access-gateway-port .dsh-access-input{width:auto;flex:1 1 160px}
.dsh-access-limit-field{min-width:0;flex:1 1 220px;display:flex;flex-direction:column;gap:5px}
.dsh-access-limit-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);line-height:1.4}
.dsh-access-user-block{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-access-user{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0}
.dsh-access-user-toggle{appearance:none;min-width:0;flex:1;border:0;background:transparent;color:inherit;padding:0;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer;font:inherit}
.dsh-access-user-identity{min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-access-user-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-access-card-user-search{margin-bottom:2px}
.dsh-access-perm{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.dsh-access-user-permission-editor{margin:0 0 10px 0}
.dsh-access-perm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-access-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-access-check input{accent-color:var(--dsw-alias-brand-primary)}
.dsh-access-input select,.dsh-access-input.multi{height:auto;min-height:36px}
.dsh-access-input[multiple]{height:auto;min-height:72px}
.dsh-access-badge{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);margin-left:6px;white-space:nowrap}
.dsh-access-badge.admin{border-color:var(--dsw-alias-label-warning,#f7ad31);color:var(--dsw-alias-label-warning,#f7ad31)}
.dsh-access-error{color:var(--dsw-alias-label-error);font-size:12px}
.dsh-access-ok{color:var(--dsw-alias-label-success,#22c55e);font-size:12px}
.dsh-access-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-access-account-wrap{position:relative;width:100%}
.dsh-access-account-trigger{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}
.dsh-access-account-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-access-account-trigger.rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}
.dsh-access-account-icon{flex:none}
.dsh-access-account-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-access-account-popover{position:fixed;z-index:2100;width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 40px rgba(0,0,0,.22)}
.dsh-access-account-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
.dsh-access-account-role{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-access-account-warning{margin-top:10px;padding:8px;border-radius:8px;background:color-mix(in srgb,#f59e0b 14%,transparent);color:var(--dsw-alias-label-warning,#f59e0b);font-size:12px}
.dsh-access-account-summary{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 10px;margin:12px 0;font-size:12px}
.dsh-access-account-summary dt{color:var(--dsw-alias-label-tertiary)}
.dsh-access-account-summary dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dsh-access-account-summary dd.dsh-access-account-workspace{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.dsh-access-account-logout{width:100%;margin-top:12px;padding:8px;border:1px solid var(--dsw-alias-label-error,#ef4444);border-radius:8px;background:transparent;color:var(--dsw-alias-label-error,#ef4444);cursor:pointer}
.dsh-access-account-logout:hover:not(:disabled){background:rgba(239,68,68,.1)}
.dsh-access-account-logout:disabled{opacity:.5;cursor:default}
.dsh-access-account-manage{width:100%;margin-top:12px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-access-admin-overlay{position:fixed;inset:0;z-index:2200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)}
.dsh-access-admin-panel{width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary)}
.dsh-access-admin-head,.dsh-access-admin-section-title,.dsh-access-admin-user-head,.dsh-access-directory-head,.dsh-access-directory-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-access-admin-section-toggle{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;padding:0;cursor:pointer;font:inherit;text-align:left}
.dsh-access-admin-section-toggle h3{margin:0}.dsh-access-admin-section-toggle span{color:var(--dsw-alias-label-tertiary);font-size:14px}
.dsh-access-admin-user-list{max-height:min(52vh,560px);overflow:auto;padding:2px 4px 2px 0;display:flex;flex-direction:column;gap:9px}
.dsh-access-admin-user-search{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1)}
.dsh-access-admin-user-list .dsh-access-admin-user{margin-top:0}
.dsh-access-admin-user-toggle{appearance:none;min-width:0;flex:1;border:0;background:transparent;color:inherit;padding:0;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer;font:inherit}
.dsh-access-admin-user-identity{min-width:0;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dsh-access-admin-user-summary{max-width:360px;color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-access-admin-user-last-login{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.dsh-access-admin-user-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-access-admin-user-delete{appearance:none;flex:none;border:1px solid var(--dsw-alias-label-error,#ef4444);border-radius:8px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-error,#ef4444);font-size:13px;cursor:pointer}
.dsh-access-admin-user-delete:hover:not(:disabled){background:rgba(239,68,68,.1)}
.dsh-access-admin-user-delete:disabled{opacity:.4;cursor:default}
.dsh-access-admin-user-details{padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:9px}
.dsh-access-admin-user-workspace{overflow-wrap:anywhere;word-break:break-word}
.dsh-access-admin-head h2,.dsh-access-admin-section h3{margin:0}.dsh-access-admin-head p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-access-admin-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:24px;line-height:1;cursor:pointer}
.dsh-access-admin-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:10px}
.dsh-access-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.dsh-access-directory-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.dsh-access-admin-user{margin-top:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-access-directory-picker{position:fixed;inset:8vh 8vw;z-index:2300;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:12px}
.dsh-access-directory-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-access-directory-list{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.dsh-access-directory-list button{padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-access-tabs{display:flex;gap:22px;margin-top:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-access-tab{appearance:none;border:0;border-bottom:2px solid transparent;padding:9px 1px 11px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-weight:500;cursor:pointer}
.dsh-access-tab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.dsh-access-tab-panel{display:flex;flex-direction:column;gap:14px}
.dsh-access-remote-panel{display:flex;flex-direction:column;gap:14px;padding-top:2px}
.dsh-access-remote-status{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-access-remote-status.ready{background:color-mix(in srgb,var(--dsw-alias-label-success,#22c55e) 12%,transparent);color:var(--dsw-alias-label-primary)}
.dsh-access-remote-dot{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dsh-access-remote-status.ready .dsh-access-remote-dot{background:var(--dsw-alias-label-success,#22c55e)}
.dsh-access-remote-card{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:13px;background:var(--dsw-alias-bg-layer-2)}
.dsh-access-remote-card-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.dsh-access-remote-public-card .dsh-access-remote-card-head{min-height:64px}
.dsh-access-remote-card-head h3{margin:0;font-size:14px}.dsh-access-remote-card-head p{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-access-remote-badge{padding:4px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}
.dsh-access-remote-badge.ready{background:color-mix(in srgb,var(--dsw-alias-label-success,#22c55e) 12%,transparent);color:var(--dsw-alias-label-success,#22c55e)}
.dsh-access-remote-lan,.dsh-access-remote-public{display:grid;grid-template-columns:112px minmax(0,1fr);gap:24px;align-items:center;margin-top:11px}
.dsh-access-remote-qr{width:112px;height:112px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:#fff}.dsh-access-remote-qr-placeholder{width:112px;height:112px;display:grid;place-items:center;padding:8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}.dsh-access-remote-qr.small{width:112px;height:112px}
.dsh-access-remote-copy{min-width:0}.dsh-access-remote-copy>p{margin:0 0 8px}.dsh-access-remote-url{display:flex;align-items:center;gap:8px;margin:8px 0}
.dsh-access-remote-url code{min-width:0;flex:1;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dsh-access-btn.ghost{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}
.dsh-access-remote-switch{appearance:none;display:flex;align-items:center;justify-content:flex-start;flex:none;box-sizing:border-box;width:43px;height:25px;padding:3px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:999px;background:var(--dsw-alias-fill-tertiary,#d1d5db);cursor:pointer}.dsh-access-remote-switch span{display:block;box-sizing:border-box;flex:none;width:19px;height:19px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(0,0,0,.12);transition:transform .18s}.dsh-access-remote-switch.on{background:var(--dsw-alias-brand-primary,#4f6ef7)}.dsh-access-remote-switch.on span{transform:translateX(16px)}.dsh-access-remote-switch:disabled{opacity:.5;cursor:default}
.dsh-access-remote-empty{padding-top:12px}
@media(max-width:640px){.dsh-access-admin-grid{grid-template-columns:1fr}.dsh-access-directory-picker{inset:16px}.dsh-access-admin-overlay{padding:10px}.dsh-access-remote-lan,.dsh-access-remote-public{grid-template-columns:1fr}.dsh-access-remote-qr,.dsh-access-remote-qr-placeholder{margin:0 auto}.dsh-access-remote-url{align-items:stretch;flex-direction:column}.dsh-access-remote-card-head{align-items:flex-start}.dsh-access-tabs{gap:16px}}
@media(max-width:640px){
  html,body,#root{max-width:100%;overflow-x:hidden}
  [class*="_sidebar"]{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;position:fixed!important;z-index:2050!important;top:0!important;bottom:0!important;left:0!important;max-width:min(86vw,320px)!important;transform:translateX(-105%);transition:transform .2s ease;background:var(--dsw-alias-bg-layer-1)!important;box-shadow:0 18px 48px rgba(0,0,0,.28)}
  html[data-dsh-access-mobile-nav-open] [class*="_sidebar"]{transform:translateX(0)}
  [class*="_main"],[class*="_content"],[class*="_conversation"]{min-width:0!important;max-width:100%!important}
  [class*="_main"],[class*="_content"],[class*="_conversation"],[class*="_settings"]{padding-left:max(12px,env(safe-area-inset-left))!important;padding-right:max(12px,env(safe-area-inset-right))!important;padding-bottom:max(12px,env(safe-area-inset-bottom))!important}
  [class*="_composer"]{max-width:100%!important;padding-bottom:max(8px,env(safe-area-inset-bottom))!important}
  button,input,select,textarea{min-height:44px;touch-action:manipulation}
  .dsh-access-mobile-toggle{position:fixed;z-index:2070;left:max(12px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));width:44px;height:44px;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.2);font-size:20px;cursor:pointer}
  .dsh-access-mobile-backdrop{position:fixed;z-index:2040;inset:0;border:0;background:rgba(0,0,0,.38)}
}

`;

if (typeof document !== 'undefined') {
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

export const inject = ['slots', 'locale'] as const;

export function isAccessManagementLabel(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized === '访问管理' || normalized === 'Access management';
}

function installAccessManagementIcon(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const patched = new Map<HTMLElement, { icon: SVGElement; display: string; custom: HTMLElement }>();
  const apply = () => {
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (!(button instanceof HTMLElement) || !isAccessManagementLabel(button.textContent ?? '') || patched.has(button)) continue;
      const icon = button.querySelector('svg');
      if (!(icon instanceof SVGElement)) continue;
      const custom = document.createElement('span');
      custom.className = 'dsh-access-access-nav-icon';
      custom.setAttribute('aria-hidden', 'true');
      custom.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5 13 3v4.1c0 3.1-2 5.8-5 7.4-3-1.6-5-4.3-5-7.4V3l5-1.5Z"/><path d="m5.5 8 1.6 1.6L10.7 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const display = icon.style.display;
      icon.style.display = 'none';
      button.insertBefore(custom, icon);
      patched.set(button, { icon, display, custom });
    }
  };
  apply();
  const observer = new MutationObserver(apply);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const { icon, display, custom } of patched.values()) {
      icon.style.display = display;
      custom.remove();
    }
    patched.clear();
  };
}

export function apply(ctx: ClientContext): void {
  // 独立设置一级入口：不再出现在“插件配置”列表中。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-access',
        key: 'dsh-access',
        order: 10,
        label: () => '访问管理',
        locale: 'dshaccess',
        inject: () => ({}),
      },
      AccessManagementSection,
    ),
  );

  ctx.effect(() => installAccessManagementIcon(), 'dsh-access: access navigation icon');

  // 只有通过登录网关访问时才注册账号入口；3080 直连没有 /gateway/api/me，保持原生界面。
  // 3088 网关中的子用户 shadow DSH 原生设置入口；Admin 保持原生设置可见；3080 直连保持原生设置。
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
              id: 'dsh-access-account',
              key: 'dsh-access-account',
              order: 10_000,
              locale: 'dshaccess',
              inject: () => ({}),
            },
            AccountMenu,
          ),
        );
        if (typeof account === 'function') disposers.push(account);
        if (role === 'user') {
          const settings = ctx.slots.inject('sidebar.settings', () =>
            ctx.slots.register(
              { name: 'sidebar.settings', priority: -100 },
              () => null,
            ),
          );
          if (typeof settings === 'function') disposers.push(settings);
        }
      })
      .catch(() => { /* 3080 直连或网关会话失效：不注册账号入口 */ });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
    };
  }, 'dsh-access: gateway account and role chrome');

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-access-mobile-nav', key: 'dsh-access-mobile-nav', order: 95, locale: 'dshaccess', inject: () => ({}) },
      MobileNavigation,
    ),
  );

  // 全局聊天入口：左下角圆形按钮 + 居中弹窗（shell.overlay 槽，root 作用域）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'dsh-access-chat',
        key: 'dsh-access-chat',
        order: 100,
        locale: 'dshaccess',
        inject: () => ({}),
      },
      ChatLauncher,
    ),
  );

  // 不可见 token 上报器：会话作用域（conversation.composer.dock 供应 useProjection），
  // 读取 dsh 的 tokenUsage 投影并把增量上报给访问管理，用于子用户每小时 token 配额。
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'dsh-access-token', key: 'dsh-access-token', order: 90 },
      TokenReporter,
    ),
  );

  // 双语词典（zh/en）：卡片文字跟随 dsh 设置里的语言
  // （设置 → 通用 → 语言 / Settings → General → Language），切换即时生效
  ctx.effect(() => ctx.locale.register('dshaccess', { zh, en }), 'dsh-access: dicts');
}
