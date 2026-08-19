import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  const names = process.platform === 'win32'
    ? [executableName(), 'cloudflared.cmd']
    : [executableName()];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (isUsableFile(candidate)) return candidate;
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

async function extractTarGz(archive: string, destination: string): Promise<void> {
  const child = spawn('tar', ['-xzf', archive, '-C', destination], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  await waitForProcess(child);
  if (child.exitCode !== 0) throw new Error(`cloudflared extract failed: ${Buffer.concat(stderr).toString('utf8').trim()}`);
}

async function verifyDownloadedExecutable(file: string): Promise<void> {
  if (!isExecutableFile(file)) throw new Error('cloudflared download did not produce an executable file');
  const child = spawn(file, ['--version'], { stdio: 'ignore' });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error('cloudflared executable probe timed out'));
    }, 5000);
    timer.unref();
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (result.code !== 0 || result.signal !== null) {
    throw new Error('cloudflared executable probe failed');
  }
}

export async function ensureCloudflared(home: string): Promise<string> {
  const directory = join(home, 'remote-access', 'bin');
  const executable = join(directory, executableName());
  const asset = releaseAsset();
  const assetName = asset.name.replace(/\.tgz$/i, '').replace(/\.exe$/i, '');
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  // PATH is the operator's explicit installation and takes precedence over a
  // stale cached binary from an older dsh-access run.
  const fromPath = executableOnPath();
  if (fromPath) {
    copyFileSync(fromPath, executable);
    if (process.platform !== 'win32') chmodSync(executable, 0o700);
    return executable;
  }

  const cachedCandidates = [
    executable,
    join(directory, asset.name),
    join(directory, assetName),
  ];
  for (const candidate of cachedCandidates) {
    if (isExecutableFile(candidate) && !candidate.endsWith('.tgz')) {
      if (candidate !== executable) {
        copyFileSync(candidate, executable);
        if (process.platform !== 'win32') chmodSync(executable, 0o700);
      }
      return executable;
    }
  }

  let bytes: Buffer | null = null;
  const failures: string[] = [];
  for (const [index, url] of cloudflaredDownloadUrls(asset.name).entries()) {
    const sourceLabel = index === 0 ? 'official release' : `configured mirror ${index}`;
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        failures.push(`${sourceLabel}: HTTP ${String(response.status)}`);
        continue;
      }
      bytes = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      // Do not echo arbitrary fetch errors: a configured mirror may contain
      // query-string credentials or other deployment-only material.
      failures.push(`${sourceLabel}: network request failed`);
    }
  }
  if (bytes === null) {
    throw new Error(`cloudflared download failed; try another mirror or install cloudflared on PATH (${failures.join('; ')})`);
  }

  if (asset.archive) {
    const archive = join(directory, asset.name);
    writeFileSync(archive, bytes, { mode: 0o600 });
    try {
      await extractTarGz(archive, directory);
    } finally {
      rmSync(archive, { force: true });
    }
  } else {
    writeFileSync(executable, bytes, { mode: 0o700 });
  }
  if (!isExecutableFile(executable)) {
    rmSync(executable, { force: true });
    throw new Error('cloudflared download did not produce an executable file');
  }
  if (process.platform !== 'win32') chmodSync(executable, 0o700);
  try {
    await verifyDownloadedExecutable(executable);
  } catch (error) {
    rmSync(executable, { force: true });
    throw error;
  }
  return executable;
}

export interface CloudflaredTunnelOptions {
  home: string;
  ensureExecutable?: (home: string) => Promise<string>;
  spawnProcess?: typeof spawn;
  now?: () => number;
}

export class CloudflaredTunnel implements TunnelController {
  private readonly home: string;
  private readonly ensureExecutable: (home: string) => Promise<string>;
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => number;
  private state: TunnelSnapshot = { phase: 'idle', detail: '', url: null, startedAt: null };
  private child: ChildProcess | null = null;
  private startPromise: Promise<TunnelSnapshot> | null = null;
  private expectedStop = false;
  private generation = 0;

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
      const executable = await this.ensureExecutable(this.home);
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
