import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
    ['data-dshpw-mobile-nav-open', true],
    ['data-dshpw-mobile-nav-open', false],
  ]);
});

test('mobile navigation includes drawer, safe-area and touch affordances', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  const mobileSource = readFileSync(new URL('../src/client/mobile.tsx', import.meta.url), 'utf8');
  const chatSource = readFileSync(new URL('../src/client/chat.tsx', import.meta.url), 'utf8');
  assert.match(mobileSource, /viewport-fit=cover/);
  assert.match(source, /safe-area-inset-top/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /touch-action:manipulation/);
  assert.match(source, /overflow-y:auto/);
  assert.match(source, /data-dshpw-mobile-nav-open/);
  assert.match(chatSource, /dshpw-chat-fab\{[^}]*safe-area-inset-left/);
  assert.match(chatSource, /dshpw-chat-close\{width:44px;height:44px/);
});
