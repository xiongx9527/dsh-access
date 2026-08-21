import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGatewayPath } from '../src/gateway-path.js';

test('canonical dsh-access gateway routes remain available', () => {
  for (const path of [
    '/gateway/login', '/gateway/setup', '/gateway/logout',
    '/gateway/api/me', '/gateway/api/users/42', '/gateway/api/messages/stream',
    '/gateway/internal/health',
  ]) assert.equal(classifyGatewayPath(path), 'gateway');
  assert.equal(classifyGatewayPath('/api/session.list'), 'upstream');
});

test('encoded and flattened gateway paths fail closed', () => {
  for (const path of [
    '/gateway%2Fapi%2Fme',
    '/gateway%252Fapi%252Fme',
    '/gateway//api/me',
    '/gateway/..%2Fapi/session.list',
    '/%67ateway/api/me',
    'http://example.test/gateway%2Flogin?next=x',
  ]) assert.equal(classifyGatewayPath(path), 'reject', path);
});

test('unknown canonical gateway routes cannot fall through to the upstream SPA', () => {
  for (const path of [
    '/gateway/api/dsh-ssh/hosts',
    '/gateway/api/not-a-route',
    '/gateway/internal/not-a-route',
    '/gateway/anything',
  ]) assert.equal(classifyGatewayPath(path), 'reject', path);
});

test('malformed request targets fail closed when they claim the gateway namespace', () => {
  assert.equal(classifyGatewayPath('/gateway/%zz'), 'reject');
});
