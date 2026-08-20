import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/gateway.ts', import.meta.url), 'utf8');
const start = source.indexOf('const INJECT_SCRIPT =');
const end = source.indexOf('function readCookie', start);
const injection = source.slice(start, end);

test('gateway HTML injection keeps account revocation polling independent of the DSH client bundle', () => {
  assert.match(injection, /gateway\/api\/me/);
  assert.match(injection, /ACCOUNT_BANNED/);
  assert.match(injection, /ACCOUNT_DELETED/);
  assert.match(injection, /credential-changed/);
  assert.match(injection, /setInterval/);
});
