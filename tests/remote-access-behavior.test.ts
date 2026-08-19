import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteAccessAuthorization } from '../src/plugin.js';
import { isLanAccessAvailable, shouldPollTunnel, type RemoteAccessStatus } from '../src/client/remote-access.js';
import { setMobileNavigationOpen } from '../src/client/mobile.js';

const base: RemoteAccessStatus = {
  gatewayPort: 3088, gatewayRunning: true, lanIp: '192.168.1.199',
  lanUrl: 'http://192.168.1.199:3088', lanQr: 'data:image/png;base64,x',
  tunnel: { phase: 'idle', detail: '', url: null, qr: null, startedAt: null },
};

test('remote management requires an authenticated Admin and does not use local fallback', () => {
  assert.equal(remoteAccessAuthorization(null), 'unauthenticated');
  assert.equal(remoteAccessAuthorization(null, true), 'allowed');
  assert.equal(remoteAccessAuthorization({ userId: 2, username: 'guest', role: 'user' }), 'forbidden');
  assert.equal(remoteAccessAuthorization({ userId: 1, username: 'admin', role: 'admin' }), 'allowed');
});

test('LAN availability requires both a running gateway and a URL', () => {
  assert.equal(isLanAccessAvailable(base), true);
  assert.equal(isLanAccessAvailable({ ...base, gatewayRunning: false }), false);
  assert.equal(isLanAccessAvailable({ ...base, lanUrl: null }), false);
  assert.equal(isLanAccessAvailable(null), false);
});

test('client polls every non-idle tunnel phase including running and error', () => {
  for (const phase of ['downloading', 'starting', 'running', 'stopping', 'error'] as const) {
    assert.equal(shouldPollTunnel(phase), true);
  }
  assert.equal(shouldPollTunnel('idle'), false);
});

test('mobile navigation helper toggles the document marker', () => {
  const calls: Array<[string, boolean]> = [];
  setMobileNavigationOpen(true, { toggleAttribute: (name, force) => { calls.push([name, Boolean(force)]); return true; } });
  setMobileNavigationOpen(false, { toggleAttribute: (name, force) => { calls.push([name, Boolean(force)]); return false; } });
  assert.deepEqual(calls, [
    ['data-dsh-access-mobile-nav-open', true],
    ['data-dsh-access-mobile-nav-open', false],
  ]);
});
