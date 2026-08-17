import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function localAccess() {
  const loaded = await import('../src/local-access.js').catch(() => null);
  assert.ok(loaded, 'local-access module must exist');
  return loaded;
}

test('only a true direct loopback request may use the local admin fallback', async () => {
  const { isDirectLocalPluginRequest } = await localAccess();
  assert.equal(isDirectLocalPluginRequest({
    remoteAddress: '127.0.0.1', host: '127.0.0.1:3080', gatewayMarker: undefined,
  }), true);
  assert.equal(isDirectLocalPluginRequest({
    remoteAddress: '::1', host: 'localhost:3080', gatewayMarker: undefined,
  }), true);
  assert.equal(isDirectLocalPluginRequest({
    remoteAddress: '127.0.0.1', host: '127.0.0.1:3080', gatewayMarker: '1',
  }), false);
  assert.equal(isDirectLocalPluginRequest({
    remoteAddress: '192.168.1.10', host: '127.0.0.1:3080', gatewayMarker: undefined,
  }), false);
  assert.equal(isDirectLocalPluginRequest({
    remoteAddress: '127.0.0.1', host: 'example.test:3080', gatewayMarker: undefined,
  }), false);
});

test('gateway forwarding always overwrites its internal marker', async () => {
  const { GATEWAY_PROXY_HEADER, markGatewayProxyHeaders } = await localAccess();
  const headers: Record<string, string | string[] | undefined> = {
    [GATEWAY_PROXY_HEADER]: 'spoofed', host: '127.0.0.1:3088',
  };
  markGatewayProxyHeaders(headers);
  assert.equal(headers[GATEWAY_PROXY_HEADER], '1');
});

test('direct local access resolves the real admin while forwarded unauthenticated traffic stays denied', async () => {
  const { resolvePluginCaller } = await localAccess();
  const users = [
    { id: 1, username: 'admin', role: 'admin' as const },
    { id: 2, username: 'guest', role: 'user' as const },
  ];
  assert.deepEqual(resolvePluginCaller(null, true, users), {
    userId: 1, username: 'admin', role: 'admin',
  });
  assert.equal(resolvePluginCaller(null, false, users), null);
  assert.deepEqual(resolvePluginCaller({ userId: 2, username: 'guest', role: 'user' }, true, users), {
    userId: 2, username: 'guest', role: 'user',
  });
});

test('plugin guard and gateway proxy wire the shared local-access fence', () => {
  const pluginSource = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');
  const gatewaySource = readFileSync(new URL('../src/gateway.ts', import.meta.url), 'utf8');
  assert.match(pluginSource, /resolvePluginCaller\(/);
  assert.match(pluginSource, /isDirectLocalPluginRequest\(/);
  assert.match(gatewaySource, /markGatewayProxyHeaders\(headers\)/);
});
