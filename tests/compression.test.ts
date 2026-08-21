import assert from 'node:assert/strict';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compressResponseBody, headersForRewrittenBody, requestedCompression, shouldBufferForCompression, shouldRewriteHtmlResponse } from '../src/gateway.js';

const body = Buffer.from(JSON.stringify({ values: Array.from({ length: 700 }, (_, index) => ({ index, value: 'repeatable remote response payload' })) }), 'utf8');

function request(acceptEncoding: string) {
  return { headers: { 'accept-encoding': acceptEncoding } } as never;
}

test('compression negotiates Brotli before gzip and preserves a decodable body', () => {
  assert.equal(requestedCompression(request('gzip, br')), 'br');
  const result = compressResponseBody(request('gzip, br'), { 'content-type': 'application/json' }, body);
  assert.equal(result.headers['content-encoding'], 'br');
  assert.deepEqual(brotliDecompressSync(result.body), body);
  assert.match(String(result.headers.vary), /Accept-Encoding/);
});

test('compression falls back to gzip when Brotli is not accepted', () => {
  assert.equal(requestedCompression(request('gzip')), 'gzip');
  const result = compressResponseBody(request('gzip'), { 'content-type': 'application/json' }, body);
  assert.equal(result.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(result.body), body);
});

test('compression skips SSE, existing encodings and small responses', () => {
  assert.equal(shouldBufferForCompression(request('br, gzip'), { 'content-type': 'text/event-stream' }), false);
  assert.equal(shouldBufferForCompression(request('br, gzip'), { 'content-type': 'application/json', 'content-encoding': 'gzip' }), false);
  const small = Buffer.from('{}');
  const result = compressResponseBody(request('br, gzip'), { 'content-type': 'application/json' }, small);
  assert.equal(result.headers['content-encoding'], undefined);
  assert.deepEqual(result.body, small);
});

test('rewritten bodies never retain transfer-encoding beside content-length', () => {
  const result = compressResponseBody(
    request('gzip'),
    { 'content-type': 'application/json', 'transfer-encoding': 'chunked', 'content-length': '999' },
    Buffer.from('{}'),
  );
  assert.equal(result.headers['content-length'], '2');
  assert.equal(result.headers['transfer-encoding'], undefined);
});

test('raw and download file responses remain byte faithful even when they contain HTML', () => {
  assert.equal(shouldRewriteHtmlResponse('GET', '/aionui-panel/raw', 'text/html'), false);
  assert.equal(shouldRewriteHtmlResponse('GET', '/api/dsh-uploads/download', 'text/html'), false);
  assert.equal(shouldRewriteHtmlResponse('GET', '/', 'text/html'), true);
});

test('rewritten response headers remove all stale body framing and encoding', () => {
  const result = headersForRewrittenBody({
    'content-length': '999',
    'transfer-encoding': 'chunked',
    'content-encoding': 'gzip',
    'content-type': 'text/html',
  });
  assert.equal(result['content-length'], undefined);
  assert.equal(result['transfer-encoding'], undefined);
  assert.equal(result['content-encoding'], undefined);
  assert.equal(result['content-type'], 'text/html');
});

test('compression honors q=0 exclusions', () => {
  assert.equal(requestedCompression(request('br;q=0, gzip;q=0.8')), 'gzip');
  assert.equal(requestedCompression(request('br;q=0, gzip;q=0')), null);
});
