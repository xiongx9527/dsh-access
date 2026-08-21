import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCloudflared, extractTryCloudflareUrl, cloudflaredDownloadUrls, isSafeArchiveEntry, releaseAsset, streamDownloadToFile, withCloudflaredDownload } from '../src/tunnel.js';

const FAKE_CLOUDFLARED = process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n';

test('cloudflared archives reject absolute and parent-traversing entries', () => {
  for (const entry of ['/tmp/cloudflared', '../cloudflared', 'dir/../../cloudflared', 'C:/cloudflared.exe', 'dir\\..\\cloudflared']) {
    assert.equal(isSafeArchiveEntry(entry), false, entry);
  }
  assert.equal(isSafeArchiveEntry('cloudflared'), true);
  assert.equal(isSafeArchiveEntry('cloudflared/2026/bin/cloudflared'), true);
});

test('archive entries stay inside the extraction directory', () => {
  assert.equal(isSafeArchiveEntry('cloudflared'), true);
  assert.equal(isSafeArchiveEntry('nested/cloudflared'), true);
  assert.equal(isSafeArchiveEntry('../escape'), false);
  assert.equal(isSafeArchiveEntry('/absolute'), false);
  assert.equal(isSafeArchiveEntry('nested/../../escape'), false);
});

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
  writeFileSync(source, FAKE_CLOUDFLARED);
  if (process.platform !== 'win32') chmodSync(source, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = '';
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), FAKE_CLOUDFLARED);
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
  writeFileSync(join(cacheDir, asset), FAKE_CLOUDFLARED);
  const pathBinary = join(pathDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  writeFileSync(pathBinary, FAKE_CLOUDFLARED);
  if (process.platform !== 'win32') chmodSync(pathBinary, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), FAKE_CLOUDFLARED);
  } finally {
    process.env.PATH = previous;
  }
});

test('an executable PATH entry that fails validation does not shadow a valid cache', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX shell fixture is not applicable');
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-path-broken-'));
  const cacheDir = join(root, 'remote-access', 'bin');
  const pathDir = join(root, 'path');
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(pathDir, { recursive: true });
  const asset = releaseAsset().name.replace(/\.tgz$/i, '');
  writeFileSync(join(cacheDir, asset), FAKE_CLOUDFLARED, { mode: 0o700 });
  writeFileSync(join(pathDir, 'cloudflared'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), FAKE_CLOUDFLARED);
  } finally {
    process.env.PATH = previous;
  }
});

test('non-executable PATH entries do not shadow a valid executable cache', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable permissions are not applicable');
  const root = mkdtempSync(join(tmpdir(), 'dshpw-cloudflared-path-invalid-'));
  const cacheDir = join(root, 'remote-access', 'bin');
  const pathDir = join(root, 'path');
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(pathDir, { recursive: true });
  const asset = releaseAsset().name.replace(/\.tgz$/i, '');
  writeFileSync(join(cacheDir, asset), FAKE_CLOUDFLARED, { mode: 0o700 });
  const pathBinary = join(pathDir, 'cloudflared');
  writeFileSync(pathBinary, 'not executable', { mode: 0o600 });
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(root);
    assert.equal(readFileSync(resolved, 'utf8'), FAKE_CLOUDFLARED);
  } finally {
    process.env.PATH = previous;
  }
});

test('cloudflared response streams to a temporary file and rejects undersized payloads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-access-stream-download-'));
  const good = join(root, 'good.download');
  const bytes = new Uint8Array(1024 * 1024 + 1).fill(7);
  assert.equal(await streamDownloadToFile(new Response(bytes), good), bytes.length);
  assert.equal(readFileSync(good).length, bytes.length);
  const small = join(root, 'small.download');
  await assert.rejects(streamDownloadToFile(new Response('error page'), small), /small/i);
  assert.equal(existsSync(small), false);
});

test('concurrent cloudflared downloads for one home share one transaction', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => { calls += 1; await gate; return '/tmp/cloudflared'; };
  const first = withCloudflaredDownload('/tmp/one-home', operation);
  const second = withCloudflaredDownload('/tmp/one-home', operation);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['/tmp/cloudflared', '/tmp/cloudflared']);
  assert.equal(calls, 1);
});

test('a later singleflight caller can cancel its own wait', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => { calls += 1; await gate; return '/tmp/cloudflared'; };
  const first = withCloudflaredDownload('/tmp/cancellable-home', operation);
  const controller = new AbortController();
  const second = withCloudflaredDownload('/tmp/cancellable-home', operation, controller.signal);
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(second, /caller cancelled/);
  release();
  assert.equal(await first, '/tmp/cloudflared');
  assert.equal(calls, 1);
});

test('aborting the first singleflight caller does not cancel a later active waiter', async () => {
  let release!: () => void;
  let sharedAborted = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async (signal: AbortSignal) => {
    signal.addEventListener('abort', () => { sharedAborted = true; }, { once: true });
    await gate;
    return '/tmp/cloudflared';
  };
  const firstController = new AbortController();
  const first = withCloudflaredDownload('/tmp/first-cancellable-home', operation, firstController.signal);
  const second = withCloudflaredDownload('/tmp/first-cancellable-home', operation);
  firstController.abort(new Error('first caller cancelled'));
  await assert.rejects(first, /first caller cancelled/);
  assert.equal(sharedAborted, false);
  release();
  assert.equal(await second, '/tmp/cloudflared');
});

test('verified cache replacement does not move the canonical executable away first', () => {
  const tunnelSource = readFileSync(new URL('../src/tunnel.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(tunnelSource, /renameSync\(executable, backup\)/);
  assert.match(tunnelSource, /renameSync\(candidate, executable\)/);
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
    home: '/tmp/dsh-access-tunnel-test',
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

test('stopping during cloudflared preparation aborts the pending download', async () => {
  let observedSignal: AbortSignal | null = null;
  let spawns = 0;
  const tunnel = new CloudflaredTunnel({
    home: '/tmp/dsh-access-tunnel-cancel',
    ensureExecutable: async (_home, signal) => {
      observedSignal = signal;
      return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    spawnProcess: (() => { spawns += 1; return new FakeChild(); }) as never,
  });
  const starting = tunnel.start('http://127.0.0.1:3088');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tunnel.stop();
  await assert.rejects(starting);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(spawns, 0);
  assert.equal(tunnel.snapshot().phase, 'idle');
});

import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCloudflared } from '../src/tunnel.js';

test('ensureCloudflared copies a PATH binary into the Access management data directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-access-cloudflared-'));
  const pathDir = join(root, 'path');
  const home = join(root, 'home');
  mkdirSync(pathDir, { recursive: true });
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const source = join(pathDir, name);
  writeFileSync(source, FAKE_CLOUDFLARED);
  if (process.platform !== 'win32') chmodSync(source, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = pathDir;
  try {
    const resolved = await ensureCloudflared(home);
    assert.equal(resolved, join(home, 'remote-access', 'bin', name));
    assert.equal(readFileSync(resolved, 'utf8'), FAKE_CLOUDFLARED);
  } finally {
    process.env.PATH = previous;
  }
});
