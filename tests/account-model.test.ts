import test from 'node:test';
import assert from 'node:assert/strict';

async function model() {
  const loaded = await import('../src/client/account-model.js').catch(() => null);
  assert.ok(loaded, 'account-model module must exist');
  return loaded;
}

const user = {
  id: 2,
  username: 'guest',
  role: 'user' as const,
  remark: '原备注',
  workspaceMode: 'specified' as const,
  workspaceRoot: '/srv/guest',
  permissions: {
    allowedFolders: ['/srv/guest'], hourlyTokenLimit: 1000, dailyMinutesLimit: 30,
    allowUpload: false, allowGitDownload: false, banned: false, sandboxMode: 'read-only',
  },
};

test('permission updates preserve the sole workspace and unrelated limits', async () => {
  const { permissionPayload } = await model();
  assert.deepEqual(permissionPayload(user, { banned: true, remark: '暂停使用' }), {
    userId: 2,
    workspaceMode: 'specified',
    workspaceRoot: '/srv/guest',
    allowedFolders: ['/srv/guest'],
    hourlyTokenLimit: 1000,
    dailyMinutesLimit: 30,
    allowUpload: false,
    allowGitDownload: false,
    banned: true,
    sandboxMode: 'read-only',
    remark: '暂停使用',
  });
});


test('permission limits can be explicitly cleared to unlimited', async () => {
  const { permissionPayload } = await model();
  const payload = permissionPayload(user, { hourlyTokenLimit: null, dailyMinutesLimit: null });
  assert.equal(payload.hourlyTokenLimit, null);
  assert.equal(payload.dailyMinutesLimit, null);
});

test('username-mode account creation does not send a specified path', async () => {
  const { createAccountPayload } = await model();
  assert.deepEqual(createAccountPayload({
    username: 'alice', password: 'AlicePass@2026', workspaceMode: 'username',
    workspaceRoot: '/ignored', remark: '研发', sandboxMode: 'read-only',
    allowUpload: false, allowGitDownload: false,
  }), {
    username: 'alice', password: 'AlicePass@2026', workspaceMode: 'username',
    remark: '研发', sandboxMode: 'read-only', allowUpload: false, allowGitDownload: false,
  });
});

test('specified-mode account creation requires one directory', async () => {
  const { createAccountPayload } = await model();
  assert.throws(() => createAccountPayload({
    username: 'alice', password: 'AlicePass@2026', workspaceMode: 'specified',
    workspaceRoot: '', remark: '', sandboxMode: 'read-only',
    allowUpload: false, allowGitDownload: false,
  }), /directory/i);
});


test('account popover stays inside the viewport while opening above the footer trigger', async () => {
  const { accountPopoverPosition } = await model();
  assert.deepEqual(accountPopoverPosition(
    { left: 8, top: 700, right: 500, bottom: 734 },
    { width: 300, height: 240 },
    { width: 1200, height: 800 },
  ), { left: 12, top: 452 });

  assert.deepEqual(accountPopoverPosition(
    { left: 1080, top: 40, right: 1120, bottom: 76 },
    { width: 300, height: 240 },
    { width: 1200, height: 800 },
  ), { left: 888, top: 84 });
});


test('account creation preserves configurable sandbox, upload and Git permissions', async () => {
  const { createAccountPayload } = await model();
  assert.deepEqual(createAccountPayload({
    username: 'builder', password: 'BuilderPass@2026', workspaceMode: 'username',
    workspaceRoot: '', remark: '构建账号', sandboxMode: 'workspace-write',
    allowUpload: true, allowGitDownload: true,
  }), {
    username: 'builder', password: 'BuilderPass@2026', workspaceMode: 'username',
    remark: '构建账号', sandboxMode: 'workspace-write',
    allowUpload: true, allowGitDownload: true,
  });
});


test('subuser search matches username, remark and assigned workspace', async () => {
  const { filterManagedUsers } = await model();
  const alice = { ...user, id: 3, username: 'alice', remark: '研发账号', workspaceRoot: '/srv/research/alice' };
  const bob = { ...user, id: 4, username: 'bob', remark: '运维', workspaceRoot: '/srv/operations/bob' };
  const admin = { ...user, id: 1, username: 'admin', role: 'admin' as const };
  assert.deepEqual(filterManagedUsers([admin, alice, bob], ''), [alice, bob]);
  assert.deepEqual(filterManagedUsers([admin, alice, bob], 'ALI'), [alice]);
  assert.deepEqual(filterManagedUsers([admin, alice, bob], '运维'), [bob]);
  assert.deepEqual(filterManagedUsers([admin, alice, bob], 'research'), [alice]);
});
