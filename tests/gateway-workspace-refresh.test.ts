import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthFixture } from './helpers.js';
import { createGatewayServer } from '../src/gateway.js';

const ADMIN_PASSWORD = 'AdminPass@2026';
const USER_PASSWORD = 'GuestPass@2026';

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('session creation refreshes workspaceId paths after a gateway restart', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser({ userId: admin.id, username: admin.username, role: 'admin' }, 'guest', USER_PASSWORD);
  const guest = fixture.db.getUserByUsername('guest')!;
  const root = mkdtempSync(path.join(os.tmpdir(), 'dshpw-refresh-root-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dshpw-refresh-outside-'));
  const busyWorkspace = path.join(root, 'busy');
  mkdirSync(busyWorkspace);
  fixture.db.setPermissions(guest.id, {
    allowedFolders: [root], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: false, allowGitDownload: false, banned: false,
    sandboxMode: 'workspace-write', workspaceMode: 'specified', workspaceRoot: root, remark: '',
  });

  const methods: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { method?: string; rpcId?: string };
      methods.push(body.method ?? 'unknown');
      payloads.push(body as unknown as Record<string, unknown>);
      res.setHeader('content-type', 'application/json');
      if (body.method === 'workspace.list') {
        res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [
          { workspaceId: 'guest-root', path: root, sessionIds: [] },
          { workspaceId: 'guest-busy', path: busyWorkspace, sessionIds: ['session-existing'] },
          { workspaceId: 'outside-root', path: outside, sessionIds: [] },
        ], archivedSessionIds: [] } } }));
        return;
      }
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { sessionId: 'session-test' } } }));
    });
  });
  await listen(upstream);
  t.after(() => close(upstream));
  fixture.config.gateway.upstream = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const gateway = createGatewayServer(fixture.config, fixture.auth, fixture.db, {
    ensureWorkspace: async () => undefined,
  });
  await listen(gateway);
  t.after(() => close(gateway));
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const token = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;
  const headers = { cookie: `dsh_gateway_token=${encodeURIComponent(token)}`, 'content-type': 'application/json' };

  const inside = await fetch(`${baseUrl}/api/session.create`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'inside', method: 'session.create', payload: { workspaceId: 'stale-root' } }),
  });
  assert.equal(inside.status, 200);
  assert.deepEqual(methods, ['workspace.list', 'workspace.list', 'session.create']);
  assert.equal(((payloads[2]!.payload as Record<string, unknown>).workspaceId), 'guest-root');

  const rootDelete = await fetch(`${baseUrl}/api/workspace.delete`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'root-delete', method: 'workspace.delete', payload: { workspaceId: 'guest-root' } }),
  });
  assert.equal(rootDelete.status, 200);
  const rootDeleteBody = await rootDelete.json() as { result: { ok: boolean; error?: { code?: string } } };
  assert.equal(rootDeleteBody.result.ok, false);
  assert.equal(rootDeleteBody.result.error?.code, 'workspace-root-required');
  assert.deepEqual(methods, ['workspace.list', 'workspace.list', 'session.create']);

  const busyDelete = await fetch(`${baseUrl}/api/workspace.delete`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'busy-delete', method: 'workspace.delete', payload: { workspaceId: 'guest-busy' } }),
  });
  assert.equal(busyDelete.status, 200);
  const busyDeleteBody = await busyDelete.json() as { result: { ok: boolean; error?: { code?: string } } };
  assert.equal(busyDeleteBody.result.ok, false);
  assert.equal(busyDeleteBody.result.error?.code, 'workspace-not-empty');
  assert.deepEqual(methods, ['workspace.list', 'workspace.list', 'session.create']);

  const outsideResponse = await fetch(`${baseUrl}/api/session.create`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'outside', method: 'session.create', payload: { workspaceId: 'outside-root' } }),
  });
  assert.equal(outsideResponse.status, 403);
  assert.deepEqual(methods, ['workspace.list', 'workspace.list', 'session.create']);
});
