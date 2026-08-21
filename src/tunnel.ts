import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { delimiter, join } from 'node:path';

export type TunnelPhase = 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';

export interface TunnelSnapshot {
  phase: TunnelPhase;
  detail: string;
  url: string | null;
  startedAt: number | null;
}

export interface TunnelController {
  snapshot(): TunnelSnapshot;
  start(targetUrl: string): Promise<TunnelSnapshot>;
  stop(): Promise<TunnelSnapshot>;
  close(): Promise<void>;
}

export function extractTryCloudflareUrl(text: string): string | null {
  return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0] ?? null;
}

function executableName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function executableOnPath(): string | null {
  const names = [executableName()];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

export function releaseAsset(): { name: string; archive: boolean } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'darwin') return { name: `cloudflared-darwin-${arch}.tgz`, archive: true };
  if (process.platform === 'linux') return { name: `cloudflared-linux-${arch}`, archive: false };
  if (process.platform === 'win32' && arch === 'amd64') return { name: 'cloudflared-windows-amd64.exe', archive: false };
  throw new Error(`unsupported cloudflared platform: ${process.platform}/${process.arch}`);
}

/**
 * Download sources are intentionally configurable.  The official Cloudflare
 * release remains the default; deployments with restricted GitHub access can
 * provide comma-separated HTTPS mirrors through DSH_ACCESS_CLOUDFLARED_MIRRORS.
 */
export function cloudflaredDownloadUrls(assetName: string): string[] {
  const official = `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName}`;
  const configured = (process.env.DSH_ACCESS_CLOUDFLARED_MIRRORS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map((base) => `${base.replace(/\/$/, '')}/${assetName}`)
    .filter((url) => /^https:\/\//i.test(url));
  return [...new Set([official, ...configured])];
}

function isUsableFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(file: string): boolean {
  if (!isUsableFile(file)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function waitForProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

export function isSafeArchiveEntry(entry: string): boolean {
  if (!entry || entry.includes('\\') || entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false;
  return !entry.split('/').some((segment) => segment === '..');
}

async function runTar(args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* already exited */ } };
  signal.addEventListener('abort', onAbort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  }).finally(() => signal.removeEventListener('abort', onAbort));
  signal.throwIfAborted();
  if (child.exitCode !== 0) throw new Error(`cloudflared archive failed: ${Buffer.concat(stderr).toString('utf8').trim()}`);
  return Buffer.concat(stdout).toString('utf8');
}

async function extractTarGz(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  const entries = (await runTar(['-tzf', archive], signal)).split(/\r?\n/).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !isSafeArchiveEntry(entry))) {
    throw new Error('cloudflared archive contains an unsafe entry');
  }
  await runTar(['-xzf', archive, '-C', destination], signal);
}

const MIN_CLOUDFLARED_BYTES = 1024 * 1024;
interface SharedDownload {
  promise: Promise<string>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
}

const downloads = new Map<string, SharedDownload>();

export async function streamDownloadToFile(response: Response, destination: string): Promise<number> {
  if (!response.ok || response.body === null) throw new Error(`cloudflared download HTTP ${String(response.status)}`);
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination, { mode: 0o600 }));
    const size = statSync(destination).size;
    if (size < MIN_CLOUDFLARED_BYTES) throw new Error(`cloudflared download is too small (${String(size)} bytes)`);
    return size;
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
}

function waitWithCallerCancellation(shared: SharedDownload, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  shared.waiters += 1;
  return new Promise<string>((resolve, reject) => {
    let waiting = true;
    const finish = (callback: () => void) => {
      if (!waiting) return;
      waiting = false;
      signal?.removeEventListener('abort', onAbort);
      shared.waiters -= 1;
      callback();
      if (!shared.settled && shared.waiters === 0) shared.controller.abort(new Error('cloudflared download cancelled'));
    };
    const onAbort = () => finish(() => reject(signal?.reason));
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function withCloudflaredDownload(
  home: string,
  operation: (signal: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let shared = downloads.get(home);
  if (shared?.controller.signal.aborted) {
    downloads.delete(home);
    shared = undefined;
  }
  if (!shared) {
    const controller = new AbortController();
    const created: SharedDownload = { promise: Promise.resolve(''), controller, waiters: 0, settled: false };
    created.promise = operation(controller.signal).finally(() => {
      created.settled = true;
      if (downloads.get(home) === created) downloads.delete(home);
    });
    downloads.set(home, created);
    shared = created;
  }
  return waitWithCallerCancellation(shared, signal);
}

async function verifyDownloadedExecutable(file: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!isExecutableFile(file)) throw new Error('cloudflared download did not produce an executable file');
  const child = spawn(file, ['--version'], { stdio: 'ignore' });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* already exited */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error('cloudflared executable probe timed out'));
    }, 5000);
    timer.unref();
    child.once('error', reject);
    child.once('exit', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, signal: exitSignal });
    });
  });
  signal?.throwIfAborted();
  if (result.code !== 0 || result.signal !== null) {
    throw new Error('cloudflared executable probe failed');
  }
}

