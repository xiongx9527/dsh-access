import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import {
  accountPopoverPosition,
  createAccountPayload,
  filterManagedUsers,
  permissionPayload,
  type AccountForm,
  type ManagedUser,
} from './account-model';

interface CurrentAccount {
  id: number;
  username: string;
  role: 'admin' | 'user';
  workspaceMode?: 'username' | 'specified' | 'repair-required';
  workspaceRoot?: string | null;
  sandboxMode?: string | null;
  allowUpload?: boolean;
  allowGitDownload?: boolean;
  hourlyTokenLimit?: number | null;
  dailyMinutesLimit?: number | null;
}

interface MeResponse {
  ok: boolean;
  me: CurrentAccount;
}

interface OverviewResponse {
  ok: boolean;
  users: ManagedUser[];
}

interface DirectoryResponse {
  ok: boolean;
  current: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
}

interface UserDraft {
  remark: string;
  banned: boolean;
  allowUpload: boolean;
  allowGitDownload: boolean;
  sandboxMode: string;
  hourlyTokenLimit: string;
  dailyMinutesLimit: string;
  workspaceMode: 'username' | 'specified';
  workspaceRoot: string;
}

const EMPTY_FORM: AccountForm = {
  username: '',
  password: '',
  workspaceMode: 'username',
  workspaceRoot: '',
  remark: '',
  sandboxMode: 'workspace-write',
  allowUpload: false,
  allowGitDownload: false,
};

