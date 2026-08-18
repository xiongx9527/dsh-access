import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAuthFixture } from './helpers.js';
import { createGatewayServer } from '../src/gateway.js';

const ADMIN_PASSWORD = 'AdminPass@2026';
const USER_PASSWORD = 'GuestPass@2026';

async function startFixture() {
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
    hourlyTokenLimit: 2000,
    dailyMinutesLimit: 45,
    allowUpload: false,
    allowGitDownload: false,
    banned: false,
    sandboxMode: 'read-only',
    workspaceMode: 'username',
    workspaceRoot: '/srv/workspaces/guest',
    remark: 'admin-only note',
  });
  const server = createGatewayServer(fixture.config, fixture.auth, fixture.db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    ...fixture,
    admin,
    guest,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function cookie(token: string): string {
  return `dsh_gateway_token=${encodeURIComponent(token)}`;
}

test('current-account endpoint returns the authenticated username, role and permission summary', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const { token } = await fixture.auth.login({ username: 'guest', password: USER_PASSWORD });

  const response = await fetch(`${fixture.baseUrl}/gateway/api/me`, { headers: { cookie: cookie(token) } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    me: {
      id: fixture.guest.id,
      username: 'guest',
      role: 'user',
      workspaceMode: 'username',
      workspaceRoot: '/srv/workspaces/guest',
      sandboxMode: 'read-only',
      allowUpload: false,
      allowGitDownload: false,
      hourlyTokenLimit: 2000,
      dailyMinutesLimit: 45,
    },
  });
});

test('logout revokes the presented token instead of only clearing the browser cookie', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const { token } = await fixture.auth.login({ username: 'guest', password: USER_PASSWORD });

  const logout = await fetch(`${fixture.baseUrl}/gateway/api/logout`, {
    method: 'POST',
    headers: { cookie: cookie(token), 'content-type': 'application/json' },
    body: '{}',
    redirect: 'manual',
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/i);

  const after = await fetch(`${fixture.baseUrl}/gateway/api/me`, { headers: { cookie: cookie(token) } });
  assert.equal(after.status, 401);
});

test('banning an account is observed by the very next request even after a successful cached request', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const { token } = await fixture.auth.login({ username: 'guest', password: USER_PASSWORD });
  const headers = { cookie: cookie(token) };
  assert.equal((await fetch(`${fixture.baseUrl}/gateway/api/me`, { headers })).status, 200);

  const current = fixture.db.getPermissions(fixture.guest.id)!;
  fixture.db.setPermissions(fixture.guest.id, {
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

  const after = await fetch(`${fixture.baseUrl}/gateway/api/me`, { headers });
  assert.ok(after.status === 401 || after.status === 403);
});

test('admin overview includes account remark while the subuser current-account response never exposes it', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const adminToken = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;
  const guestToken = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;

  const overview = await fetch(`${fixture.baseUrl}/gateway/api/overview`, {
    headers: { cookie: cookie(adminToken) },
  });
  const overviewBody = (await overview.json()) as { users: Array<{ username: string; remark?: string; lastLoginAt?: string | null }> };
  assert.equal(overview.status, 200);
  const overviewGuest = overviewBody.users.find((user) => user.username === 'guest');
  assert.equal(overviewGuest?.remark, 'admin-only note');
  assert.equal(typeof overviewGuest?.lastLoginAt, 'string');

  const me = await fetch(`${fixture.baseUrl}/gateway/api/me`, { headers: { cookie: cookie(guestToken) } });
  assert.equal(JSON.stringify(await me.json()).includes('admin-only note'), false);
});

