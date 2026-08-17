import { createElement as h, useEffect, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

export interface RemoteAccessStatus {
  gatewayPort: number;
  gatewayRunning: boolean;
  lanIp: string | null;
  lanUrl: string | null;
  lanQr: string | null;
  tunnel: {
    phase: 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';
    detail: string;
    url: string | null;
    qr: string | null;
    startedAt: number | null;
  };
}

export function shouldPollTunnel(phase: RemoteAccessStatus['tunnel']['phase']): boolean {
  return phase !== 'idle';
}

export function isLanAccessAvailable(status: RemoteAccessStatus | null): boolean {
  return status?.gatewayRunning === true && status.lanUrl !== null;
}

async function remoteApi(path: string, method = 'GET'): Promise<RemoteAccessStatus> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const body = await response.json().catch(() => ({})) as RemoteAccessStatus & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  return body;
}

export function RemoteAccessPanel(props: { refreshKey: number } & PropsLocale<'dshpw'>) {
  const { t } = props;
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const refresh = () => remoteApi('/api/dsh-passwords/remote-access/status')
    .then((next) => { setStatus(next); setError(''); })
    .catch((reason) => { setStatus(null); setError(reason instanceof Error ? reason.message : String(reason)); });

  useEffect(() => { void refresh(); }, [props.refreshKey]);
  useEffect(() => {
    if (!status || (!shouldPollTunnel(status.tunnel.phase) && !(status.lanUrl && !status.lanQr))) return;
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.tunnel.phase]);

  const controlTunnel = async (start: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await remoteApi(`/api/dsh-passwords/remote-access/tunnel/${start ? 'start' : 'stop'}`, 'POST'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1400);
    } catch { setError(t('remoteCopyFailed')); }
  };

  const phase = status?.tunnel.phase ?? 'idle';
  const pending = ['downloading', 'starting', 'stopping'].includes(phase);

  return h(
    'div',
    { className: 'dshpw-remote-panel' },
    h(
      'div',
      { className: `dshpw-remote-status${status?.gatewayRunning ? ' ready' : ''}` },
      h('span', { className: 'dshpw-remote-dot' }),
      h('strong', null, status?.gatewayRunning ? t('remoteReady') : t('remoteUnavailable')),
      h('span', null, t('remoteStatusPort', { port: status?.gatewayPort ?? '—' })),
      h('span', null, t('remoteLoginRequired')),
    ),
    h(
      'section',
      { className: 'dshpw-remote-card' },
      h('div', { className: 'dshpw-remote-card-head' },
        h('div', null, h('h3', null, t('remoteLanTitle')), h('p', null, t('remoteLanHint'))),
        h('span', { className: `dshpw-remote-badge${isLanAccessAvailable(status) ? ' ready' : ''}` }, isLanAccessAvailable(status) ? t('remoteAvailable') : t('remoteUnavailable')),
      ),
      isLanAccessAvailable(status) && status?.lanUrl
        ? h('div', { className: 'dshpw-remote-lan' },
            status.lanQr
              ? h('img', { className: 'dshpw-remote-qr', src: status.lanQr, alt: t('remoteLanQr') })
              : h('div', { className: 'dshpw-remote-qr-placeholder', role: 'status' }, t('remoteQrPreparing')),
            h('div', { className: 'dshpw-remote-copy' },
              h('p', null, t('remoteLanLoginHint')),
              h('div', { className: 'dshpw-remote-url' },
                h('code', null, status.lanUrl),
                h('button', { className: 'dshpw-btn ghost', onClick: () => { void copy(status.lanUrl!, 'lan'); } }, t('remoteCopyAddress')),
              ),
              h('p', { className: 'dshpw-hint' }, t('remoteLanSecurityHint')),
              copied === 'lan' ? h('div', { className: 'dshpw-ok' }, t('remoteCopied')) : null,
            ),
          )
        : h('div', { className: 'dshpw-hint dshpw-remote-empty' }, t('remoteNoLan')),
    ),
    h(
      'section',
      { className: 'dshpw-remote-card dshpw-remote-public-card' },
      h('div', { className: 'dshpw-remote-card-head' },
        h('div', null, h('h3', null, t('remotePublicTitle')), h('p', null, t('remotePublicHint', { port: status?.gatewayPort ?? '—' }))),
        h('button', {
          className: `dshpw-remote-switch${phase === 'running' ? ' on' : ''}`,
          role: 'switch',
          'aria-checked': phase === 'running',
          disabled: busy || pending || !status?.gatewayRunning,
          onClick: () => { void controlTunnel(phase !== 'running'); },
          title: phase === 'running' ? t('remoteStopTunnel') : t('remoteStartTunnel'),
        }, h('span')),
      ),
      h('div', { className: 'dshpw-hint' }, t({
        idle: 'remotePhase_idle',
        downloading: 'remotePhase_downloading',
        starting: 'remotePhase_starting',
        running: 'remotePhase_running',
        stopping: 'remotePhase_stopping',
        error: 'remotePhase_error',
      }[phase], { detail: status?.tunnel.detail ?? '' })),
      status?.tunnel.url
        ? h('div', { className: 'dshpw-remote-public' },
            status.tunnel.qr ? h('img', { className: 'dshpw-remote-qr small', src: status.tunnel.qr, alt: t('remotePublicQr') }) : null,
            h('div', { className: 'dshpw-remote-copy' },
              h('div', { className: 'dshpw-remote-url' },
                h('code', null, status.tunnel.url),
                h('button', { className: 'dshpw-btn ghost', onClick: () => { void copy(status.tunnel.url!, 'public'); } }, t('remoteCopyAddress')),
              ),
              h('p', { className: 'dshpw-hint' }, t('remotePublicSecurityHint')),
              copied === 'public' ? h('div', { className: 'dshpw-ok' }, t('remoteCopied')) : null,
            ),
          )
        : null,
    ),
    error ? h('div', { className: 'dshpw-error' }, error) : null,
  );
}
