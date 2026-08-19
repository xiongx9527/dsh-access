import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteAccessService, selectLanIPv4 } from '../src/remote-access.js';
import type { TunnelController, TunnelSnapshot } from '../src/tunnel.js';

function addr(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` };
}

class FakeTunnel implements TunnelController {
  target: string | null = null;
  stops = 0;
  state: TunnelSnapshot = { phase: 'idle', detail: '', url: null, startedAt: null };
  snapshot(): TunnelSnapshot { return { ...this.state }; }
  async start(targetUrl: string): Promise<TunnelSnapshot> {
    this.target = targetUrl;
    this.state = { phase: 'running', detail: '', url: 'https://unit.trycloudflare.com', startedAt: 123 };
    return this.snapshot();
  }
  async stop(): Promise<TunnelSnapshot> {
    this.stops += 1;
    this.state = { phase: 'idle', detail: '', url: null, startedAt: null };
    return this.snapshot();
  }
  async close(): Promise<void> { await this.stop(); }
}

test('selectLanIPv4 prefers a private physical interface over VPN and link-local addresses', () => {
  assert.equal(selectLanIPv4({
    utun4: [addr('10.8.0.2')],
    en0: [addr('192.168.1.199')],
    awdl0: [addr('169.254.10.3')],
    lo0: [addr('127.0.0.1', true)],
  }), '192.168.1.199');
});

test('selectLanIPv4 returns null when no usable IPv4 exists', () => {
  assert.equal(selectLanIPv4({ lo0: [addr('127.0.0.1', true)], en0: [addr('169.254.1.2')] }), null);
});

test('remote status and QR refresh when the gateway port changes', async () => {
  const tunnel = new FakeTunnel();
  const encoded: string[] = [];
  const service = new RemoteAccessService({
    gatewayPort: 3088,
    home: '/tmp/dshpw-test',
    tunnel,
    networkInterfacesFn: () => ({ en0: [addr('192.168.1.199')] }),
    qrEncoder: async (url) => { encoded.push(url); return `qr:${url}`; },
  });

  const before = await service.status(true);
  assert.equal(before.lanUrl, 'http://192.168.1.199:3088');
  assert.equal(before.lanQr, 'qr:http://192.168.1.199:3088');

  await service.startTunnel();
  assert.equal(tunnel.target, 'http://127.0.0.1:3088');
  await service.setGatewayPort(4090);
  const after = await service.status(true);
  assert.equal(tunnel.stops, 1);
  assert.equal(after.gatewayPort, 4090);
  assert.equal(after.lanUrl, 'http://192.168.1.199:4090');
  assert.equal(after.lanQr, 'qr:http://192.168.1.199:4090');
  assert.deepEqual(encoded, ['http://192.168.1.199:3088', 'https://unit.trycloudflare.com', 'http://192.168.1.199:4090']);
});

test('remote status exposes null LAN fields when no usable interface exists', async () => {
  const service = new RemoteAccessService({
    gatewayPort: 3088,
    home: '/tmp/dshpw-test',
    tunnel: new FakeTunnel(),
    networkInterfacesFn: () => ({ lo0: [addr('127.0.0.1', true)] }),
    qrEncoder: async (url) => `qr:${url}`,
  });
  const status = await service.status(false);
  assert.equal(status.gatewayRunning, false);
  assert.equal(status.lanIp, null);
  assert.equal(status.lanUrl, null);
  assert.equal(status.lanQr, null);
});

test('public tunnel intent restores after restart and explicit stop clears it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpw-restore-'));
  const service = new RemoteAccessService({
    gatewayPort: 3088,
    home: root,
    tunnel: new FakeTunnel(),
    networkInterfacesFn: () => ({ en0: [addr('192.168.1.199')] }),
    qrEncoder: async (url) => `qr:${url}`,
  });

  await service.startTunnel();
  assert.equal(existsSync(join(root, 'remote-access', 'tunnel-auto.json')), true);
  await service.close();

  const restoredTunnel = new FakeTunnel();
  const restored = new RemoteAccessService({
    gatewayPort: 3088,
    home: root,
    tunnel: restoredTunnel,
    networkInterfacesFn: () => ({ en0: [addr('192.168.1.199')] }),
    qrEncoder: async (url) => `qr:${url}`,
  });
  const snapshot = await restored.restoreTunnelIfNeeded(true);
  assert.equal(snapshot?.tunnel.phase, 'running');
  assert.equal(restoredTunnel.target, 'http://127.0.0.1:3088');
  await restored.stopTunnel();
  assert.equal(existsSync(join(root, 'remote-access', 'tunnel-auto.json')), false);
});
