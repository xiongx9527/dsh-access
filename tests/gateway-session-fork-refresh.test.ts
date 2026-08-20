import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
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

test('session fork refreshes sessionId paths and enforces the guest workspace boundary', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser({ userId: admin.id, username: admin.username, role: 'admin' }, 'guest', USER_PASSWORD);
  const guest = fixture.db.getUserByUsername('guest')!;
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-fork-root-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dsh-access-fork-outside-'));
  fixture.db.setPermissions(guest.id, {
    allowedFolders: [root], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: false, allowGitDownload: false, banned: false,
    sandboxMode: 'workspace-write', workspaceMode: 'specified', workspaceRoot: root, remark: '',
  });

  const methods: string[] = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { method?: string; rpcId?: string };
      methods.push(body.method ?? 'unknown');
      res.setHeader('content-type', 'application/json');
      if (body.method === 'session.list') {
        res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [
          { sessionId: 'session-inside', cwd: root, blank: false },
          { sessionId: 'session-outside', cwd: outside, blank: false },
        ] } } }));
        return;
      }
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { sessionId: 'session-forked' } } }));
    });
  });
  await listen(upstream);
  t.after(() => close(upstream));
  fixture.config.gateway.upstream = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const gateway = createGatewayServer(fixture.config, fixture.auth, fixture.db, { ensureWorkspace: async () => undefined });
  await listen(gateway);
  t.after(() => close(gateway));
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const token = (await fixture.auth.login({ username: 'guest', password: USER_PASSWORD })).token;
  const headers = { cookie: `dsh_gateway_token=${encodeURIComponent(token)}`, 'content-type': 'application/json' };

  const inside = await fetch(`${baseUrl}/api/session.fork`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'fork-inside', method: 'session.fork', payload: { sessionId: 'session-inside' } }),
  });
  assert.equal(inside.status, 200);
  assert.deepEqual(methods, ['session.list', 'session.fork']);

  const outsideResponse = await fetch(`${baseUrl}/api/session.fork`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'fork-outside', method: 'session.fork', payload: { sessionId: 'session-outside' } }),
  });
  assert.equal(outsideResponse.status, 403);
  assert.deepEqual(methods, ['session.list', 'session.fork']);

  const promptResponse = await fetch(`${baseUrl}/api/session.prompt`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', rpcId: 'prompt-outside', method: 'session.prompt', payload: { sessionId: 'session-outside', prompt: 'secret' } }),
  });
  assert.equal(promptResponse.status, 403);
  assert.deepEqual(methods, ['session.list', 'session.fork']);
});
