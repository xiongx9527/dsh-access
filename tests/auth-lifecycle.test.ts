import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthFixture } from './helpers.js';

const ADMIN_PASSWORD = 'AdminPass@2026';
const USER_PASSWORD = 'GuestPass@2026';

async function createUsers() {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser(
    { userId: admin.id, username: admin.username, role: 'admin' },
    'guest',
    USER_PASSWORD,
  );
  const guest = fixture.db.getUserByUsername('guest')!;
  fixture.db.setPermissions(guest.id, {
    allowedFolders: ['/srv/workspaces/guest'],
    hourlyTokenLimit: null,
    dailyMinutesLimit: null,
    allowUpload: false,
    allowGitDownload: false,
    banned: false,
    sandboxMode: 'read-only',
    workspaceMode: 'username',
    workspaceRoot: '/srv/workspaces/guest',
  });
  return { ...fixture, admin, guest };
}

test('banned subuser cannot obtain a new login token', async () => {
  const { auth, db, guest } = await createUsers();
  const current = db.getPermissions(guest.id)!;
  db.setPermissions(guest.id, {
    allowedFolders: current.allowed_folders,
    hourlyTokenLimit: current.hourly_token_limit,
    dailyMinutesLimit: current.daily_minutes_limit,
    allowUpload: current.allow_upload,
    allowGitDownload: current.allow_git_download,
    banned: true,
    sandboxMode: current.sandbox_mode,
    workspaceMode: current.workspace_mode,
    workspaceRoot: current.workspace_root,
    remark: current.remark,
  });

  await assert.rejects(
    auth.login({ username: 'guest', password: USER_PASSWORD }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'ACCOUNT_BANNED',
  );
});

test('deleting an account invalidates its previously issued token immediately', async () => {
  const { auth, db, guest } = await createUsers();
  const { token } = await auth.login({ username: 'guest', password: USER_PASSWORD });
  db.deleteUser(guest.id);

  assert.throws(
    () => auth.verifyToken(token),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INVALID_TOKEN',
  );
});

test('changing a password invalidates the old token immediately', async () => {
  const { auth, guest } = await createUsers();
  const { token } = await auth.login({ username: 'guest', password: USER_PASSWORD });
  await auth.changePassword(
    { userId: guest.id, username: guest.username, role: 'user' },
    'guest',
    'ChangedPass@2026',
  );

  assert.throws(
    () => auth.verifyToken(token),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INVALID_TOKEN',
  );
});

test('unbanning requires a fresh login and never revives the pre-ban token', async () => {
  const { auth, db, guest } = await createUsers();
  const { token } = await auth.login({ username: 'guest', password: USER_PASSWORD });
  const current = db.getPermissions(guest.id)!;
  db.setPermissions(guest.id, {
    allowedFolders: current.allowed_folders,
    hourlyTokenLimit: current.hourly_token_limit,
    dailyMinutesLimit: current.daily_minutes_limit,
    allowUpload: current.allow_upload,
    allowGitDownload: current.allow_git_download,
    banned: true,
    sandboxMode: current.sandbox_mode,
    workspaceMode: current.workspace_mode,
    workspaceRoot: current.workspace_root,
    remark: current.remark,
  });
  db.setPermissions(guest.id, {
    allowedFolders: current.allowed_folders,
    hourlyTokenLimit: current.hourly_token_limit,
    dailyMinutesLimit: current.daily_minutes_limit,
    allowUpload: current.allow_upload,
    allowGitDownload: current.allow_git_download,
    banned: false,
    sandboxMode: current.sandbox_mode,
    workspaceMode: current.workspace_mode,
    workspaceRoot: current.workspace_root,
    remark: current.remark,
  });

  assert.throws(
    () => auth.verifyToken(token),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'INVALID_TOKEN',
  );
  const fresh = await auth.login({ username: 'guest', password: USER_PASSWORD });
  assert.equal(auth.verifyToken(fresh.token).username, 'guest');
});
