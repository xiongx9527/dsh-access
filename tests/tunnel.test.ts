import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCloudflared, extractTryCloudflareUrl, cloudflaredDownloadUrls, releaseAsset } from '../src/tunnel.js';

test('extractTryCloudflareUrl accepts only trycloudflare HTTPS URLs', () => {
  assert.equal(
    extractTryCloudflareUrl('INF Your quick Tunnel has been created! Visit it at https://quiet-river-92.trycloudflare.com'),
    'https://quiet-river-92.trycloudflare.com',
  );
  assert.equal(extractTryCloudflareUrl('http://quiet-river-92.trycloudflare.com'), null);
  assert.equal(extractTryCloudflareUrl('https://example.com'), null);
});

test('cloudflared download URLs keep the official source and accept configured HTTPS mirrors', () => {
  const previous = process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS;
  process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS = 'https://mirror.example/cloudflared, http://ignored.example';
  try {
    const urls = cloudflaredDownloadUrls(releaseAsset().name);
    assert.equal(urls[0].startsWith('https://github.com/cloudflare/cloudflared/'), true);
    assert.equal(urls.some((url) => url.startsWith('https://mirror.example/cloudflared/')), true);
    assert.equal(urls.some((url) => url.includes('ignored.example')), false);
  } finally {
    if (previous === undefined) delete process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS;
    else process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS = previous;
  }
});

test('ensureCloudflared accepts a platform asset-name cache file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-asset-'));
  const directory = join(root, 'remote-access', 'bin');
  mkdirSync(directory, { recursive: true });
  const asset = releaseAsset().name.replace(/\.tgz$/i, '');
  const source = join(directory, asset);
  writeFileSync(source, 'cached-asset');
  if (process.platform !== 'win32') chmodSync(source, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = '';
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), 'cached-asset');
  } finally {
    process.env.PATH = previous;
  }
});

test('ensureCloudflared prefers an explicit PATH binary over a stale cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-path-priority-'));
  const cacheDir = join(root, 'remote-access', 'bin');
  const pathDir = join(root, 'path');
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(pathDir, { recursive: true });
  const asset = releaseAsset().name.replace(/\.tgz$/i, '');
  writeFileSync(join(cacheDir, asset), 'stale-cache');
  const pathBinary = join(pathDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  writeFileSync(pathBinary, 'explicit-path');
  if (process.platform !== 'win32') chmodSync(pathBinary, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), 'explicit-path');
  } finally {
    process.env.PATH = previous;
  }
});

test('cloudflared download failures do not expose mirror query secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-secret-'));
  const previousPath = process.env.PATH;
  const previousMirrors = process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS;
  const previousFetch = globalThis.fetch;
  process.env.PATH = '';
  process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS = 'https://mirror.example/download?token=SECRET_TOKEN';
  globalThis.fetch = (async () => { throw new Error('network unavailable'); }) as typeof fetch;
  try {
    await assert.rejects(ensureCloudflared(root), (error: unknown) => {
      if (!(error instanceof Error)) return false;
      return !error.message.includes('SECRET_TOKEN') && !error.message.includes('mirror.example');
    });
  } finally {
    process.env.PATH = previousPath;
    if (previousMirrors === undefined) delete process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS;
    else process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS = previousMirrors;
    globalThis.fetch = previousFetch;
  }
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
  let args: string[] = [];
  const tunnel = new CloudflaredTunnel({
    home: '/tmp/dshpw-tunnel-test',
    ensureExecutable: async () => '/fake/cloudflared',
    spawnProcess: ((_file, spawnArgs) => { spawns += 1; args = [...spawnArgs]; return child; }) as never,
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
  assert.deepEqual(args, ['tunnel', '--url', 'http://127.0.0.1:3088', '--protocol', 'http2', '--no-autoupdate']);
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

import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCloudflared } from '../src/tunnel.js';

test('ensureCloudflared copies a PATH binary into the Access management data directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-'));
  const pathDir = join(root, 'path');
  const home = join(root, 'home');
  mkdirSync(pathDir, { recursive: true });
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const source = join(pathDir, name);
  writeFileSync(source, 'fake-cloudflared');
  if (process.platform !== 'win32') chmodSync(source, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(home);
    assert.equal(resolved, join(home, 'remote-access', 'bin', name));
    assert.equal(readFileSync(resolved, 'utf8'), 'fake-cloudflared');
  } finally {
    process.env.PATH = previous;
  }
});
