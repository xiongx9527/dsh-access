import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('plugin exposes admin-guarded remote access routes and refreshes service after port restart', () => {
  const source = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  for (const path of [
    '/api/dsh-passwords/remote-access/status',
    '/api/dsh-passwords/remote-access/tunnel/start',
    '/api/dsh-passwords/remote-access/tunnel/stop',
  ]) assert.match(source, new RegExp(path.replaceAll('/', '\\/')));
  assert.match(source, /const requireAdmin =/);
  assert.match(source, /caller\.role !== 'admin'/);
  assert.match(source, /remoteAccess\.startTunnel\(\)/);
  assert.match(source, /remoteAccess\.stopTunnel\(\)/);
  assert.match(source, /await remoteAccess\.setGatewayPort\(port\)/);
});
