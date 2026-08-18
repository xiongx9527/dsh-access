// dsh 主机侧插件：dsh-access 在 dsh 里的"席位"
//   1. /api/dsh-access/* 用户管理路由：改密码、改用户名、
//      主用户分配/删除子用户。走网关 JWT cookie 鉴权。
//   2. /api/dsh-access/patch/* 远程设置补丁路由：
//      - GET  /patch/status → 补丁当前状态（任何登录用户可看）
//      - POST /patch/reload → 通知网关重载补丁并重启 dsh 网页服务
//        （任何登录用户可触发；补丁强制启用，无开关）
//      dsh 升级覆盖补丁后，用户在设置页点"重载补丁"即可，无需登录服务器。
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import jwt from 'jsonwebtoken';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type PlatformConfig } from './config.js';
import { Database, type UserListRow } from './db.js';
import { createFieldCrypto } from './encrypt.js';
import { AuthService, AuthError, assertNoSqlInjection, type AuthedUser, type RequestMeta } from './auth.js';
import { findDshRoot, patchStatus } from './patch.js';
import { assignWorkspace } from './workspace-assignment.js';
import { parseGatewayPort, writeEnvFileAtomic, writeGatewayPort } from './gateway-settings.js';
import { RemoteAccessService } from './remote-access.js';
import {
  GATEWAY_PROXY_HEADER,
  isDirectLocalPluginRequest,
  resolvePluginCaller,
} from './local-access.js';


export interface RemoteAccessPortController {
  stopTunnel(): Promise<unknown>;
  setGatewayPort(port: number): Promise<void>;
}

export async function restartGatewayAndRefreshRemote(
  runtime: Pick<GatewayRuntime, 'restart'>,
  remote: RemoteAccessPortController | null,
  port: number,
): Promise<void> {
  if (remote !== null) await remote.stopTunnel();
  await runtime.restart(port);
  if (remote !== null) await remote.setGatewayPort(port);
}

export function remoteAccessAuthorization(caller: AuthedUser | null, directLocal = false): 'allowed' | 'unauthenticated' | 'forbidden' {
  if (caller === null && directLocal) return 'allowed';
  if (caller === null) return 'unauthenticated';
  return caller.role === 'admin' ? 'allowed' : 'forbidden';
}

/** 稳定 cordis 插件名（insert 进 cordis.yml 时用同一个名字） */
export const name = 'dsh-access';

/** 依赖 dsh 主机侧的 webServer 服务（路由挂载点） */
export const inject = ['webServer'];

/** 网关会话 cookie 名（与 gateway.ts 保持一致） */
const COOKIE_NAME = 'dsh_gateway_token';
/** 请求体上限（用户管理 JSON 都很小） */
const MAX_BODY = 4096;

function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === cookieName && rest.length > 0) {
      const raw = rest.join('=');
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function localDay(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function limitValue(value: unknown, fallback: number | null): number | null {
  if (value === null || value === '') return null;
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('limit must be a non-negative integer or null');
  }
  return parsed;
}

/** 通知网关进程：重载补丁 + 延迟重启 dsh-web（fire-and-forget） */
function notifyGateway(cfg: PlatformConfig): void {
  const mod = cfg.gateway.tls !== null ? https : http;
  const url = `${cfg.gateway.tls !== null ? 'https' : 'http'}://127.0.0.1:${String(cfg.gateway.port)}/gateway/internal/patch`;
  const body = JSON.stringify({ action: 'apply' });
  const req = mod.request(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': cfg.internalSecret,
        'content-length': String(Buffer.byteLength(body)),
      },
      // 网关可能用自签证书，内部回环调用豁免校验
      rejectUnauthorized: false,
      timeout: 4000,
    },
    (res) => {
      res.resume();
    },
  );
  req.on('error', () => {
    // 网关没起来时静默：下次网关启动会自动应用补丁
  });
  req.end(body);
}

