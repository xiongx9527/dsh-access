import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTryCloudflareUrl } from '../src/tunnel.js';

test('extractTryCloudflareUrl accepts only trycloudflare HTTPS URLs', () => {
  assert.equal(
    extractTryCloudflareUrl('INF Your quick Tunnel has been created! Visit it at https://quiet-river-92.trycloudflare.com'),
    'https://quiet-river-92.trycloudflare.com',
  );
  assert.equal(extractTryCloudflareUrl('http://quiet-river-92.trycloudflare.com'), null);
  assert.equal(extractTryCloudflareUrl('https://example.com'), null);
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CloudflaredTunnel } from '../src/tunnel.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = null;
  stdio = [null, this.stdout, this.stderr];
  pid = 123;
  connected = false;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed = true;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
}

test('concurrent tunnel starts share one cloudflared process and stop clears public state', async () => {
  const child = new FakeChild();
  let spawns = 0;
  const tunnel = new CloudflaredTunnel({
    home: '/tmp/dshpw-tunnel-test',
    ensureExecutable: async () => '/fake/cloudflared',
    spawnProcess: (() => { spawns += 1; return child; }) as never,
    now: () => 456,
  });
  const first = tunnel.start('http://127.0.0.1:3088');
  const second = tunnel.start('http://127.0.0.1:3088');
  await new Promise((resolve) => setTimeout(resolve, 0));
  child.stderr.write('INF https://unit-test.trycloudflare.com');
  const [a, b] = await Promise.all([first, second]);
  assert.equal(spawns, 1);
  assert.equal(a.url, 'https://unit-test.trycloudflare.com');
  assert.deepEqual(a, b);
  assert.equal(a.startedAt, 456);
  const stopped = await tunnel.stop();
  assert.equal(child.killed, true);
  assert.equal(stopped.phase, 'idle');
  assert.equal(stopped.url, null);
});

test('stopping during cloudflared preparation cancels the pending launch', async () => {
  let release!: (value: string) => void;
  const executable = new Promise<string>((resolve) => { release = resolve; });
  let spawns = 0;
  const tunnel = new CloudflaredTunnel({
    home: '/tmp/dshpw-tunnel-cancel',
    ensureExecutable: async () => executable,
    spawnProcess: (() => { spawns += 1; return new FakeChild(); }) as never,
  });
  const starting = tunnel.start('http://127.0.0.1:3088');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tunnel.stop();
  release('/fake/cloudflared');
  await assert.rejects(starting, /cancelled/);
  assert.equal(spawns, 0);
  assert.equal(tunnel.snapshot().phase, 'idle');
});
