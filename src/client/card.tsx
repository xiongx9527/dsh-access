// dsh-passwords 设置卡片：可折叠（与官方 PluginCard 同形态：header 按钮 +
// aria-expanded + 展开才渲染 body）。内容：
//   - 远程设置补丁：状态 + "重载补丁"按钮（任何登录用户可触发；补丁强制启用）
//   - 用户管理：改密/改名/子用户分配（主用户 admin 可管理所有，子用户只能改自己）
// 数据面：/api/dsh-passwords/*（网关注入的 JWT cookie 鉴权）。
//
// 语言：卡片词典注册在 locale 命名空间 'dshpw'（见 locales.ts），文字跟随
// dsh 设置里的语言（Settings → General → Language）。t seat 由注册时的
// `locale: 'dshpw'` 声明注入。
import { createElement as h, useEffect, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { RemoteAccessPanel } from './remote-access';

export function gatewaySaveViewState(refreshKey: number): { activeTab: 'remote'; refreshKey: number } {
  return { activeTab: 'remote', refreshKey: refreshKey + 1 };
}

export interface UserInfo {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login_at: string | null;
}

export interface StateData {
  me: { username: string; role: 'admin' | 'user' };
  users: UserInfo[];
}

export type CardIdentity =
  | { kind: 'local' }
  | { kind: 'loading' }
  | { kind: 'admin' | 'user'; username: string };

export function gatewayIdentityRouteAvailable(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('application/json') ?? false;
}

export function resolveCardIdentity(
  data: StateData | null,
  gatewayRouteAvailable: boolean | null,
): CardIdentity {
  if (data?.me?.role === 'admin') return { kind: 'admin', username: data.me.username };
  if (data?.me?.role === 'user') return { kind: 'user', username: data.me.username };
  if (gatewayRouteAvailable === false) return { kind: 'local' };
  return { kind: 'loading' };
}

export interface PatchState {
  settingsHostMode: boolean;
  whitelist: boolean;
}

export interface GatewayConfig {
  port: number;
  host: string;
  upstream: string;
}

export type PatchPresentation = 'unknown' | 'ok' | 'bad';

export function resolvePatchPresentation(
  _identity: CardIdentity,
  patchState: PatchState | null,
): PatchPresentation {
  if (patchState === null) return 'unknown';
  return patchState.settingsHostMode && patchState.whitelist ? 'ok' : 'bad';
}

export interface PermOverview {
  me: { id: number; username: string; role: 'admin' | 'user' };
  users: Array<{
    id: number;
    username: string;
    role: 'admin' | 'user';
    remark?: string;
    workspaceRoot?: string | null;
    permissions: {
      allowedFolders: string[];
      hourlyTokenLimit: number | null;
      dailyMinutesLimit: number | null;
      allowUpload: boolean;
      allowGitDownload: boolean;
      banned: boolean;
      sandboxMode: string | null;
    };
    usage: {
      day: string;
      activeSeconds: number;
      hourlyTokens: number;
      firstSeenAt: string | null;
      lastActiveAt: string | null;
    } | null;
  }>;
}

interface PermDraft {
  folders: string[];
  token: string;
  minutes: string;
  upload: boolean;
  git: boolean;
  banned: boolean;
  sandbox: string;
}

/** 与 host 侧一致的最小密码策略（本机提示用，最终以服务端校验为准） */
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

type ApiError = { error?: string; code?: string };

function api<T>(path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => {
    const data = (await res.json().catch(() => ({}))) as ApiError & T;
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      // 携带服务端稳定错误码：errText 优先按码本地化（跟随 dsh 语言）
      (err as Error & { code?: string }).code = data.code;
      throw err;
    }
    return data as T;
  });
}

/** 错误文案：有 code 走本地词典，未知 code / 无 code 回退服务端文案 */
function errText(error: unknown, tr: (key: string, params?: Record<string, string | number>) => string): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code) {
      const key = `err.${code}`;
      const localized = tr(key);
      if (localized !== key) return localized;
    }
    return error.message;
  }
  return tr('opFailed');
}