async function api<T>(pathname: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(pathname, options);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function draftOf(user: ManagedUser): UserDraft {
  return {
    remark: user.remark,
    banned: user.permissions.banned,
    allowUpload: user.permissions.allowUpload,
    allowGitDownload: user.permissions.allowGitDownload,
    sandboxMode: user.permissions.sandboxMode ?? 'read-only',
    hourlyTokenLimit: user.permissions.hourlyTokenLimit === null ? '' : String(user.permissions.hourlyTokenLimit),
    dailyMinutesLimit: user.permissions.dailyMinutesLimit === null ? '' : String(user.permissions.dailyMinutesLimit),
    workspaceMode: user.workspaceMode === 'username' ? 'username' : 'specified',
    workspaceRoot: user.workspaceRoot ?? '',
  };
}

function AdminAccountCenter(props: { close: () => void } & PropsLocale<'dshaccess'>) {
  const { close, t } = props;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [drafts, setDrafts] = useState<Record<number, UserDraft>>({});
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [userQuery, setUserQuery] = useState('');
  const [expandedManagedUserId, setExpandedManagedUserId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<DirectoryResponse | null>(null);
  const [pickerTarget, setPickerTarget] = useState<{ kind: 'create' } | { kind: 'user'; userId: number }>({ kind: 'create' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<OverviewResponse>('/gateway/api/overview');
      setUsers(data.users);
      setDrafts(Object.fromEntries(data.users.map((user) => [user.id, draftOf(user)])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('opFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateDraft = (userId: number, patch: Partial<UserDraft>) => {
    setDrafts((current) => ({ ...current, [userId]: { ...current[userId], ...patch } }));
  };

  const saveUser = async (user: ManagedUser) => {
    const draft = drafts[user.id];
    if (!draft) return;
    setBusy(`save:${user.id}`);
    setError('');
    setNotice('');
    try {
      await api('/gateway/api/permissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(permissionPayload(user, {
          remark: draft.remark,
          banned: draft.banned,
          allowUpload: draft.allowUpload,
          allowGitDownload: draft.allowGitDownload,
          sandboxMode: draft.sandboxMode,
          hourlyTokenLimit: nullableNumber(draft.hourlyTokenLimit),
          dailyMinutesLimit: nullableNumber(draft.dailyMinutesLimit),
          workspaceMode: draft.workspaceMode,
          workspaceRoot: draft.workspaceRoot,
        })),
      });
      setNotice(t('permsSaved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('opFailed'));
    } finally {
      setBusy('');
    }
  };

  const removeUser = async (user: ManagedUser) => {
    if (!window.confirm(t('delConfirm', { username: user.username }))) return;
    setBusy(`delete:${user.id}`);
    setError('');
    try {
      await api(`/gateway/api/users/${user.id}`, { method: 'DELETE' });
      setNotice(t('deleted'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('opFailed'));
    } finally {
      setBusy('');
    }
  };

  const createUser = async () => {
    setBusy('create');
    setError('');
    setNotice('');
    try {
      const payload = createAccountPayload(form);
      await api('/gateway/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setForm(EMPTY_FORM);
      setNotice(t('subCreated'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('opFailed'));
    } finally {
      setBusy('');
    }
  };

  const browse = async (requested?: string, target?: { kind: 'create' } | { kind: 'user'; userId: number }) => {
    setBusy('browse');
    setError('');
    try {
      if (target) setPickerTarget(target);
      const query = requested && requested.trim() !== '' ? `?path=${encodeURIComponent(requested)}` : '';
      setPicker(await api<DirectoryResponse>(`/gateway/api/directories${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('opFailed'));
    } finally {
      setBusy('');
    }
  };

  const visibleUsers = filterManagedUsers(users, userQuery);

  return createPortal(h(
    'div',
    { className: 'dsh-access-admin-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('accountManage') },
    h(
      'div',
      { className: 'dsh-access-admin-panel' },
      h(
        'div',
        { className: 'dsh-access-admin-head' },
        h('div', null, h('h2', null, t('accountManage')), h('p', null, t('accountManageHint'))),
        h('button', { type: 'button', className: 'dsh-access-admin-close', onClick: close, 'aria-label': t('chat.close') }, '×'),
      ),
      window.location.protocol === 'http:' ? h('div', { className: 'dsh-access-account-warning' }, t('httpWarning')) : null,
      error ? h('div', { className: 'dsh-access-error' }, error) : null,
      notice ? h('div', { className: 'dsh-access-ok' }, notice) : null,
      h(
        'section',
        { className: 'dsh-access-admin-section' },
        h('h3', null, t('addSub')),
        h(
          'div',
          { className: 'dsh-access-admin-grid' },
          h('input', { className: 'dsh-access-input', value: form.username, placeholder: t('subNamePh'), onChange: (e: Event) => setForm({ ...form, username: (e.target as HTMLInputElement).value }) }),
          h('input', { className: 'dsh-access-input', type: 'password', value: form.password, placeholder: t('subPwPh'), onChange: (e: Event) => setForm({ ...form, password: (e.target as HTMLInputElement).value }) }),
          h(
            'select',
            { className: 'dsh-access-input', value: form.workspaceMode, onChange: (e: Event) => setForm({ ...form, workspaceMode: (e.target as HTMLSelectElement).value as AccountForm['workspaceMode'] }) },
            h('option', { value: 'username' }, t('workspaceByUsername')),
            h('option', { value: 'specified' }, t('workspaceSpecified')),
          ),
          h('input', { className: 'dsh-access-input', value: form.remark, placeholder: t('accountRemark'), onChange: (e: Event) => setForm({ ...form, remark: (e.target as HTMLInputElement).value }) }),
        ),
        form.workspaceMode === 'specified'
          ? h(
              'div',
              { className: 'dsh-access-directory-row' },
              h('input', { className: 'dsh-access-input', value: form.workspaceRoot, placeholder: t('workspaceDirectory'), onChange: (e: Event) => setForm({ ...form, workspaceRoot: (e.target as HTMLInputElement).value }) }),
              h('button', { type: 'button', className: 'dsh-access-btn', disabled: busy === 'browse', onClick: () => void browse(form.workspaceRoot, { kind: 'create' }) }, t('chooseDirectory')),
            )
          : h('div', { className: 'dsh-access-hint' }, t('workspaceUsernameHint')),
        h(
          'select',
          { className: 'dsh-access-input', value: form.sandboxMode, onChange: (e: Event) => setForm({ ...form, sandboxMode: (e.target as HTMLSelectElement).value as AccountForm['sandboxMode'] }) },
          h('option', { value: 'read-only' }, t('sandboxReadOnly')),
          h('option', { value: 'workspace-write' }, t('sandboxWorkspace')),
          h('option', { value: 'danger-full-access' }, t('sandboxFull')),
        ),
        h('div', { className: 'dsh-access-row' },
          h('label', { className: 'dsh-access-check' }, h('input', { type: 'checkbox', checked: form.allowUpload, onChange: (e: Event) => setForm({ ...form, allowUpload: (e.target as HTMLInputElement).checked }) }), t('permsUpload')),
          h('label', { className: 'dsh-access-check' }, h('input', { type: 'checkbox', checked: form.allowGitDownload, onChange: (e: Event) => setForm({ ...form, allowGitDownload: (e.target as HTMLInputElement).checked }) }), t('permsGit')),
        ),
        h('button', { type: 'button', className: 'dsh-access-btn', disabled: busy === 'create', onClick: () => void createUser() }, busy === 'create' ? t('accountSaving') : t('addSub')),
      ),
      picker
        ? h(
            'div',
            { className: 'dsh-access-directory-picker' },
            h('div', { className: 'dsh-access-directory-head' },
              h('strong', { title: picker.current }, picker.current),
              h('button', { type: 'button', className: 'dsh-access-admin-close', onClick: () => setPicker(null) }, '×'),
            ),
            h('div', { className: 'dsh-access-directory-actions' },
              picker.parent ? h('button', { type: 'button', className: 'dsh-access-btn', onClick: () => void browse(picker.parent!) }, t('parentDirectory')) : null,
              h('button', { type: 'button', className: 'dsh-access-btn', onClick: () => {
                if (pickerTarget.kind === 'create') setForm({ ...form, workspaceRoot: picker.current });
                else updateDraft(pickerTarget.userId, { workspaceRoot: picker.current, workspaceMode: 'specified' });
                setPicker(null);
              } }, t('useDirectory')),
            ),
            h('div', { className: 'dsh-access-directory-list' },
              ...picker.entries.map((entry) => h('button', { key: entry.path, type: 'button', onClick: () => void browse(entry.path), title: entry.path }, `📁 ${entry.name}`)),
            ),
          )
        : null,
      h(
        'section',
        { className: 'dsh-access-admin-section' },
        h('div', { className: 'dsh-access-admin-section-title' },
          h('h3', null, t('subusers')),
          h('button', { type: 'button', className: 'dsh-access-btn', onClick: () => void load() }, t('accountRefresh')),
        ),
        h(
          'div',
          { className: 'dsh-access-admin-user-list' },
          h('input', {
            className: 'dsh-access-input dsh-access-admin-user-search',
            value: userQuery,
            placeholder: t('accountSearchUsers'),
            onChange: (e: Event) => setUserQuery((e.target as HTMLInputElement).value),
          }),
          loading ? h('div', { className: 'dsh-access-hint' }, t('accountLoading')) : null,
          !loading && visibleUsers.length === 0 ? h('div', { className: 'dsh-access-hint' }, t('accountNoUsers')) : null,
        ...visibleUsers.map((user) => {
          const draft = drafts[user.id] ?? draftOf(user);
          const expanded = expandedManagedUserId === user.id;
          return h(
            'div',
            { key: user.id, className: 'dsh-access-admin-user' },
            h('div', { className: 'dsh-access-admin-user-head' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-access-admin-user-toggle',
                  'aria-expanded': expandedManagedUserId === user.id,
                  onClick: () => setExpandedManagedUserId((current) => current === user.id ? null : user.id),
                },
                h('span', { className: 'dsh-access-admin-user-identity' },
                  h('strong', null, user.username),
                  draft.remark ? h('span', { className: 'dsh-access-admin-user-summary' }, draft.remark) : null,
                  h('span', { className: 'dsh-access-admin-user-last-login' },
                    user.lastLoginAt ? t('lastLogin', { time: user.lastLoginAt }) : t('neverLoggedIn'),
                  ),
                  draft.banned ? h('span', { className: 'dsh-access-badge admin' }, t('banned')) : null,
                ),
                h('span', { className: 'dsh-access-admin-user-chevron', 'aria-hidden': 'true' }, expanded ? '▴' : '▾'),
              ),
              h('button', {
                type: 'button',
                className: 'dsh-access-admin-user-delete',
                disabled: busy === `delete:${user.id}`,
                onClick: () => void removeUser(user),
              }, t('remove')),
            ),
            expanded ? h(
              'div',
              { className: 'dsh-access-admin-user-details' },
              h('input', { className: 'dsh-access-input', value: draft.remark, placeholder: t('accountRemark'), onChange: (e: Event) => updateDraft(user.id, { remark: (e.target as HTMLInputElement).value }) }),
              h('select', { className: 'dsh-access-input', value: draft.workspaceMode, onChange: (e: Event) => updateDraft(user.id, { workspaceMode: (e.target as HTMLSelectElement).value as UserDraft['workspaceMode'] }) },
                h('option', { value: 'username' }, t('workspaceByUsername')),
                h('option', { value: 'specified' }, t('workspaceSpecified')),
              ),
              draft.workspaceMode === 'specified'
                ? h('div', { className: 'dsh-access-directory-row' },
                    h('input', { className: 'dsh-access-input', value: draft.workspaceRoot, placeholder: t('workspaceDirectory'), onChange: (e: Event) => updateDraft(user.id, { workspaceRoot: (e.target as HTMLInputElement).value }) }),
                    h('button', { type: 'button', className: 'dsh-access-btn', onClick: () => void browse(draft.workspaceRoot, { kind: 'user', userId: user.id }) }, t('chooseDirectory')),
                  )
                : h('div', { className: 'dsh-access-hint' }, t('workspaceUsernameHint')),
              h('div', { className: 'dsh-access-hint dsh-access-admin-user-workspace', title: draft.workspaceRoot }, `${t('workspaceLabel')}: ${draft.workspaceRoot || t('workspaceNeedsRepair')}`),
              h('div', { className: 'dsh-access-admin-grid' },
                h('label', { className: 'dsh-access-limit-field' },
                  h('span', { className: 'dsh-access-limit-label' }, t('permsToken')),
                  h('input', { className: 'dsh-access-input', type: 'number', min: 0, inputMode: 'numeric', value: draft.hourlyTokenLimit, placeholder: t('permsToken'), onChange: (e: Event) => updateDraft(user.id, { hourlyTokenLimit: (e.target as HTMLInputElement).value }) }),
                ),
                h('label', { className: 'dsh-access-limit-field' },
                  h('span', { className: 'dsh-access-limit-label' }, t('permsMinutes')),
                  h('input', { className: 'dsh-access-input', type: 'number', min: 0, inputMode: 'numeric', value: draft.dailyMinutesLimit, placeholder: t('permsMinutes'), onChange: (e: Event) => updateDraft(user.id, { dailyMinutesLimit: (e.target as HTMLInputElement).value }) }),
                ),
              ),
              h('select', { className: 'dsh-access-input', value: draft.sandboxMode, onChange: (e: Event) => updateDraft(user.id, { sandboxMode: (e.target as HTMLSelectElement).value }) },
                h('option', { value: 'read-only' }, t('sandboxReadOnly')),
                h('option', { value: 'workspace-write' }, t('sandboxWorkspace')),
                h('option', { value: 'danger-full-access' }, t('sandboxFull')),
              ),
              h('div', { className: 'dsh-access-row' },
                h('label', { className: 'dsh-access-check' }, h('input', { type: 'checkbox', checked: draft.allowUpload, onChange: (e: Event) => updateDraft(user.id, { allowUpload: (e.target as HTMLInputElement).checked }) }), t('permsUpload')),
                h('label', { className: 'dsh-access-check' }, h('input', { type: 'checkbox', checked: draft.allowGitDownload, onChange: (e: Event) => updateDraft(user.id, { allowGitDownload: (e.target as HTMLInputElement).checked }) }), t('permsGit')),
                h('label', { className: 'dsh-access-check' }, h('input', { type: 'checkbox', checked: draft.banned, onChange: (e: Event) => updateDraft(user.id, { banned: (e.target as HTMLInputElement).checked }) }), t('permsBanned')),
              ),
              h('div', { className: 'dsh-access-row' },
                h('button', { type: 'button', className: 'dsh-access-btn', disabled: busy === `save:${user.id}`, onClick: () => void saveUser(user) }, t('permsSave')),
              ),
            ) : null,
          );
        }),
        ),
      ),
    ),
  ), document.body);
}

export function AccountMenu(props: { wide: boolean } & PropsLocale<'dshaccess'>) {
  const { wide, t } = props;
  const root = useRef<HTMLDivElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<CurrentAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stream = typeof EventSource === 'undefined' ? null : new EventSource('/gateway/api/messages/stream');
    const revoke = (event: MessageEvent<{ reason?: string }>) => {
      const reason = event.data?.reason === 'account-banned' ? 'banned' : event.data?.reason === 'account-deleted' ? 'deleted' : 'credential-changed';
      window.location.assign(`/gateway/login?reason=${reason}`);
    };
    stream?.addEventListener('account-revoked', revoke);
    return () => {
      stream?.removeEventListener('account-revoked', revoke);
      stream?.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/gateway/api/me', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as MeResponse;
      })
      .then((data) => { if (active) setMe(data.me); })
      .catch(() => { if (active) setError(t('accountUnavailable')); });
    return () => { active = false; };
  }, [t]);

  useClientLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const anchorRect = root.current?.getBoundingClientRect();
      const popoverRect = popover.current?.getBoundingClientRect();
      if (!anchorRect || !popoverRect) return;
      setPopoverPosition(accountPopoverPosition(
        anchorRect,
        popoverRect,
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, wide, me, error, busy]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || popover.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/gateway/api/logout', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      window.location.assign('/gateway/login');
    } catch {
      setBusy(false);
      setError(t('logoutFailed'));
    }
  };

  const role = me?.role === 'admin' ? t('roleAdmin') : t('roleUser');
  const workspace = me?.workspaceRoot || t('workspaceNeedsRepair');
  const accountPopover = h('div', {
    className: 'dsh-access-account-popover',
    ref: popover,
    role: 'dialog',
    'aria-label': t('accountTitle'),
    style: popoverPosition
      ? { left: popoverPosition.left, top: popoverPosition.top }
      : { left: 12, top: 12, visibility: 'hidden' as const },
  },
  h('div', { className: 'dsh-access-account-title' }, me?.username ?? t('accountLoading')),
  h('div', { className: 'dsh-access-account-role' }, role),
  me?.role === 'admin' && window.location.protocol === 'http:' ? h('div', { className: 'dsh-access-account-warning' }, t('httpWarning')) : null,
  me?.role === 'user' ? h('dl', { className: 'dsh-access-account-summary' },
    h('dt', null, t('workspaceLabel')), h('dd', { className: 'dsh-access-account-workspace', title: workspace }, workspace),
    h('dt', null, t('sandboxLabel')), h('dd', null, me.sandboxMode ?? '-'),
    h('dt', null, t('uploadLabel')), h('dd', null, me.allowUpload ? t('yes') : t('no')),
    h('dt', null, t('gitLabel')), h('dd', null, me.allowGitDownload ? t('yes') : t('no')),
    h('dt', null, t('hourlyQuotaLabel')), h('dd', null, me.hourlyTokenLimit === null || me.hourlyTokenLimit === undefined ? t('unlimited') : String(me.hourlyTokenLimit)),
    h('dt', null, t('dailyQuotaLabel')), h('dd', null, me.dailyMinutesLimit === null || me.dailyMinutesLimit === undefined ? t('unlimited') : `${String(me.dailyMinutesLimit)} min`),
  ) : null,
  me?.role === 'admin' ? h('button', { type: 'button', className: 'dsh-access-account-manage', onClick: () => { setOpen(false); setAdminOpen(true); } }, t('accountManage')) : null,
  error ? h('div', { className: 'dsh-access-error' }, error) : null,
  h('button', { type: 'button', className: 'dsh-access-account-logout', disabled: busy, onClick: logout }, busy ? t('loggingOut') : t('logout')),
  );

  return h(
    'div',
    { className: 'dsh-access-account-wrap', ref: root },
    h('button', {
      type: 'button', className: `dsh-access-account-trigger${wide ? '' : ' rail'}`,
      'aria-label': me ? `${me.username} (${role})` : t('accountLoading'),
      'aria-expanded': open, onClick: () => {
        setPopoverPosition(null);
        setOpen((value) => !value);
      },
    },
    h('svg', { className: 'dsh-access-account-icon', width: wide ? 16 : 18, height: wide ? 16 : 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
      h('circle', { cx: 12, cy: 8, r: 3.2, stroke: 'currentColor', strokeWidth: 1.8 }),
      h('path', { d: 'M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
    ),
    wide && h('span', { className: 'dsh-access-account-label' }, `${me?.username ?? t('accountLoading')} · ${role}`)),
    open ? createPortal(accountPopover, document.body) : null,
    adminOpen ? h(AdminAccountCenter, { t, close: () => setAdminOpen(false) }) : null,
  );
}
