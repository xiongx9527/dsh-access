import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export function parseGatewayPort(value: unknown, upstreamPort: number | null): number {
  const raw = typeof value === 'string' ? value.trim() : value;
  const port = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('gateway port must be an integer between 1 and 65535');
  }
  if (upstreamPort !== null && port === upstreamPort) {
    throw new Error('gateway port cannot equal the DSH upstream port');
  }
  return port;
}

export function replaceEnvSetting(source: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^(\\s*(?:export\\s+)?${escaped}\\s*=).*$`, 'm');
  if (matcher.test(source)) return source.replace(matcher, `$1${value}`);
  const suffix = source === '' || source.endsWith('\n') ? '' : '\n';
  return `${source}${suffix}${key}=${value}\n`;
}

export function writeEnvFileAtomic(envPath: string, content: string): void {
  const temporary = `${envPath}.tmp-${String(process.pid)}-${String(Date.now())}`;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, envPath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // 临时文件可能尚未创建或已经被 rename。
    }
    throw error;
  }
}

export function writeGatewayPort(envPath: string, port: number): string {
  const previous = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  writeEnvFileAtomic(envPath, replaceEnvSetting(previous, 'MCP_GATEWAY_PORT', String(port)));
  return previous;
}
