export type WorkspaceMode = 'username' | 'specified' | 'repair-required';

export interface ManagedUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  remark: string;
  lastLoginAt: string | null;
  workspaceMode: WorkspaceMode;
  workspaceRoot: string | null;
  permissions: {
    allowedFolders: string[];
    hourlyTokenLimit: number | null;
    dailyMinutesLimit: number | null;
    allowUpload: boolean;
    allowGitDownload: boolean;
    banned: boolean;
    sandboxMode: string | null;
  };
}

export interface AccountForm {
  username: string;
  password: string;
  workspaceMode: 'username' | 'specified';
  workspaceRoot: string;
  remark: string;
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  allowUpload: boolean;
  allowGitDownload: boolean;
}

export function permissionPayload(
  user: ManagedUser,
  changes: Partial<{
    banned: boolean;
    remark: string;
    allowUpload: boolean;
    allowGitDownload: boolean;
    sandboxMode: string;
    hourlyTokenLimit: number | null;
    dailyMinutesLimit: number | null;
    workspaceMode: 'username' | 'specified';
    workspaceRoot: string;
  }>,
): Record<string, unknown> {
  const workspaceMode = changes.workspaceMode ?? (user.workspaceMode === 'username' ? 'username' : 'specified');
  const workspaceRoot = changes.workspaceRoot ?? user.workspaceRoot;
  return {
    userId: user.id,
    workspaceMode,
    workspaceRoot,
    allowedFolders: workspaceRoot ? [workspaceRoot] : [],
    hourlyTokenLimit:
      changes.hourlyTokenLimit !== undefined ? changes.hourlyTokenLimit : user.permissions.hourlyTokenLimit,
    dailyMinutesLimit:
      changes.dailyMinutesLimit !== undefined ? changes.dailyMinutesLimit : user.permissions.dailyMinutesLimit,
    allowUpload: changes.allowUpload ?? user.permissions.allowUpload,
    allowGitDownload: changes.allowGitDownload ?? user.permissions.allowGitDownload,
    banned: changes.banned ?? user.permissions.banned,
    sandboxMode: changes.sandboxMode ?? user.permissions.sandboxMode ?? 'read-only',
    remark: changes.remark ?? user.remark,
  };
}

export function createAccountPayload(form: AccountForm): Record<string, unknown> {
  const username = form.username.trim();
  const password = form.password;
  const remark = form.remark.trim();
  if (form.workspaceMode === 'specified' && form.workspaceRoot.trim() === '') {
    throw new Error('specified workspace requires one directory');
  }
  return {
    username,
    password,
    workspaceMode: form.workspaceMode,
    ...(form.workspaceMode === 'specified' ? { workspaceRoot: form.workspaceRoot.trim() } : {}),
    remark,
    sandboxMode: form.sandboxMode,
    allowUpload: form.allowUpload,
    allowGitDownload: form.allowGitDownload,
  };
}

export interface AccountPopoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AccountPopoverSize {
  width: number;
  height: number;
}

/** Position a body-level account popover near its trigger without leaving the viewport. */
export function accountPopoverPosition(
  anchor: AccountPopoverRect,
  popover: AccountPopoverSize,
  viewport: AccountPopoverSize,
  gap = 8,
  margin = 12,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);
  const above = anchor.top - popover.height - gap;
  const below = anchor.bottom + gap;
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  const top = above >= margin
    ? above
    : below + popover.height <= viewport.height - margin
      ? below
      : Math.min(Math.max(above, margin), maxTop);
  return { left: Math.round(left), top: Math.round(top) };
}

/** Return subusers matching a case-insensitive username, remark or workspace query. */
export function filterManagedUsers(users: readonly ManagedUser[], query: string): ManagedUser[] {
  const needle = query.trim().toLocaleLowerCase();
  return users.filter((user) => {
    if (user.role !== 'user') return false;
    if (needle === '') return true;
    return [user.username, user.remark, user.workspaceRoot ?? '']
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}
