import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { probeManagedGateway } from '../src/plugin.js';

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('managed gateway probe rejects an unrelated listener on the replacement port', async (t) => {
  const unrelated = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'unrelated-process' }));
  });
  await listen(unrelated);
  t.after(() => close(unrelated));
  const address = unrelated.address() as AddressInfo;

  assert.equal(await probeManagedGateway(address.port, '127.0.0.1', false, 'internal-test-secret'), false);
});

test('managed gateway probe accepts the dsh-access internal health response', async (t) => {
  const managed = http.createServer((req, res) => {
    if (req.url !== '/gateway/internal/health' || req.headers['x-internal-secret'] !== 'internal-test-secret') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'dsh-access-gateway' }));
  });
  await listen(managed);
  t.after(() => close(managed));
  const address = managed.address() as AddressInfo;

  assert.equal(await probeManagedGateway(address.port, '127.0.0.1', false, 'internal-test-secret'), true);
});
