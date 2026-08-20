import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseGatewayHost,
  parseGatewayPort,
  replaceEnvSetting,
  writeGatewayConfig,
  writeGatewayPort,
} from '../src/gateway-settings.js';

test('gateway host accepts loopback, all-interfaces and verified local addresses', () => {
  assert.equal(parseGatewayHost('127.0.0.1', ['192.168.1.10']), '127.0.0.1');
  assert.equal(parseGatewayHost('0.0.0.0', ['192.168.1.10']), '0.0.0.0');
  assert.equal(parseGatewayHost('192.168.1.10', ['192.168.1.10']), '192.168.1.10');
  assert.throws(() => parseGatewayHost('192.168.1.11', ['192.168.1.10']), /local/i);
  assert.throws(() => parseGatewayHost('example.com', ['192.168.1.10']), /IP|host/i);
});

test('gateway host and port are persisted atomically without changing other env values', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-access-gateway-config-'));
  const envPath = path.join(root, '.env');
  try {
    writeFileSync(envPath, 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3088\nMCP_GATEWAY_HOST=0.0.0.0\n', 'utf8');
    const previous = writeGatewayConfig(envPath, { port: 3090, host: '192.168.1.10' });
    assert.match(previous, /MCP_GATEWAY_PORT=3088/);
    assert.match(previous, /MCP_GATEWAY_HOST=0\.0\.0\.0/);
    assert.equal(readFileSync(envPath, 'utf8'), 'SETUP_KEY=secret\nMCP_GATEWAY_PORT=3090\nMCP_GATEWAY_HOST=192.168.1.10\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