function findExtractedBinary(directoryPath: string): string | null {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const child = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findExtractedBinary(child);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === executableName()) return child;
  }
  return null;
}

function replaceExecutable(candidate: string, executable: string): void {
  // POSIX rename replaces an existing destination atomically, so the canonical
  // path always names either the previous verified binary or the new one.
  renameSync(candidate, executable);
}

async function ensureCloudflaredOnce(home: string, signal?: AbortSignal): Promise<string> {
  const directory = join(home, 'remote-access', 'bin');
  const executable = join(directory, executableName());
  const asset = releaseAsset();
  const assetName = asset.name.replace(/\.tgz$/i, '').replace(/\.exe$/i, '');
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  // PATH is the operator's explicit installation and takes precedence over a
  // stale cached binary from an older dsh-access run.
  const fromPath = executableOnPath();
  if (fromPath) {
    const staged = join(directory, `.cloudflared-path-${process.pid}-${Date.now()}`);
    try {
      await verifyDownloadedExecutable(fromPath);
      copyFileSync(fromPath, staged);
      if (process.platform !== 'win32') chmodSync(staged, 0o700);
      await verifyDownloadedExecutable(staged);
      replaceExecutable(staged, executable);
      return executable;
    } catch {
      // A broken PATH entry must not shadow an existing verified cache.
    } finally {
      rmSync(staged, { force: true });
    }
  }

  const cachedCandidates = [
    executable,
    join(directory, asset.name),
    join(directory, assetName),
  ];
  for (const candidate of cachedCandidates) {
    if (!isExecutableFile(candidate) || candidate.endsWith('.tgz')) continue;
    try {
      await verifyDownloadedExecutable(candidate);
      if (candidate !== executable) {
        const staged = join(directory, `.cloudflared-cache-${process.pid}-${Date.now()}`);
        copyFileSync(candidate, staged);
        if (process.platform !== 'win32') chmodSync(staged, 0o700);
        await verifyDownloadedExecutable(staged);
        replaceExecutable(staged, executable);
      }
      return executable;
    } catch {
      // Invalid cache is left in place until a fully verified replacement is ready.
    }
  }

  const transaction = mkdtempSync(join(directory, '.cloudflared-install-'));
  const failures: string[] = [];
  const deadline = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    for (const [index, url] of cloudflaredDownloadUrls(asset.name).entries()) {
      const sourceLabel = index === 0 ? 'official release' : `configured mirror ${index}`;
      const attempt = mkdtempSync(join(transaction, 'source-'));
      try {
        combined.throwIfAborted();
        const downloaded = join(attempt, asset.name);
        const response = await fetch(url, { redirect: 'follow', signal: combined });
        await streamDownloadToFile(response, downloaded);
        let candidate = downloaded;
        if (asset.archive) {
          const extracted = join(attempt, 'extracted');
          mkdirSync(extracted, { recursive: true, mode: 0o700 });
          await extractTarGz(downloaded, extracted, combined);
          candidate = findExtractedBinary(extracted) ?? '';
          if (!candidate) throw new Error('cloudflared binary not found after extraction');
        }
        if (process.platform !== 'win32') chmodSync(candidate, 0o700);
        await verifyDownloadedExecutable(candidate, combined);
        combined.throwIfAborted();
        replaceExecutable(candidate, executable);
        return executable;
      } catch (error) {
        if (combined.aborted) throw combined.reason ?? error;
        failures.push(`${sourceLabel}: download or validation failed`);
      } finally {
        rmSync(attempt, { recursive: true, force: true });
      }
    }
    throw new Error(`cloudflared download failed; try another mirror or install cloudflared on PATH (${failures.join('; ')})`);
  } finally {
    rmSync(transaction, { recursive: true, force: true });
  }
}

export function ensureCloudflared(home: string, signal?: AbortSignal): Promise<string> {
  return withCloudflaredDownload(home, (sharedSignal) => ensureCloudflaredOnce(home, sharedSignal), signal);
}

