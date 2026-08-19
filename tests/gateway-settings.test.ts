import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseGatewayPort,
  replaceEnvSetting,
  writeGatewayPort,
} from '../src/gateway-settings.js';

test('gateway port accepts a free non-upstream TCP port', () => {
  assert.equal(parseGatewayPort(3088, 3080), 3088);
  assert.equal(parseGatewayPort('3090', 3080), 3090);
});

test('gateway port rejects invalid ranges, fractions and the DSH upstream port', () => {
  for (const value of [0, 65536, 3088.5, '', 'abc']) {
    assert.throws(() => parseGatewayPort(value, 3080));
  }
  assert.throws(() => parseGatewayPort(3080, 3080), /upstream/i);
});

test('gateway port replacement preserves unrelated env configuration', () => {
  const source = 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3088\nMCP_GATEWAY_HOST=0.0.0.0\n';
  assert.equal(
    replaceEnvSetting(source, 'MCP_GATEWAY_PORT', '3090'),
    'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3090\nMCP_GATEWAY_HOST=0.0.0.0\n',
  );
  assert.equal(
    replaceEnvSetting('SETUP_KEY=secret\n', 'MCP_GATEWAY_PORT', '3090'),
    'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3090\n',
  );
});

test('gateway port write is persisted without changing other env values', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-access-gateway-port-'));
  const envPath = path.join(root, '.env');
  try {
    writeFileSync(envPath, 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3088\n', 'utf8');
    const previous = writeGatewayPort(envPath, 3090);
    assert.equal(previous, 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3088\n');
    assert.equal(readFileSync(envPath, 'utf8'), 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3090\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
