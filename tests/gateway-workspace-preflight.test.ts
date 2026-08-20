import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthFixture } from './helpers.js';
import { createGatewayServer } from '../src/gateway.js';

const ADMIN_PASSWORD = 'AdminPass@2026';
const USER_PASSWORD = 'GuestPass@2026';

function cookie(token: string): string {
  return `dsh_gateway_token=${encodeURIComponent(token)}`;
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function guestGateway(t: { after: (fn: () => Promise<void>) => void }) {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser({ userId: admin.id, username: admin.username, role: 'admin' }, 'guest', USER_PASSWORD);
  const guest = fixture.db.getUserByUsername('guest')!;
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-preflight-root-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-preflight-outside-'));
  const escaped = path.join(root, 'escaped');
  symlinkSync(outside, escaped, 'dir');
  fixture.db.setPermissions(guest.id, {
    allowedFolders: [root], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: true, allowGitDownload: true, banned: false,
    sandboxMode: 'workspace-write', workspaceMode: 'specified', workspaceRoot: root, remark: '',
  });

  const forwarded: string[] = [];
  const upstream = http.createServer((req, res) => {
    forwarded.push(req.url ?? '');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { method?: string; rpcId?: string };
      res.setHeader('content-type', 'application/json');
      if (body.method === 'session.search') {
        res.end(JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: true, value: { items: [
            { sessionId: 'inside', cwd: root, title: 'inside' },
            { sessionId: 'outside', cwd: outside, title: 'outside' },
            { sessionId: 'escaped', cwd: escaped, title: 'escaped' },
          ] } },
        }));
        return;
      }
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: {} } }));
    });
  });
  await listen(upstream);
  t.after(() => close(upstream));
  fixture.config.gateway.upstream = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const gateway = createGatewayServer(fixture.config, fixture.auth, fixture.db);
  await listen(gateway);
  t.after(() => close(gateway));
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const token = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;
  return { fixture, guest, root, outside, forwarded, baseUrl, headers: { cookie: cookie(token), 'content-type': 'application/json' } };
}

test('subuser session.search response is filtered to the assigned workspace', async (t) => {
  const { baseUrl, headers, root, forwarded } = await guestGateway(t);
  const response = await fetch(`${baseUrl}/api/session.search`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'search-1', method: 'session.search', payload: { query: 'all' } }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { result: { value: { items: Array<{ sessionId: string; cwd: string }> } } };
  assert.deepEqual(body.result.value.items.map((item) => item.sessionId), ['inside']);
  assert.deepEqual(forwarded, ['/api/session.search']);
  assert.equal(body.result.value.items[0]?.cwd, root);
});

test('subuser upload and Git requests reject paths outside the assigned workspace even when enabled', async (t) => {
  const { baseUrl, headers, outside, forwarded } = await guestGateway(t);
  for (const [pathname, method, rpcMethod, urlSuffix] of [
    ['/api/dsh-uploads', 'POST', undefined, ''],
    ['/api/git.clone', 'POST', 'git.clone', ''],
    ['/api/dsh-uploads/download', 'GET', undefined, `?path=${encodeURIComponent(outside)}`],
    ['/api/session.export', 'GET', undefined, `?path=${encodeURIComponent(outside)}`],
  ] as const) {
    const response = await fetch(`${baseUrl}${pathname}${urlSuffix}`, {
      method, headers,
      ...(method === 'POST'
        ? { body: JSON.stringify({ type: 'client-request', rpcId: pathname, method: rpcMethod, payload: { path: outside } }) }
        : {}),
    });
    assert.equal(response.status, 403, pathname);
  }
  assert.deepEqual(forwarded, []);
});

test('permission update compensates an externally registered workspace when database persistence fails', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser({ userId: admin.id, username: admin.username, role: 'admin' }, 'guest', USER_PASSWORD);
  const guest = fixture.db.getUserByUsername('guest')!;
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-old-root-'));
  const newRoot = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-new-root-'));
  fixture.db.setPermissions(guest.id, {
    allowedFolders: [oldRoot], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: true, allowGitDownload: true, banned: false,
    sandboxMode: 'workspace-write', workspaceMode: 'specified', workspaceRoot: oldRoot, remark: '',
  });
  const removed: string[] = [];
  const originalSetPermissions = fixture.db.setPermissions.bind(fixture.db);
  let setCalls = 0;
  (fixture.db as typeof fixture.db & { setPermissions: typeof fixture.db.setPermissions }).setPermissions = ((...args) => {
    setCalls += 1;
    if (setCalls === 1) throw new Error('simulated database failure');
    return originalSetPermissions(...args);
  }) as typeof fixture.db.setPermissions;
  const gateway = createGatewayServer(fixture.config, fixture.auth, fixture.db, {
    ensureWorkspace: async () => true,
    removeWorkspace: async (root: string) => { removed.push(root); },
  });
  await listen(gateway);
  t.after(() => close(gateway));
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const token = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;
  const response = await fetch(`${baseUrl}/gateway/api/permissions`, {
    method: 'POST',
    headers: { cookie: cookie(token), 'content-type': 'application/json' },
    body: JSON.stringify({ userId: guest.id, workspaceMode: 'specified', workspaceRoot: newRoot }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(removed, [realpathSync(newRoot)]);
  assert.equal(fixture.db.getPermissions(guest.id)?.workspace_root, oldRoot);
});

test('subuser creation removes a newly registered workspace when permission persistence fails', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  const baseRoot = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-create-root-'));
  (fixture.config as typeof fixture.config & { workspaceRoot: string }).workspaceRoot = baseRoot;
  const removed: string[] = [];
  const originalSetPermissions = fixture.db.setPermissions.bind(fixture.db);
  let setCalls = 0;
  (fixture.db as typeof fixture.db & { setPermissions: typeof fixture.db.setPermissions }).setPermissions = ((...args) => {
    setCalls += 1;
    if (setCalls === 1) throw new Error('simulated database failure');
    return originalSetPermissions(...args);
  }) as typeof fixture.db.setPermissions;
  const gateway = createGatewayServer(fixture.config, fixture.auth, fixture.db, {
    ensureWorkspace: async () => true,
    removeWorkspace: async (root: string) => { removed.push(root); },
  });
  await listen(gateway);
  t.after(() => close(gateway));
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const token = (await fixture.auth.login({ username: 'admin', password: ADMIN_PASSWORD })).token;
  const response = await fetch(`${baseUrl}/gateway/api/users`, {
    method: 'POST',
    headers: { cookie: cookie(token), 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: USER_PASSWORD, workspaceMode: 'username' }),
  });
  assert.equal(response.status, 400);
  assert.equal(fixture.db.getUserByUsername('alice'), null);
  assert.deepEqual(removed, [realpathSync(path.join(baseRoot, 'alice'))]);
});
