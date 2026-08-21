import assert from 'node:assert/strict';
import test from 'node:test';
import { readCookie } from '../src/cookie.js';

test('readCookie strips only RFC 6265 ASCII OWS and preserves equals in values', () => {
  assert.equal(readCookie('\t dsh_gateway_token=header.payload=sig ; other=x', 'dsh_gateway_token'), 'header.payload=sig');
  assert.equal(readCookie('other=x; dsh_gateway_token=%E4%B8%AD%3Dvalue', 'dsh_gateway_token'), '中=value');
});

test('readCookie requires an exact name and rejects Unicode-whitespace disguises', () => {
  assert.equal(readCookie('dsh_gateway_token_evil=bad; dsh_gateway_token=good', 'dsh_gateway_token'), 'good');
  assert.equal(readCookie('\u00a0dsh_gateway_token=forged', 'dsh_gateway_token'), null);
  assert.equal(readCookie('dsh_gateway_token\u200b=forged', 'dsh_gateway_token'), null);
  assert.equal(readCookie('dsh_gateway_token', 'dsh_gateway_token'), null);
});

test('readCookie leaves malformed percent encoding for token validation to reject', () => {
  assert.equal(readCookie('dsh_gateway_token=%zz', 'dsh_gateway_token'), '%zz');
});
