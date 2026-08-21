import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGatewayRequestTarget } from '../src/gateway-path.js';

test('canonical dsh-access gateway routes remain available for owned methods', () => {
  for (const path of [
    '/gateway/login', '/gateway/logout', '/gateway/api/me',
    '/gateway/api/messages/stream', '/gateway/internal/health',
  ]) assert.equal(classifyGatewayRequestTarget('GET', path), 'gateway');
  assert.equal(classifyGatewayRequestTarget('POST', '/gateway/setup'), 'gateway');
  assert.equal(classifyGatewayRequestTarget('POST', '/gateway/api/messages'), 'gateway');
  assert.equal(classifyGatewayRequestTarget('DELETE', '/gateway/api/users/42'), 'gateway');
  assert.equal(classifyGatewayRequestTarget('GET', '/api/session.list'), 'upstream');
});

test('encoded and flattened gateway paths fail closed', () => {
  for (const path of [
    '/gateway%2Fapi%2Fme', '/gateway%252Fapi%252Fme', '/gateway//api/me',
    '/gateway/..%2Fapi/session.list', '/%67ateway/api/me',
    'http://example.test/gateway%2Flogin?next=x',
    'http://example.test/gateway/%2e%2e/api/session.list',
    'http://example.test/gateway/../api/session.list',
    'http://example.test\\gateway\\..\\api/session.list',
    '/gateway\\..\\api/session.list',
    'http:////x\\gateway\\..\\api/session.list',
    '//x\\gateway\\..\\api/session.list',
    '//x\\%67ateway\\..\\api/session.list',
    'http:////x\\%67ateway\\..\\api/session.list',
    '//x/gateway/../api/session.list',
    '/%67ateway/%zz/../../api/session.list',
    '//x/%2567ateway/%zz/../../api/session.list',
    '//x/%67ateway/%E0%A4%A/../../api/session.list',
    '/%2525252567ateway/../api/session.list',
    '/Gateway/../api/session.list',
    '/Gateway/anything',
    '/gateway%zz/../api/session.list',
    'ftp://evil/gateway/../api/session.list',
    'ftp:/gateway/../api/session.list',
    'http:/gateway/../api/session.list',
    '/./gateway/../api/session.list',
    '/foo/../gateway/../api/session.list',
    '/%2fgateway/../api/session.list',
    'http://host//gateway/../api/session.list',
    '/gateway%00/../api/session.list',
    '/gateway%09/../api/session.list',
    '/gateway%1f/../api/session.list',
    '/gateway%7f/../api/session.list',
    '/gateway%2509/../api/session.list',
    '/foo/../gateway%09/../api/session.list',
    'http://host/gateway%09/../api/session.list',
  ]) assert.equal(classifyGatewayRequestTarget('GET', path), 'reject', path);
});

test('absolute-form query and fragment slashes do not become the request pathname', () => {
  assert.equal(classifyGatewayRequestTarget('GET', 'http://example.test?next=/gateway/login'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', 'http://example.test#next=/gateway/login'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/api/foo%zz'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/api/%E0%A4%A'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/api/%2525252525252525252525252525252566oo'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway%2Dguide'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway%20guide'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway%23guide'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway%3Fguide'), 'upstream');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway%25guide'), 'upstream');
});

test('ASCII controls cannot obscure any part of the gateway namespace', () => {
  for (const code of [...Array.from({ length: 32 }, (_, value) => value), 0x7f]) {
    const escape = `%${code.toString(16).padStart(2, '0')}`;
    for (let index = 0; index <= 'gateway'.length; index += 1) {
      const obscured = `${'gateway'.slice(0, index)}${escape}${'gateway'.slice(index)}`;
      assert.equal(classifyGatewayRequestTarget('GET', `/${obscured}/../api/session.list`), 'reject');
      assert.equal(classifyGatewayRequestTarget('GET', `/${obscured}%zz/../api/session.list`), 'reject');
      assert.equal(classifyGatewayRequestTarget('GET', `/${obscured}%80/../api/session.list`), 'reject');
      assert.equal(classifyGatewayRequestTarget('GET', `/${obscured}%2580/../api/session.list`), 'reject');
      assert.equal(classifyGatewayRequestTarget('GET', `/${obscured}%25c2/../api/session.list`), 'reject');
    }
  }
});

test('unknown canonical gateway routes cannot fall through to the upstream SPA', () => {
  for (const path of [
    '/gateway/api/dsh-ssh/hosts', '/gateway/api/not-a-route',
    '/gateway/internal/not-a-route', '/gateway/anything',
  ]) assert.equal(classifyGatewayRequestTarget('GET', path), 'reject', path);
});

test('malformed request targets fail closed when they claim the gateway namespace', () => {
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway/%zz'), 'reject');
});

test('known gateway paths reject methods without an owned handler', () => {
  assert.equal(classifyGatewayRequestTarget('PUT', '/gateway/api/me'), 'reject');
  assert.equal(classifyGatewayRequestTarget('GET', '/gateway/api/logout'), 'reject');
  assert.equal(classifyGatewayRequestTarget('POST', '/gateway/logout'), 'reject');
});