test('admin creates a username-mode subuser with one registered workspace root', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const baseRoot = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).default.tmpdir(), 'dshpw-api-users-'));
  (fixture.config as typeof fixture.config & { workspaceRoot: string }).workspaceRoot = baseRoot;
  const registered: string[] = [];
  const server = createGatewayServer(fixture.config, fixture.auth, fixture.db, {
    ensureWorkspace: async (root: string) => { registered.push(root); },
  } as never);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const adminToken = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;

  const response = await fetch(`${baseUrl}/gateway/api/users`, {
    method: 'POST',
    headers: { cookie: cookie(adminToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'alice',
      password: 'AlicePass@2026',
      workspaceMode: 'username',
      remark: 'Alice account',
    }),
  });
  const body = (await response.json()) as { ok: boolean; user?: { id: number; workspaceRoot: string } };
  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  const alice = fixture.db.getUserByUsername('alice')!;
  const permissions = fixture.db.getPermissions(alice.id)!;
  assert.equal(permissions.workspace_mode, 'username');
  assert.equal(permissions.workspace_root, body.user?.workspaceRoot);
  assert.deepEqual(permissions.allowed_folders, [permissions.workspace_root]);
  assert.equal(permissions.remark, 'Alice account');
  assert.equal(permissions.sandbox_mode, 'workspace-write');
  assert.deepEqual(registered, [permissions.workspace_root]);
});

test('specified workspace creation fails atomically when the directory is invalid', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const adminToken = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;
  const response = await fetch(`${fixture.baseUrl}/gateway/api/users`, {
    method: 'POST',
    headers: { cookie: cookie(adminToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'invalidroot',
      password: 'InvalidRoot@2026',
      workspaceMode: 'specified',
      workspaceRoot: '/definitely/not/a/real/directory',
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.db.getUserByUsername('invalidroot'), null);
});

test('deleting a subuser removes the account but preserves its workspace files', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const fs = await import('node:fs');
  const temp = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).default.tmpdir(), 'dshpw-delete-user-'));
  const marker = (await import('node:path')).join(temp, 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  const current = fixture.db.getPermissions(fixture.guest.id)!;
  fixture.db.setPermissions(fixture.guest.id, {
    allowedFolders: [temp], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: false, allowGitDownload: false, banned: false,
    sandboxMode: current.sandbox_mode, workspaceMode: 'specified', workspaceRoot: temp, remark: current.remark,
  });
  const adminToken = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;

  const response = await fetch(`${fixture.baseUrl}/gateway/api/users/${fixture.guest.id}`, {
    method: 'DELETE', headers: { cookie: cookie(adminToken) },
  });
  assert.equal(response.status, 200);
  assert.equal(fixture.db.getUserById(fixture.guest.id), null);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
});

test('subuser settings and credential mutation requests are rejected before reaching DSH', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const guestToken = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;
  for (const pathname of ['/api/settings.mutate', '/api/credentials.set', '/api/llm.discoverModels']) {
    const response = await fetch(`${fixture.baseUrl}${pathname}`, {
      method: 'POST',
      headers: { cookie: cookie(guestToken), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: pathname.slice(5), payload: {} }),
    });
    assert.equal(response.status, 403, pathname);
  }
});

test('admin directory browser lists directories for specified workspace selection and rejects subusers', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const fs = await import('node:fs');
  const pathModule = await import('node:path');
  const osModule = await import('node:os');
  const root = fs.mkdtempSync(pathModule.join(osModule.default.tmpdir(), 'dshpw-directory-browser-'));
  fs.mkdirSync(pathModule.join(root, 'alpha'));
  fs.mkdirSync(pathModule.join(root, 'beta'));
  fs.writeFileSync(pathModule.join(root, 'not-a-directory.txt'), 'x');
  const adminToken = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;
  const guestToken = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;

  const admin = await fetch(`${fixture.baseUrl}/gateway/api/directories?path=${encodeURIComponent(root)}`, {
    headers: { cookie: cookie(adminToken) },
  });
  assert.equal(admin.status, 200);
  const body = (await admin.json()) as { current: string; entries: Array<{ name: string; path: string }> };
  assert.equal(body.current, fs.realpathSync(root));
  assert.deepEqual(body.entries.map((entry) => entry.name), ['alpha', 'beta']);

  const guest = await fetch(`${fixture.baseUrl}/gateway/api/directories?path=${encodeURIComponent(root)}`, {
    headers: { cookie: cookie(guestToken) },
  });
  assert.equal(guest.status, 403);
});

test('login page does not render a Chinese-English language switch', async (t) => {
  const fixture = await startFixture();
  t.after(fixture.close);
  const response = await fetch(`${fixture.baseUrl}/gateway/login`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(html.includes('<div class="lang-switch">'), false);
  assert.equal(html.includes('English</a>'), false);
});