export interface CloudflaredTunnelOptions {
  home: string;
  ensureExecutable?: (home: string, signal: AbortSignal) => Promise<string>;
  spawnProcess?: typeof spawn;
  now?: () => number;
}

export class CloudflaredTunnel implements TunnelController {
  private readonly home: string;
  private readonly ensureExecutable: (home: string, signal: AbortSignal) => Promise<string>;
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => number;
  private state: TunnelSnapshot = { phase: 'idle', detail: '', url: null, startedAt: null };
  private child: ChildProcess | null = null;
  private startPromise: Promise<TunnelSnapshot> | null = null;
  private expectedStop = false;
  private generation = 0;
  private preparationAbort: AbortController | null = null;

  constructor(options: CloudflaredTunnelOptions) {
    this.home = options.home;
    this.ensureExecutable = options.ensureExecutable ?? ensureCloudflared;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.now = options.now ?? Date.now;
  }

  snapshot(): TunnelSnapshot { return { ...this.state }; }

  start(targetUrl: string): Promise<TunnelSnapshot> {
    if (this.state.phase === 'running') return Promise.resolve(this.snapshot());
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    this.state = { phase: 'downloading', detail: 'cloudflared', url: null, startedAt: null };
    this.startPromise = this.startOnce(targetUrl, generation).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startOnce(targetUrl: string, generation: number): Promise<TunnelSnapshot> {
    await this.terminateChild();
    try {
      const preparationAbort = new AbortController();
      this.preparationAbort?.abort(new Error('cloudflared start superseded'));
      this.preparationAbort = preparationAbort;
      const executable = await this.ensureExecutable(this.home, preparationAbort.signal);
      if (this.preparationAbort === preparationAbort) this.preparationAbort = null;
      if (generation !== this.generation) throw new Error('cloudflared start cancelled');
      this.state = { phase: 'starting', detail: '', url: null, startedAt: null };
      this.expectedStop = false;
      const child = this.spawnProcess(executable, ['tunnel', '--url', targetUrl, '--protocol', 'http2', '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      if (generation !== this.generation) {
        await this.terminateChild();
        throw new Error('cloudflared start cancelled');
      }

      const url = await new Promise<string>((resolve, reject) => {
        let settled = false;
        let buffered = '';
        const finish = (error: Error | null, value?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolve(value!);
        };
        const inspect = (chunk: Buffer) => {
          buffered = `${buffered}${chunk.toString('utf8')}`.slice(-16_384);
          const found = extractTryCloudflareUrl(buffered);
          if (found) finish(null, found);
        };
        child.stdout?.on('data', inspect);
        child.stderr?.on('data', inspect);
        child.once('error', (error) => finish(error));
        child.once('exit', (code, signal) => finish(new Error(`cloudflared exited before URL (${String(code ?? signal)})`)));
        const timer = setTimeout(() => finish(new Error('cloudflared URL timeout')), 30_000);
        timer.unref();
      });

      if (generation !== this.generation) {
        await this.terminateChild();
        throw new Error('cloudflared start cancelled');
      }
      this.state = { phase: 'running', detail: '', url, startedAt: this.now() };
      child.once('exit', (code, signal) => {
        if (this.child === child) this.child = null;
        if (!this.expectedStop) {
          this.state = {
            phase: 'error',
            detail: `cloudflared exited (${String(code ?? signal)})`,
            url: null,
            startedAt: null,
          };
        }
      });
      return this.snapshot();
    } catch (error) {
      await this.terminateChild();
      if (generation !== this.generation) {
        this.state = { phase: 'idle', detail: '', url: null, startedAt: null };
      } else {
        this.state = {
          phase: 'error',
          detail: error instanceof Error ? error.message : String(error),
          url: null,
          startedAt: null,
        };
      }
      throw error;
    }
  }

  private async terminateChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    this.expectedStop = true;
    child.kill('SIGTERM');
    const exited = waitForProcess(child);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([waitForProcess(child), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }

  async stop(): Promise<TunnelSnapshot> {
    this.generation += 1;
    this.preparationAbort?.abort(new Error('cloudflared start cancelled'));
    this.preparationAbort = null;
    if (!this.child && !this.startPromise) {
      this.state = { phase: 'idle', detail: '', url: null, startedAt: null };
      return this.snapshot();
    }
    this.state = { ...this.state, phase: 'stopping', detail: '' };
    await this.terminateChild();
    this.state = { phase: 'idle', detail: '', url: null, startedAt: null };
    return this.snapshot();
  }

  async close(): Promise<void> { await this.stop(); }
}