/** 网关启动错误码（与 cli.ts 保持一致）：30 证书签发失败 / 31 无公网域名 / 32 端口被占 */
const EXIT_CERT_FAILED = 30;
const EXIT_NO_DOMAIN = 31;

/** 探测网关是否已在监听（防止 dsh 重启/多开时重复拉起） */
function gatewayAlreadyRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 自动拉起外部访问管理：dsh 启动时（本插件被加载）spawn 网关子进程，
 * 无需任何额外启动命令。dsh 退出时（ctx.dispose）子进程随停；
 * 网关侧另有父进程看门狗兜底（宿主被强杀时自己退出）。
 */
export interface GatewayRuntime {
  readonly envPath: string;
  readonly port: number;
  restart(port: number): Promise<void>;
}

function gatewayRuntimeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    child.once('exit', finish);
  });
}

async function waitForGatewayPort(port: number, child: ChildProcess, launchError: () => Error | null): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const error = launchError();
    if (error) throw error;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw gatewayRuntimeError('GATEWAY_RESTART_FAILED', '网关进程在端口就绪前退出');
    }
    if (await gatewayAlreadyRunning(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw gatewayRuntimeError('GATEWAY_RESTART_FAILED', `网关端口 ${String(port)} 启动超时`);
}

/**
 * 自动拉起外部访问管理，并暴露只管理本插件子进程的重启控制器。
 * 端口变更时不重启 3080，只替换网关子进程。
 */
function startGateway(ctx: Context, cfg: PlatformConfig): GatewayRuntime {
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cliPath = path.join(installRoot, 'dist', 'cli.js');
  const envPath = process.env.DSH_ACCESS_ENV_FILE?.trim() || path.join(installRoot, '.env');
  const detectedDshRoot = findDshRoot(cfg.patch.dshRoot);
  let activePort = cfg.gateway.port;
  let disposed = false;
  let child: ChildProcess | null = null;
  const expectedStops = new WeakSet<ChildProcess>();

  const stopChild = async (): Promise<void> => {
    const target = child;
    child = null;
    if (target === null || target.exitCode !== null || target.signalCode !== null) return;
    expectedStops.add(target);
    target.kill('SIGTERM');
    await waitForChildExit(target, 3000);
    if (target.exitCode === null && target.signalCode === null) {
      try {
        target.kill('SIGKILL');
      } catch {
        // 已退出。
      }
      await waitForChildExit(target, 1000);
    }
  };

  const launch = async (port: number): Promise<void> => {
    if (disposed) throw gatewayRuntimeError('GATEWAY_RESTART_FAILED', '网关控制器已停止');
    if (!existsSync(cliPath)) {
      throw gatewayRuntimeError('GATEWAY_RESTART_FAILED', '访问管理未编译（缺少 dist/cli.js）');
    }
    let upstreamPort = 3080;
    try {
      const wsPort = (ctx.webServer as unknown as { port?: number }).port;
      if (typeof wsPort === 'number' && wsPort > 0) upstreamPort = wsPort;
    } catch {
      // 拿不到就用默认值。
    }
    const explicitUpstream = process.env.MCP_GATEWAY_UPSTREAM?.trim() ?? '';
    const gatewayArgs =
      explicitUpstream !== ''
        ? [cliPath, 'serve-gateway']
        : [cliPath, 'serve-gateway', '--upstream', `http://127.0.0.1:${String(upstreamPort)}`];
    let spawnError: Error | null = null;
    const launched = spawn(process.execPath, gatewayArgs, {
      cwd: installRoot,
      env: {
        ...process.env,
        MCP_GATEWAY_PORT: String(port),
        DSH_GATEWAY_PARENT_PID: String(process.pid),
        DSH_ACCESS_ENV_FILE: envPath,
        MCP_DSH_ROOT: detectedDshRoot ?? '',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child = launched;
    launched.once('error', (error) => {
      spawnError = error;
      console.error('[dsh-access] 访问管理拉起失败:', error);
    });
    launched.on('exit', (code, signal) => {
      if (child === launched) child = null;
      if (disposed || expectedStops.has(launched)) return;
      const reason = code ?? signal ?? 'unknown';
      if (reason === EXIT_CERT_FAILED) {
        console.error('[dsh-access] 访问管理未启动（错误码 30：HTTPS 证书签发失败）。检查 80/443 端口与网络；或运行 scripts/start-http.mjs 改用明文 HTTP（有被嗅探风险）');
      } else if (reason === EXIT_NO_DOMAIN) {
        console.error('[dsh-access] 访问管理未启动（错误码 31：无法确定公网 IP/域名）。或运行 scripts/start-http.mjs 改用明文 HTTP（有被嗅探风险）');
      } else {
        console.error(`[dsh-access] 访问管理进程已退出（code=${String(reason)}）。重启 dsh 会自动再次拉起`);
      }
    });
    try {
      await waitForGatewayPort(port, launched, () => spawnError);
      activePort = port;
    } catch (error) {
      if (child === launched) child = null;
      expectedStops.add(launched);
      if (launched.exitCode === null && launched.signalCode === null) launched.kill('SIGTERM');
      throw error;
    }
  };

  ctx.effect(
    () => {
      const noop = () => {};
      if (!existsSync(cliPath)) {
        console.error('[dsh-access] 访问管理未编译（缺少 dist/cli.js）：请先到安装目录运行 npm install && npm run build');
        return noop;
      }
      if (process.env.DSH_PASSWORDS_NO_AUTOSTART === '1') return noop;
      void gatewayAlreadyRunning(activePort).then((running) => {
        if (disposed) return;
        if (running) {
          console.error(`[dsh-access] 访问管理已在运行（端口 ${String(activePort)}），跳过自动拉起`);
          return;
        }
        void launch(activePort).catch((error) => {
          console.error('[dsh-access] 访问管理启动失败:', error);
        });
      });
      return () => {
        disposed = true;
        void stopChild();
      };
    },
    'dsh-access: gateway autostart',
  );

  return {
    envPath,
    get port() {
      return activePort;
    },
    async restart(port: number): Promise<void> {
      if (port === activePort && child !== null && child.exitCode === null && child.signalCode === null) return;
      if (port !== activePort && (await gatewayAlreadyRunning(port))) {
        throw gatewayRuntimeError('PORT_IN_USE', `端口 ${String(port)} 已被占用`);
      }
      if (child === null && (await gatewayAlreadyRunning(activePort))) {
        throw gatewayRuntimeError('GATEWAY_NOT_MANAGED', '当前网关不是由本 DSH 进程启动，请重启 DSH 后再修改端口');
      }
      await stopChild();
      await launch(port);
    },
  };
}

export function apply(ctx: Context): void {
  let cfg: PlatformConfig;
  try {
    cfg = loadConfig();
  } catch {
    return;
  }

  // 未配置 .env（SETUP_KEY 为空）时不初始化数据库，用户管理路由返回 503 提示
  const configured =
    cfg.setupKey !== '' && cfg.setupKey !== 'change-me-to-a-strong-random-key';
  let db: Database | null = null;
  let auth: AuthService | null = null;
  if (configured) {
    try {
      db = new Database(cfg.dbPath, createFieldCrypto(cfg.dbEncKey, cfg.setupKey));
      db.init();
      auth = new AuthService(cfg, db);
    } catch (error) {
      console.error('[dsh-access] 网关数据库初始化失败:', error);
      db = null;
      auth = null;
    }
  }

  /** 从网关 JWT cookie 解析调用方身份（含凭据版本校验） */
  const callerOf = (req: IncomingMessage): AuthedUser | null => {
    if (db === null || auth === null) return null;
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    try {
      const payload = jwt.verify(token, cfg.jwtSecret) as jwt.JwtPayload;
      const row = db.getUserById(Number(payload.sub));
      if (!row) return null;
      const cv = typeof payload.cv === 'number' ? payload.cv : 0;
      if (cv !== row.credential_version) return null;
      return { userId: row.id, username: row.username, role: row.role };
    } catch {
      return null;
    }
  };

  /** 统一守卫：跨站拒绝 + 配置检查 + 会话校验 */
  const guard = (req: IncomingMessage, res: ServerResponse): AuthedUser | null => {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      writeJson(res, 403, { ok: false, code: 'FORBIDDEN_CSRF', error: 'forbidden' });
      return null;
    }
    if (db === null || auth === null) {
      writeJson(res, 503, {
        ok: false,
        code: 'NOT_CONFIGURED',
        error: '未配置：请先完成 dsh-access 部署（.env 中 SETUP_KEY 等），再重启 dsh',
      });
      return null;
    }
    const caller = resolvePluginCaller(
      callerOf(req),
      isDirectLocalPluginRequest({
        remoteAddress: req.socket.remoteAddress,
        host: req.headers.host,
        gatewayMarker: req.headers[GATEWAY_PROXY_HEADER],
      }),
      db.listUsers(),
    );
    if (!caller) {
      writeJson(res, 401, { ok: false, code: 'NOT_AUTHENTICATED', error: '未登录或会话已失效' });
      return null;
    }
    return caller;
  };

  const metaOf = (req: IncomingMessage): RequestMeta => ({
    ip: 'gateway',
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  /** 错误响应：携带稳定 code（设置页卡片按 dsh 语言本地化）+ 中文兜底文案 */
  const failJson = (res: ServerResponse, error: unknown): void => {
    if (error instanceof AuthError) {
      writeJson(res, error.status, { ok: false, code: error.code, error: error.message });
      return;
    }
    writeJson(res, 500, {
      ok: false,
      code: 'INTERNAL',
      error: error instanceof Error ? error.message : '内部错误',
    });
  };

  const gatewayRuntime = configured ? startGateway(ctx, cfg) : null;
  const remoteAccess = configured
    ? new RemoteAccessService({ gatewayPort: gatewayRuntime?.port ?? cfg.gateway.port, home: path.dirname(cfg.dbPath) })
    : null;
  if (remoteAccess !== null) {
    ctx.effect(() => () => { void remoteAccess.close(); }, 'dsh-access: remote access cleanup');
  }

  const requireAdmin = (req: IncomingMessage, res: ServerResponse): AuthedUser | null => {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      writeJson(res, 403, { ok: false, code: 'FORBIDDEN_CSRF', error: 'forbidden' });
      return null;
    }
    const caller = callerOf(req);
    const directLocal = isDirectLocalPluginRequest({
      remoteAddress: req.socket.remoteAddress,
      host: req.headers.host,
      gatewayMarker: req.headers[GATEWAY_PROXY_HEADER],
    });
    const authorization = remoteAccessAuthorization(caller, directLocal);
    if (authorization === 'unauthenticated') {
      writeJson(res, 401, { ok: false, code: 'NOT_AUTHENTICATED', error: '未登录或会话已失效' });
      return null;
    }
    if (authorization === 'forbidden') {
      writeJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '仅主用户可管理远程访问' });
      return null;
    }
    return caller ?? { userId: 0, username: 'admin', role: 'admin' };
  };

  // ── /api/dsh-access/* 路由（exact 路由先于连接插件的 /api 前缀命中） ──
  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: '/api/dsh-access/state',
      handler: (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        const users: UserListRow[] = db!.listUsers();
        writeJson(res, 200, {
          ok: true,
          me: { username: caller.username, role: caller.role },
          users,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/remote-access/status',
      handler: async (req, res) => {
        if (!requireAdmin(req, res)) return;
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'method not allowed' });
          return;
        }
        if (remoteAccess === null) {
          writeJson(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: '远程访问尚未配置' });
          return;
        }
        try {
          const port = gatewayRuntime?.port ?? cfg.gateway.port;
          await remoteAccess.setGatewayPort(port);
          const remoteStatus = remoteAccess.statusSnapshot(true);
          void remoteAccess.prefetchQr(true).catch(() => {});
          writeJson(res, 200, { ok: true, ...remoteStatus });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/remote-access/tunnel/start',
      handler: async (req, res) => {
        if (!requireAdmin(req, res)) return;
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'method not allowed' });
          return;
        }
        if (remoteAccess === null) {
          writeJson(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: '远程访问尚未配置' });
          return;
        }
        try {
          const port = gatewayRuntime?.port ?? cfg.gateway.port;
          if (!(await gatewayAlreadyRunning(port))) {
            writeJson(res, 503, { ok: false, code: 'GATEWAY_NOT_RUNNING', error: '登录网关未运行' });
            return;
          }
          await remoteAccess.setGatewayPort(port);
          void remoteAccess.startTunnel().catch((error) => {
            console.error('[dsh-access] 临时隧道启动失败:', error);
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
          writeJson(res, 202, { ok: true, ...remoteAccess.statusSnapshot(true) });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/remote-access/tunnel/stop',
      handler: async (req, res) => {
        if (!requireAdmin(req, res)) return;
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'method not allowed' });
          return;
        }
        if (remoteAccess === null) {
          writeJson(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: '远程访问尚未配置' });
          return;
        }
        try {
          void remoteAccess.stopTunnel().catch((error) => {
            console.error('[dsh-access] 临时隧道停止失败:', error);
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
          writeJson(res, 202, { ok: true, ...remoteAccess.statusSnapshot(true) });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/gateway/config',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        if (caller.role !== 'admin') {
          writeJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '仅主用户可修改网关配置' });
          return;
        }
        if (req.method === 'GET') {
          writeJson(res, 200, {
            ok: true,
            port: gatewayRuntime?.port ?? cfg.gateway.port,
            host: cfg.gateway.host,
            upstream: cfg.gateway.upstream,
          });
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'method not allowed' });
          return;
        }
        const directLocal = isDirectLocalPluginRequest({
          remoteAddress: req.socket.remoteAddress,
          host: req.headers.host,
          gatewayMarker: req.headers[GATEWAY_PROXY_HEADER],
        });
        if (!directLocal) {
          writeJson(res, 403, {
            ok: false,
            code: 'GATEWAY_CONFIG_LOCAL_ONLY',
            error: '修改网关端口只能在本机 3080 设置页面操作',
          });
          return;
        }
        if (gatewayRuntime === null) {
          writeJson(res, 503, { ok: false, code: 'NOT_CONFIGURED', error: '网关尚未配置' });
          return;
        }
        try {
          const body = await readJsonBody(req);
          let upstreamPort: number | null = null;
          try {
            const upstream = new URL(cfg.gateway.upstream);
            upstreamPort = upstream.port !== '' ? Number(upstream.port) : upstream.protocol === 'https:' ? 443 : 80;
          } catch {
            upstreamPort = null;
          }
          const port = parseGatewayPort(body.port, upstreamPort);
          const previousPort = gatewayRuntime.port;
          if (port === previousPort) {
            writeJson(res, 200, { ok: true, port, host: cfg.gateway.host, upstream: cfg.gateway.upstream });
            return;
          }
          if (await gatewayAlreadyRunning(port)) {
            writeJson(res, 409, { ok: false, code: 'PORT_IN_USE', error: `端口 ${String(port)} 已被占用` });
            return;
          }
          const previousProcessValue = process.env.MCP_GATEWAY_PORT;
          const previousEnv = writeGatewayPort(gatewayRuntime.envPath, port);
          process.env.MCP_GATEWAY_PORT = String(port);
          try {
            await restartGatewayAndRefreshRemote(gatewayRuntime, remoteAccess, port);
            cfg.gateway.port = port;
            writeJson(res, 200, { ok: true, port, host: cfg.gateway.host, upstream: cfg.gateway.upstream });
          } catch (error) {
            writeEnvFileAtomic(gatewayRuntime.envPath, previousEnv);
            if (previousProcessValue === undefined) delete process.env.MCP_GATEWAY_PORT;
            else process.env.MCP_GATEWAY_PORT = previousProcessValue;
            cfg.gateway.port = previousPort;
            try {
              await gatewayRuntime.restart(previousPort);
            } catch (rollbackError) {
              console.error('[dsh-access] 网关端口回滚失败:', rollbackError);
            }
            const code = error instanceof Error && 'code' in error ? String((error as Error & { code: unknown }).code) : 'GATEWAY_RESTART_FAILED';
            writeJson(res, code === 'PORT_IN_USE' ? 409 : 500, {
              ok: false,
              code,
              error: error instanceof Error ? error.message : '网关重启失败，已恢复原端口',
            });
          }
        } catch (error) {
          writeJson(res, 400, {
            ok: false,
            code: 'INVALID_GATEWAY_PORT',
            error: error instanceof Error ? error.message : '网关端口无效',
          });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/overview',
      handler: (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        if (caller.role !== 'admin') {
          writeJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '仅主用户可查看账号概览' });
          return;
        }
        const day = localDay();
        const users = db!.listUsers().map((user) => {
          const perms = db!.getPermissions(user.id);
          const usage = db!.getUsage(user.id, day);
          return {
            id: user.id,
            username: user.username,
            role: user.role,
            remark: perms?.remark ?? '',
            workspaceRoot: perms?.workspace_root ?? null,
            permissions: {
              allowedFolders: perms?.allowed_folders ?? [],
              hourlyTokenLimit: perms?.hourly_token_limit ?? null,
              dailyMinutesLimit: perms?.daily_minutes_limit ?? null,
              allowUpload: perms?.allow_upload ?? false,
              allowGitDownload: perms?.allow_git_download ?? false,
              banned: perms?.banned ?? false,
              sandboxMode: perms?.sandbox_mode ?? null,
            },
            usage: usage
              ? {
                  day: usage.day,
                  activeSeconds: usage.active_seconds,
                  hourlyTokens: usage.hourly_tokens,
                  firstSeenAt: usage.first_seen_at,
                  lastActiveAt: usage.last_active_at,
                }
              : null,
          };
        });
        writeJson(res, 200, {
          ok: true,
          me: { id: caller.userId, username: caller.username, role: caller.role },
          users,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/permissions',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        if (caller.role !== 'admin') {
          writeJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '仅主用户可修改权限' });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const userId = Number(body.userId);
          if (!Number.isInteger(userId) || userId <= 0) {
            writeJson(res, 400, { ok: false, code: 'INVALID_USER', error: 'userId 无效' });
            return;
          }
          const target = db!.getUserById(userId);
          const current = db!.getPermissions(userId);
          if (!target || target.role !== 'user' || !current) {
            writeJson(res, 404, { ok: false, code: 'NO_SUCH_USER', error: '子用户不存在' });
            return;
          }
          const requestedFolders = Array.isArray(body.allowedFolders)
            ? body.allowedFolders.filter(
                (value): value is string => typeof value === 'string' && value.trim() !== '',
              )
            : [];
          const desiredRoot = requestedFolders[0] ?? current.workspace_root;
          if (desiredRoot === null) {
            writeJson(res, 400, {
              ok: false,
              code: 'WORKSPACE_REQUIRED',
              error: '必须分配一个工作区域',
            });
            return;
          }
          const assignment =
            desiredRoot === current.workspace_root
              ? {
                  mode: current.workspace_mode === 'username' ? ('username' as const) : ('specified' as const),
                  root: desiredRoot,
                }
              : assignWorkspace({
                  mode: 'specified',
                  username: target.username,
                  baseRoot: cfg.workspaceRoot,
                  specifiedRoot: desiredRoot,
                });
          const rawSandbox = body.sandboxMode;
          const sandboxMode =
            rawSandbox === 'read-only' ||
            rawSandbox === 'workspace-write' ||
            rawSandbox === 'danger-full-access'
              ? rawSandbox
              : current.sandbox_mode ?? 'workspace-write';
          db!.setPermissions(userId, {
            allowedFolders: [assignment.root],
            hourlyTokenLimit: limitValue(body.hourlyTokenLimit, current.hourly_token_limit),
            dailyMinutesLimit: limitValue(body.dailyMinutesLimit, current.daily_minutes_limit),
            allowUpload: typeof body.allowUpload === 'boolean' ? body.allowUpload : current.allow_upload,
            allowGitDownload:
              typeof body.allowGitDownload === 'boolean'
                ? body.allowGitDownload
                : current.allow_git_download,
            banned: typeof body.banned === 'boolean' ? body.banned : current.banned,
            sandboxMode,
            workspaceMode: assignment.mode,
            workspaceRoot: assignment.root,
            remark: current.remark,
          });
          writeJson(res, 200, { ok: true });
        } catch (error) {
          writeJson(res, 400, {
            ok: false,
            code: 'INVALID_PERMISSIONS',
            error: error instanceof Error ? error.message : '权限保存失败',
          });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/password',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        try {
          const body = await readJsonBody(req);
          const target = typeof body.target === 'string' && body.target !== '' ? body.target : caller.username;
          const password = typeof body.password === 'string' ? body.password : '';
          const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : undefined;
          await auth!.changePassword(caller, target, password, metaOf(req), currentPassword);
          writeJson(res, 200, { ok: true });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/username',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        try {
          const body = await readJsonBody(req);
          const target = typeof body.target === 'string' && body.target !== '' ? body.target : caller.username;
          const username = typeof body.username === 'string' ? body.username : '';
          assertNoSqlInjection(username, 'username');
          await auth!.renameUser(caller, target, username, metaOf(req));
          writeJson(res, 200, { ok: true });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/users',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        try {
          const body = await readJsonBody(req);
          const username = typeof body.username === 'string' ? body.username : '';
          const password = typeof body.password === 'string' ? body.password : '';
          assertNoSqlInjection(username, 'username');
          await auth!.addSubUser(caller, username, password, metaOf(req));
          writeJson(res, 200, { ok: true });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/users/remove',
      handler: async (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        try {
          const body = await readJsonBody(req);
          const target = typeof body.target === 'string' ? body.target : '';
          assertNoSqlInjection(target, 'target');
          await auth!.removeUser(caller, target, metaOf(req));
          writeJson(res, 200, { ok: true });
        } catch (error) {
          failJson(res, error);
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/patch/status',
      handler: (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        try {
          const root = findDshRoot(cfg.patch.dshRoot);
          const status = root ? patchStatus(root) : null;
          writeJson(res, 200, { ok: true, status });
        } catch {
          writeJson(res, 200, { ok: true, status: null });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/patch/reload',
      handler: (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        // 任何登录用户都可触发（补丁强制启用，重载只是重新应用 + 重启 dsh 网页服务）
        notifyGateway(cfg);
        writeJson(res, 202, { ok: true, message: '补丁重载中：dsh 网页服务即将重启（约 3-5 秒）' });
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-access/workspaces',
      handler: (req, res) => {
        const caller = guard(req, res);
        if (!caller) return;
        // 读取 dsh 已注册的工作区目录（供主用户配置子用户可访问文件夹时下拉选择）
        try {
          const reg = ctx.get('workspaceRegistry') as unknown as
            | { list(): Array<{ path: string; title: string }> }
            | undefined;
          const workspaces = (reg?.list() ?? []).map((w) => ({ path: w.path, title: w.title }));
          writeJson(res, 200, { ok: true, workspaces });
        } catch {
          writeJson(res, 200, { ok: true, workspaces: [] });
        }
      },
    },
  ];

  ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route));
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    'dsh-access: user management routes',
  );

}
