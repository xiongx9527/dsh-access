import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('settings card has account and remote tabs while keeping gateway port in the shared area', () => {
  const source = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  const tabs = source.indexOf("className: 'dshpw-tabs'");
  const port = source.indexOf("t('gatewayPort')");
  const password = source.indexOf("t('chgPw')");
  assert.ok(port >= 0 && tabs > port && password > tabs);
  assert.match(source, /useState<'account' \| 'remote'>\('account'\)/);
  assert.match(source, /t\('accountTab'\)/);
  assert.match(source, /t\('remoteTab'\)/);
  assert.match(source, /setActiveTab\('remote'\)/);
  assert.match(source, /setRemoteRefreshKey/);
});

test('remote access panel exposes LAN QR, copy and Cloudflare tunnel controls', () => {
  const source = readFileSync(new URL('../src/client/remote-access.tsx', import.meta.url), 'utf8');
  assert.match(source, /remote-access\/status/);
  assert.match(source, /remote-access\/tunnel\/\$\{start \? 'start' : 'stop'\}/);
  assert.match(source, /status\.lanQr/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /role: 'switch'/);
});
