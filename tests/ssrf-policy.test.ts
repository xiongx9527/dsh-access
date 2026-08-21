import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateHost, isSshHostAllowed, sshHostRequestAllowed } from '../src/ssrf-policy.js';

test('private IPv4 and inet_aton variants are rejected', () => {
  for (const host of ['127.0.0.1', '0177.0.0.1', '0x7f.0.0.1', '2130706433', '127.1', '169.254.169.254', '10.0.0.1:22']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  assert.equal(isPrivateHost('8.8.8.8'), false);
});

test('private IPv6 mapped compatible and NAT64 forms are rejected', () => {
  for (const host of ['::', '::1', '[::1]:22', 'fc00::1', 'fe80::1%eth0', '::ffff:127.0.0.1', '::127.0.0.1', '64:ff9b::7f00:1']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  assert.equal(isPrivateHost('2606:4700:4700::1111'), false);
});

test('hostname resolution fails closed and rejects any private answer', async () => {
  assert.equal(await isSshHostAllowed('public.test', async () => ['8.8.8.8', '1.1.1.1']), true);
  assert.equal(await isSshHostAllowed('mixed.test', async () => ['8.8.8.8', '127.0.0.1']), false);
  assert.equal(await isSshHostAllowed('missing.test', async () => { throw new Error('ENOTFOUND'); }), false);
  assert.equal(await isSshHostAllowed('empty.test', async () => []), false);
});

test('only dsh-ssh host mutations invoke SSRF resolution', async () => {
  let calls = 0;
  const resolve = async () => { calls += 1; return ['8.8.8.8']; };
  assert.equal(await sshHostRequestAllowed('POST', '/api/dsh-ssh/hosts', { host: 'public.test' }, resolve), true);
  assert.equal(calls, 1);
  assert.equal(await sshHostRequestAllowed('GET', '/api/dsh-ssh/hosts', { host: '127.0.0.1' }, resolve), true);
  assert.equal(await sshHostRequestAllowed('POST', '/api/session.prompt', { host: '127.0.0.1' }, resolve), true);
  assert.equal(await sshHostRequestAllowed('PATCH', '/api/dsh-ssh/hosts/one', { host: '127.0.0.1' }, resolve), false);
  assert.equal(await sshHostRequestAllowed('POST', '/api/dsh-ssh/test', { alias: 'saved' }, resolve), true);
});
