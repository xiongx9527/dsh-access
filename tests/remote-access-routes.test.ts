import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('plugin exposes admin-guarded remote access routes and refreshes service after port restart', () => {
  const source = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  for (const path of [
    '/api/dsh-access/remote-access/status',
    '/api/dsh-access/remote-access/tunnel/start',
    '/api/dsh-access/remote-access/tunnel/stop',
  ]) assert.match(source, new RegExp(path.replaceAll('/', '\\/')));
  assert.match(source, /const requireAdmin =/);
  assert.match(source, /caller\.role !== 'admin'/);
  assert.match(source, /remoteAccess\.startTunnel\(\)/);
  assert.match(source, /remoteAccess\.stopTunnel\(\)/);
  assert.match(source, /await remoteAccess\.setGatewayPort\(port\)/);
});

test('gateway returns JSON 401 for unauthenticated remote access APIs instead of a login redirect', () => {
  const source = readFileSync(new URL('../src/gateway.ts', import.meta.url), 'utf8');
  assert.match(source, /parsed\.pathname\.startsWith\('\/api\/dsh-access\/remote-access\/'\)/);
  assert.match(source, /status\(401\)\.json\(\{ ok: false, code: 'NOT_AUTHENTICATED'/);
});
