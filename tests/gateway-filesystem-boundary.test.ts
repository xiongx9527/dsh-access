import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
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

test('guest directory browser starts at its workspace and cannot create outside it', async (t) => {
  const fixture = createAuthFixture();
  await fixture.auth.setup({ setupKey: fixture.config.setupKey, username: 'admin', password: ADMIN_PASSWORD });
  const admin = fixture.db.getUserByUsername('admin')!;
  await fixture.auth.addSubUser({ userId: admin.id, username: admin.username, role: 'admin' }, 'guest', USER_PASSWORD);
  const guest = fixture.db.getUserByUsername('guest')!;
  const root = mkdtempSync(path.join(os.tmpdir(), 'dshpw-guest-root-'));
  const inside = path.join(root, 'inside');
  mkdirSync(inside);
  fixture.db.setPermissions(guest.id, {
    allowedFolders: [root], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: false, allowGitDownload: false, banned: false,
    sandboxMode: 'read-only', workspaceMode: 'specified', workspaceRoot: root, remark: '',
  });

  const forwarded: Array<{ url: string; body: unknown }> = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      forwarded.push({ url: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if ((req.url ?? '').includes('host.listDirectory')) {
        res.end(JSON.stringify({
          result: { ok: true, value: {
            path: root,
            home: os.homedir(),
            crumbs: [
              { name: '/', path: '/', hidden: false },
              { name: path.basename(root), path: root, hidden: false },
            ],
            entries: [{ name: 'inside', path: inside, hidden: false }],
            truncated: false,
          } },
        }));
        return;
      }
      res.end(JSON.stringify({ result: { ok: true, value: { path: inside } } }));
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
  const headers = { cookie: cookie(token), 'content-type': 'application/json' };

  const listing = await fetch(`${baseUrl}/api/host.listDirectory`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'host.listDirectory', payload: {} }),
  });
  assert.equal(listing.status, 200);
  const forwardedList = forwarded[0]!.body as { payload: { path?: string } };
  assert.equal(forwardedList.payload.path, root, 'missing path must be rewritten to the assigned workspace root');
  const listingBody = await listing.json() as { result: { value: { home: string; crumbs: Array<{ path: string }> } } };
  assert.equal(listingBody.result.value.home, root);
  assert.deepEqual(listingBody.result.value.crumbs.map((entry) => entry.path), [root]);

  const readOnlyCreate = await fetch(`${baseUrl}/api/host.createDirectory`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'host.createDirectory', payload: { path: root, name: 'blocked' } }),
  });
  assert.equal(readOnlyCreate.status, 403);
  assert.equal(forwarded.length, 1, 'read-only directory creation must not reach the DSH upstream');

  fixture.db.setPermissions(guest.id, {
    allowedFolders: [root], hourlyTokenLimit: null, dailyMinutesLimit: null,
    allowUpload: false, allowGitDownload: false, banned: false,
    sandboxMode: 'workspace-write', workspaceMode: 'specified', workspaceRoot: root, remark: '',
  });

  const outsideParent = mkdtempSync(path.join(os.tmpdir(), 'dshpw-outside-'));
  const outsideTarget = path.join(outsideParent, 'escape');
  const outside = await fetch(`${baseUrl}/api/host.createDirectory`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'host.createDirectory', payload: { path: outsideParent, name: 'escape' } }),
  });
  assert.equal(outside.status, 403);
  assert.equal(existsSync(outsideTarget), false);
  assert.equal(forwarded.length, 1, 'outside create must not reach the DSH upstream');

  const insideCreate = await fetch(`${baseUrl}/api/host.createDirectory`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'host.createDirectory', payload: { path: root, name: 'inside' } }),
  });
  assert.equal(insideCreate.status, 200);
  assert.equal(forwarded.length, 2, 'workspace-write creation inside the assigned root may reach DSH');

  const outsideWorkspace = await fetch(`${baseUrl}/api/workspace.create`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'workspace.create', payload: { path: outsideParent } }),
  });
  assert.equal(outsideWorkspace.status, 403);
  assert.equal(forwarded.length, 2, 'outside workspace registration must not reach DSH');

  const insideWorkspace = await fetch(`${baseUrl}/api/workspace.create`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'client-request', method: 'workspace.create', payload: { path: inside } }),
  });
  assert.equal(insideWorkspace.status, 200);
  assert.equal(forwarded.length, 3, 'workspace registration inside the assigned root may reach DSH');
});