function Chevron(props: { open: boolean }) {
  return h(
    'svg',
    {
      className: 'dshpw-chevron' + (props.open ? ' open' : ''),
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M6 9l6 6 6-6',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );
}

export function DshPasswordsCard(props: PropsLocale<'dshpw'>) {
  const t = props.t;
  // 折叠状态（与官方 PluginCard 一致：默认收起，展开状态为卡片本地状态）
  const [open, setOpen] = useState(false);

  const [data, setData] = useState<StateData | null>(null);
  const [patchState, setPatchState] = useState<PatchState | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig | null>(null);
  const [gatewayPortDraft, setGatewayPortDraft] = useState('');
  const [gatewayRouteAvailable, setGatewayRouteAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'account' | 'remote'>('account');
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0);

  // 改密表单
  const [pwTarget, setPwTarget] = useState('');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  // 改名表单
  const [nameTarget, setNameTarget] = useState('');
  const [nameNew, setNameNew] = useState('');
  // 新增子用户表单
  const [addName, setAddName] = useState('');
  const [addPw, setAddPw] = useState('');
  // 权限管理（仅主用户）
  const [overview, setOverview] = useState<PermOverview | null>(null);
  const [permDrafts, setPermDrafts] = useState<Record<number, PermDraft>>({});
  const [expandedPermissionUserId, setExpandedPermissionUserId] = useState<number | null>(null);
  const [cardUserQuery, setCardUserQuery] = useState('');
  const [workspaces, setWorkspaces] = useState<Array<{ path: string; title: string }>>([]);

  const refresh = () => {
    fetch('/gateway/api/me', { headers: { accept: 'application/json' } })
      .then((response) => setGatewayRouteAvailable(
        gatewayIdentityRouteAvailable(response.headers.get('content-type')),
      ))
      .catch(() => setGatewayRouteAvailable(null));
    api<StateData>('/api/dsh-passwords/state')
      .then((d) => {
        setData(d);
        setError('');
        if (d.me?.role === 'admin') {
          api<GatewayConfig>('/api/dsh-passwords/gateway/config')
            .then((gateway) => {
              setGatewayConfig(gateway);
              setGatewayPortDraft(String(gateway.port));
            })
            .catch(() => setGatewayConfig(null));
          api<PermOverview>('/api/dsh-passwords/overview')
            .then((o) => {
              setOverview(o);
              const drafts: Record<number, PermDraft> = {};
              for (const u of o.users) {
                if (u.role === 'user') {
                  drafts[u.id] = {
                    folders: [...(u.permissions.allowedFolders ?? [])],
                    token: u.permissions.hourlyTokenLimit === null ? '' : String(u.permissions.hourlyTokenLimit),
                    minutes: u.permissions.dailyMinutesLimit === null ? '' : String(u.permissions.dailyMinutesLimit),
                    upload: u.permissions.allowUpload,
                    git: u.permissions.allowGitDownload,
                    banned: u.permissions.banned,
                    sandbox: u.permissions.sandboxMode ?? '',
                  };
                }
              }
              setPermDrafts(drafts);
              api<{ workspaces: Array<{ path: string; title: string }> }>('/api/dsh-passwords/workspaces')
                .then((r) => setWorkspaces(r.workspaces ?? []))
                .catch(() => setWorkspaces([]));
            })
            .catch(() => setOverview(null));
        }
      })
      .catch((e) => setError(errText(e, t)));
    api<{ status: PatchState | null }>('/api/dsh-passwords/patch/status')
      .then((r) => setPatchState(r.status))
      .catch(() => setPatchState(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  const identity = resolveCardIdentity(data, gatewayRouteAvailable);
  const isAdmin = identity.kind === 'admin';
  const me = identity.kind === 'admin' || identity.kind === 'user' ? identity.username : '';

  const run = async (fn: () => Promise<void>, okMessage: string, onError?: () => void) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMessage);
      refresh();
    } catch (e) {
      setError(errText(e, t));
      onError?.();
    } finally {
      setBusy(false);
    }
  };

  /** 重载补丁：任何登录用户可触发；网关重打补丁并重启 dsh 网页服务，页面稍后自动刷新 */
  const reloadPatch = () => {
    void run(async () => {
      await api('/api/dsh-passwords/patch/reload', {});
      // 给网关留出应用补丁 + 重启 dsh 的时间，再刷新页面拿到新代码
      window.setTimeout(() => {
        window.location.reload();
      }, 6000);
    }, t('reloading'));
  };

  const saveGatewayPort = () => {
    const port = Number(gatewayPortDraft);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('gatewayPortInvalid'));
      return;
    }
    void run(async () => {
      const updated = await api<GatewayConfig>('/api/dsh-passwords/gateway/config', { port: gatewayPortDraft });
      setGatewayConfig(updated);
      setGatewayPortDraft(String(updated.port));
      const view = gatewaySaveViewState(remoteRefreshKey);
      setActiveTab(view.activeTab);
      setRemoteRefreshKey(view.refreshKey);
    }, t('gatewayPortSaved', { port }), () => {
      const view = gatewaySaveViewState(remoteRefreshKey);
      setActiveTab(view.activeTab);
      setRemoteRefreshKey(view.refreshKey);
    });
  };

  const changePassword = () => {
    if (pwNew !== pwConfirm) return setError(t('pwMismatch'));
    if (!PASSWORD_RE.test(pwNew)) return setError(t('pwPolicy'));
    void run(
      () => api('/api/dsh-passwords/password', { target: pwTarget || me, currentPassword: pwCurrent, password: pwNew }),
      t('pwChanged'),
    );
  };

  const rename = () => {
    if (!USERNAME_RE.test(nameNew)) return setError(t('namePolicy'));
    void run(
      () => api('/api/dsh-passwords/username', { target: nameTarget || me, username: nameNew }),
      t('nameChanged'),
    );
  };

  const addSubUser = () => {
    if (!USERNAME_RE.test(addName)) return setError(t('namePolicy'));
    if (!PASSWORD_RE.test(addPw)) return setError(t('pwPolicy'));
    void run(() => api('/api/dsh-passwords/users', { username: addName, password: addPw }), t('subCreated'));
  };

  const removeUser = (username: string) => {
    if (!window.confirm(t('delConfirm', { username }))) return;
    void run(() => api('/api/dsh-passwords/users/remove', { target: username }), t('deleted'));
  };

  // 权限草稿更新 + 保存（仅主用户）
  const setDraft = (userId: number, patch: Partial<PermDraft>) => {
    setPermDrafts((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  };

  const savePermissions = (userId: number) => {
    const d = permDrafts[userId];
    if (!d) return;
    void run(
      () =>
        api('/api/dsh-passwords/permissions', {
          userId,
          allowedFolders: d.folders,
          hourlyTokenLimit: d.token.trim() === '' ? null : Number(d.token),
          dailyMinutesLimit: d.minutes.trim() === '' ? null : Number(d.minutes),
          allowUpload: d.upload,
          allowGitDownload: d.git,
          banned: d.banned,
          sandboxMode: d.sandbox === '' ? null : d.sandbox,
        }),
      t('permsSaved'),
    );
  };

  // 管理员的目标用户下拉：列出全部用户（默认自己，即当前账号在列表中的那一项）
  const targetSelect = (value: string, onChange: (v: string) => void) =>
    isAdmin
      ? h(
          'select',
          {
            className: 'dshpw-input',
            value: value || me,
            onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          },
          ...(data?.users ?? []).map((u) =>
            h(
              'option',
              { key: u.id, value: u.username },
              `${u.username}（${u.role === 'admin' ? t('owner') : t('subuser')}）`,
            ),
          ),
        )
      : null;

  const patchPresentation = resolvePatchPresentation(identity, patchState);
  const patchText =
    patchPresentation === 'unknown'
      ? t('patchUnknown')
      : patchPresentation === 'ok'
        ? t('patchOk')
        : t('patchBad');

  const cardUserNeedle = cardUserQuery.trim().toLocaleLowerCase();
  const visibleCardUsers = (data?.users ?? []).filter((user) => {
    if (cardUserNeedle === '') return true;
    const details = overview?.users.find((candidate) => candidate.id === user.id);
    return [user.username, details?.remark ?? '', details?.workspaceRoot ?? '']
      .some((value) => value.toLocaleLowerCase().includes(cardUserNeedle));
  });

  const header = h(
    'button',
    {
      type: 'button',
      className: 'dshpw-header',
      'aria-expanded': open,
      'aria-label': `${open ? t('collapse') : t('expand')}: dsh-passwords`,
      onClick: () => setOpen(!open),
    },
    h(
      'span',
      { className: 'dshpw-head' },
      h('span', { className: 'dshpw-title' }, t('title')),
      h(
        'span',
        { className: 'dshpw-desc' },
        t('desc'),
        h('strong', null, identity.kind === 'local' ? t('localDirect') : me || '—'),
        identity.kind === 'local'
          ? h('span', { className: 'dshpw-badge admin' }, t('fullAccess'))
          : identity.kind === 'admin'
            ? h('span', { className: 'dshpw-badge admin' }, t('owner'))
            : identity.kind === 'user'
              ? h('span', { className: 'dshpw-badge' }, t('subuser'))
              : null,
      ),
    ),
    h(Chevron, { open }),
  );

  const body = h(
    'div',
    { className: 'dshpw-body' },
    // ── 远程设置：状态 + 重载 ──
    h(
      'div',
      { className: 'dshpw-section' },
      h('span', { className: 'dshpw-label' }, t('patch')),
      h(
        'div',
        { className: 'dshpw-row' },
        h('span', { className: patchPresentation === 'ok' ? 'dshpw-ok' : 'dshpw-error' }, patchText),
        h('button', { className: 'dshpw-btn', disabled: busy, onClick: reloadPatch }, t('reloadPatch')),
      ),
      h('div', { className: 'dshpw-hint' }, t('patchHint1'), ' ', t('patchHint2')),
      isAdmin &&
        h(
          'div',
          { className: 'dshpw-gateway-port' },
          h('span', { className: 'dshpw-hint' }, t('gatewayPort')),
          h(
            'div',
            { className: 'dshpw-row' },
            h('input', {
              className: 'dshpw-input',
              type: 'number',
              min: 1,
              max: 65535,
              inputMode: 'numeric',
              'aria-label': t('gatewayPort'),
              value: gatewayPortDraft,
              onChange: (e: { target: { value: string } }) => setGatewayPortDraft(e.target.value),
            }),
            h(
              'button',
              {
                className: 'dshpw-btn',
                disabled: busy || gatewayPortDraft === '' || gatewayPortDraft === String(gatewayConfig?.port ?? ''),
                onClick: saveGatewayPort,
              },
              t('saveGatewayPort'),
            ),
          ),
          h('div', { className: 'dshpw-hint' }, t('gatewayPortHint', { port: gatewayConfig?.port ?? '—' })),
        ),
    ),

    h(
      'div',
      { className: 'dshpw-tabs', role: 'tablist', 'aria-label': t('settingsTabs') },
      h('button', {
        className: `dshpw-tab${activeTab === 'account' ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': activeTab === 'account',
        onClick: () => setActiveTab('account'),
      }, t('accountTab')),
      isAdmin && h('button', {
        className: `dshpw-tab${activeTab === 'remote' ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': activeTab === 'remote',
        onClick: () => setActiveTab('remote'),
      }, t('remoteTab')),
    ),

    activeTab === 'account' && h(
      'div',
      { className: 'dshpw-tab-panel', role: 'tabpanel' },
      // ── 修改密码 ──
      h(
      'div',
      { className: 'dshpw-section' },
      h('span', { className: 'dshpw-label' }, t('chgPw')),
      isAdmin && h('span', { className: 'dshpw-hint' }, t('targetUser')),
      targetSelect(pwTarget, setPwTarget),
      h('input', {
        className: 'dshpw-input',
        type: 'password',
        autoComplete: 'current-password',
        placeholder: t('currentPwPh'),
        value: pwCurrent,
        onChange: (e: { target: { value: string } }) => setPwCurrent(e.target.value),
      }),
      h('input', {
        className: 'dshpw-input',
        type: 'password',
        autoComplete: 'new-password',
        placeholder: t('newPwPh'),
        value: pwNew,
        onChange: (e: { target: { value: string } }) => setPwNew(e.target.value),
      }),
      h('input', {
        className: 'dshpw-input',
        type: 'password',
        autoComplete: 'new-password',
        placeholder: t('confirmPwPh'),
        value: pwConfirm,
        onChange: (e: { target: { value: string } }) => setPwConfirm(e.target.value),
      }),
      h(
        'div',
        { className: 'dshpw-row' },
        h('button', { className: 'dshpw-btn', disabled: busy, onClick: changePassword }, t('savePw')),
      ),
    ),

    // ── 修改用户名 ──
    h(
      'div',
      { className: 'dshpw-section' },
      h('span', { className: 'dshpw-label' }, t('chgName')),
      isAdmin && h('span', { className: 'dshpw-hint' }, t('targetUser')),
      targetSelect(nameTarget, setNameTarget),
      h('input', {
        className: 'dshpw-input',
        placeholder: t('newNamePh'),
        value: nameNew,
        onChange: (e: { target: { value: string } }) => setNameNew(e.target.value),
      }),
      h(
        'div',
        { className: 'dshpw-row' },
        h('button', { className: 'dshpw-btn', disabled: busy, onClick: rename }, t('saveName')),
      ),
      h('div', { className: 'dshpw-hint' }, t('nameHint')),
    ),

    // ── 子用户管理与权限（仅主用户，点击用户行展开） ──
    isAdmin &&
      h(
        'div',
        { className: 'dshpw-section' },
        h('span', { className: 'dshpw-label' }, t('subusers')),
        h('input', {
          className: 'dshpw-input dshpw-card-user-search',
          value: cardUserQuery,
          placeholder: t('accountSearchUsers'),
          onChange: (e: { target: { value: string } }) => setCardUserQuery(e.target.value),
        }),
        ...visibleCardUsers.map((u) => {
          const permissionUser = overview?.users.find((candidate) => candidate.id === u.id);
          const d = permDrafts[u.id];
          const expanded = u.role === 'user' && expandedPermissionUserId === u.id;
          const identity = h(
            'span',
            { className: 'dshpw-user-identity' },
            u.username,
            u.role === 'admin'
              ? h('span', { className: 'dshpw-badge admin' }, t('owner'))
              : h('span', { className: 'dshpw-badge' }, t('subuser')),
            u.last_login_at ? h('span', { className: 'dshpw-hint' }, t('lastLogin', { time: u.last_login_at })) : null,
          );
          return h(
            'div',
            { className: 'dshpw-user-block', key: u.id },
            h(
              'div',
              { className: 'dshpw-user' },
              u.role === 'user'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshpw-user-toggle',
                      'aria-expanded': expandedPermissionUserId === u.id,
                      onClick: () => setExpandedPermissionUserId((current) => current === u.id ? null : u.id),
                    },
                    identity,
                    h('span', { className: 'dshpw-user-chevron', 'aria-hidden': 'true' }, expanded ? '▴' : '▾'),
                  )
                : identity,
              u.username !== me
                ? h('button', { className: 'dshpw-btn danger', disabled: busy, onClick: () => removeUser(u.username) }, t('remove'))
                : null,
            ),
            expanded
              ? permissionUser && d
                ? h(
                    'div',
                    { className: 'dshpw-perm dshpw-user-permission-editor' },
                    h('div', { className: 'dshpw-hint' }, t('permsHint')),
                    h(
                      'div',
                      { className: 'dshpw-perm-head' },
                      permissionUser.usage
                        ? h(
                            'span',
                            { className: 'dshpw-hint' },
                            `${t('usageTime')} ${Math.round(permissionUser.usage.activeSeconds / 60)}m · ${t('usageTokens')} ${permissionUser.usage.hourlyTokens}`,
                          )
                        : null,
                      permissionUser.permissions.banned ? h('span', { className: 'dshpw-badge' }, t('banned')) : null,
                    ),
                    h(
                      'select',
                      {
                        className: 'dshpw-input',
                        value: d.folders[0] ?? '',
                        'aria-label': t('permsFolders'),
                        onChange: (e: { target: { value: string } }) =>
                          setDraft(u.id, { folders: e.target.value === '' ? [] : [e.target.value] }),
                      },
                      h('option', { value: '' }, t('permsAll')),
                      ...((() => {
                        const paths = Array.from(new Set([...workspaces.map((workspace) => workspace.path), ...d.folders]));
                        return paths.map((workspacePath) => {
                          const workspace = workspaces.find((candidate) => candidate.path === workspacePath);
                          return h('option', { key: workspacePath, value: workspacePath }, workspace?.title || workspacePath);
                        });
                      })()),
                    ),
                    h(
                      'select',
                      {
                        className: 'dshpw-input',
                        value: d.sandbox,
                        'aria-label': t('permsSandbox'),
                        onChange: (e: { target: { value: string } }) => setDraft(u.id, { sandbox: e.target.value }),
                      },
                      h('option', { value: '' }, t('sandboxNone')),
                      h('option', { value: 'read-only' }, t('sandboxReadOnly')),
                      h('option', { value: 'workspace-write' }, t('sandboxWorkspace')),
                      h('option', { value: 'danger-full-access' }, t('sandboxFull')),
                    ),
                    h(
                      'div',
                      { className: 'dshpw-row' },
                      h('label', { className: 'dshpw-limit-field' },
                        h('span', { className: 'dshpw-limit-label' }, t('permsToken')),
                        h('input', {
                          className: 'dshpw-input',
                          type: 'number',
                          min: 0,
                          placeholder: t('permsToken'),
                          value: d.token,
                          onChange: (e: { target: { value: string } }) => setDraft(u.id, { token: e.target.value }),
                        }),
                      ),
                      h('label', { className: 'dshpw-limit-field' },
                        h('span', { className: 'dshpw-limit-label' }, t('permsMinutes')),
                        h('input', {
                          className: 'dshpw-input',
                          type: 'number',
                          min: 0,
                          placeholder: t('permsMinutes'),
                          value: d.minutes,
                          onChange: (e: { target: { value: string } }) => setDraft(u.id, { minutes: e.target.value }),
                        }),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dshpw-row' },
                      h('label', { className: 'dshpw-check' },
                        h('input', { type: 'checkbox', checked: d.upload, onChange: (e: { target: { checked: boolean } }) => setDraft(u.id, { upload: e.target.checked }) }),
                        t('permsUpload'),
                      ),
                      h('label', { className: 'dshpw-check' },
                        h('input', { type: 'checkbox', checked: d.git, onChange: (e: { target: { checked: boolean } }) => setDraft(u.id, { git: e.target.checked }) }),
                        t('permsGit'),
                      ),
                      h('label', { className: 'dshpw-check' },
                        h('input', { type: 'checkbox', checked: d.banned, onChange: (e: { target: { checked: boolean } }) => setDraft(u.id, { banned: e.target.checked }) }),
                        t('permsBanned'),
                      ),
                    ),
                    h('div', { className: 'dshpw-row' },
                      h('button', { className: 'dshpw-btn', disabled: busy, onClick: () => savePermissions(u.id) }, t('permsSave')),
                    ),
                  )
                : h('div', { className: 'dshpw-hint dshpw-user-permission-editor' }, t('accountLoading'))
              : null,
          );
        }),
        h('input', {
          className: 'dshpw-input',
          placeholder: t('subNamePh'),
          value: addName,
          onChange: (e: { target: { value: string } }) => setAddName(e.target.value),
        }),
        h('input', {
          className: 'dshpw-input',
          type: 'password',
          autoComplete: 'new-password',
          placeholder: t('subPwPh'),
          value: addPw,
          onChange: (e: { target: { value: string } }) => setAddPw(e.target.value),
        }),
        h('div', { className: 'dshpw-row' },
          h('button', { className: 'dshpw-btn', disabled: busy, onClick: addSubUser }, t('addSub')),
        ),
        h('div', { className: 'dshpw-hint' }, t('subHint')),
      ),
    ),

    activeTab === 'remote' && isAdmin && h(RemoteAccessPanel, { t, refreshKey: remoteRefreshKey }),

    error && h('div', { className: 'dshpw-error' }, error),
    notice && h('div', { className: 'dshpw-ok' }, notice),
  );

  return h('div', { className: 'dshpw-card' + (open ? ' open' : '') }, header, open ? body : null);
}
