import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db.js';
import { createFieldCrypto } from '../src/encrypt.js';

function createDatabase(): Database {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-passwords-ext-db-'));
  const db = new Database(path.join(dir, 'platform.db'), createFieldCrypto('', 'test-setup-key'));
  db.init();
  return db;
}

test('permission migration persists exactly one workspace assignment and admin-only remark', () => {
  const db = createDatabase();
  const user = db.createUser('alice', 'hash', 'user');

  db.setPermissions(user.id, {
    allowedFolders: ['/srv/workspaces/alice'],
    hourlyTokenLimit: 1000,
    dailyMinutesLimit: 30,
    allowUpload: false,
    allowGitDownload: false,
    banned: true,
    sandboxMode: 'read-only',
    workspaceMode: 'username',
    workspaceRoot: '/srv/workspaces/alice',
    remark: '外包测试账号',
  } as never);

  const permissions = db.getPermissions(user.id) as unknown as Record<string, unknown>;
  assert.equal(permissions.workspace_mode, 'username');
  assert.equal(permissions.workspace_root, '/srv/workspaces/alice');
  assert.equal(permissions.remark, '外包测试账号');
  assert.deepEqual(permissions.allowed_folders, ['/srv/workspaces/alice']);
  assert.equal(permissions.banned, true);
});

test('legacy user with one allowed folder migrates to specified workspace mode', () => {
  const db = createDatabase();
  const user = db.createUser('legacy', 'hash', 'user');
  db.setPermissions(user.id, {
    allowedFolders: ['/srv/legacy/project'],
    hourlyTokenLimit: null,
    dailyMinutesLimit: null,
    allowUpload: true,
    allowGitDownload: true,
    banned: false,
    sandboxMode: null,
  });

  db.init();
  const permissions = db.getPermissions(user.id) as unknown as Record<string, unknown>;
  assert.equal(permissions.workspace_mode, 'specified');
  assert.equal(permissions.workspace_root, '/srv/legacy/project');
});

test('legacy user without one legal root is marked repair-required instead of unrestricted', () => {
  const db = createDatabase();
  const user = db.createUser('broken', 'hash', 'user');
  db.setPermissions(user.id, {
    allowedFolders: [],
    hourlyTokenLimit: null,
    dailyMinutesLimit: null,
    allowUpload: true,
    allowGitDownload: true,
    banned: false,
    sandboxMode: null,
  });

  db.init();
  const permissions = db.getPermissions(user.id) as unknown as Record<string, unknown>;
  assert.equal(permissions.workspace_mode, 'repair-required');
  assert.equal(permissions.workspace_root, null);
});
