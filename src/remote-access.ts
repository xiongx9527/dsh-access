import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import QRCode from 'qrcode';
import { CloudflaredTunnel, type TunnelController, type TunnelSnapshot } from './tunnel.js';

export interface RemoteAccessStatus {
  gatewayPort: number;
  gatewayRunning: boolean;
  lanIp: string | null;
  lanUrl: string | null;
  lanQr: string | null;
  tunnel: TunnelSnapshot & { qr: string | null };
}

function privateAddressWeight(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 0;
  if (parts[0] === 10) return 3;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 3;
  if (parts[0] === 192 && parts[1] === 168) return 3;
  return 0;
}

function interfaceKindWeight(name: string): number {
  const normalized = name.toLowerCase();
  const virtualMarkers = ['utun', 'tun', 'tap', 'vpn', 'tailscale', 'zerotier', 'docker', 'bridge', 'awdl', 'llw', 'vmware', 'virtualbox'];
  if (virtualMarkers.some((marker) => normalized.includes(marker))) return -4;
  const physicalPrefixes = ['en', 'eth', 'wlan', 'wlp', 'wifi', 'wi-fi', 'ethernet'];
  return physicalPrefixes.some((prefix) => normalized.startsWith(prefix)) ? 2 : 0;
}

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function selectLanIPv4(interfaces: InterfaceMap): string | null {
  let best: { address: string; rank: number; index: number } | null = null;
  let index = 0;
  for (const name of Object.keys(interfaces ?? {})) {
    for (const entry of interfaces[name] ?? []) {
      const currentIndex = index++;
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const firstTwo = entry.address.split('.').slice(0, 2).join('.');
      if (entry.address.startsWith('127.') || firstTwo === '169.254') continue;
      const rank = privateAddressWeight(entry.address) * 10 + interfaceKindWeight(name);
      if (best === null || rank > best.rank || (rank === best.rank && currentIndex < best.index)) {
        best = { address: entry.address, rank, index: currentIndex };
      }
    }
  }
  return best?.address ?? null;
}

export interface RemoteAccessServiceOptions {
  gatewayPort: number;
  home: string;
  tunnel?: TunnelController;
  networkInterfacesFn?: () => InterfaceMap;
  qrEncoder?: (url: string) => Promise<string>;
}

export class RemoteAccessService {
  private gatewayPort: number;
  private readonly tunnel: TunnelController;
  private readonly networkInterfacesFn: () => InterfaceMap;
  private readonly qrEncoder: (url: string) => Promise<string>;
  private readonly qrCache = new Map<string, string>();

  constructor(options: RemoteAccessServiceOptions) {
    this.gatewayPort = options.gatewayPort;
    this.tunnel = options.tunnel ?? new CloudflaredTunnel({ home: options.home });
    this.networkInterfacesFn = options.networkInterfacesFn ?? networkInterfaces;
    this.qrEncoder = options.qrEncoder ?? ((url) => QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M', margin: 1, width: 220, type: 'image/png',
    }));
  }

  private async qr(url: string | null): Promise<string | null> {
    if (!url) return null;
    const cached = this.qrCache.get(url);
    if (cached) return cached;
    const encoded = await Promise.race([
      this.qrEncoder(url),
      new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 1500);
      }),
    ]);
    if (encoded !== null) this.qrCache.set(url, encoded);
    return encoded;
  }

  statusSnapshot(gatewayRunning: boolean): RemoteAccessStatus {
    const lanIp = selectLanIPv4(this.networkInterfacesFn());
    const lanUrl = lanIp ? `http://${lanIp}:${String(this.gatewayPort)}` : null;
    const tunnel = this.tunnel.snapshot();
    return {
      gatewayPort: this.gatewayPort,
      gatewayRunning,
      lanIp,
      lanUrl,
      lanQr: lanUrl ? this.qrCache.get(lanUrl) ?? null : null,
      tunnel: { ...tunnel, qr: tunnel.url ? this.qrCache.get(tunnel.url) ?? null : null },
    };
  }

  async prefetchQr(gatewayRunning: boolean): Promise<void> {
    const snapshot = this.statusSnapshot(gatewayRunning);
    await this.qr(snapshot.lanUrl);
    await this.qr(snapshot.tunnel.url);
  }

  async status(gatewayRunning: boolean): Promise<RemoteAccessStatus> {
    const lanIp = selectLanIPv4(this.networkInterfacesFn());
    const lanUrl = lanIp ? `http://${lanIp}:${String(this.gatewayPort)}` : null;
    const tunnel = this.tunnel.snapshot();
    console.error('[dsh-access] remote service status qr done');
    return {
      gatewayPort: this.gatewayPort,
      gatewayRunning,
      lanIp,
      lanUrl,
      lanQr: await this.qr(lanUrl),
      tunnel: { ...tunnel, qr: await this.qr(tunnel.url) },
    };
  }

  async startTunnel(): Promise<RemoteAccessStatus> {
    await this.tunnel.start(`http://127.0.0.1:${String(this.gatewayPort)}`);
    return this.status(true);
  }

  async stopTunnel(): Promise<RemoteAccessStatus> {
    await this.tunnel.stop();
    return this.status(true);
  }

  async setGatewayPort(port: number): Promise<void> {
    if (port === this.gatewayPort) return;
    await this.tunnel.stop();
    this.gatewayPort = port;
    this.qrCache.clear();
  }

  async close(): Promise<void> { await this.tunnel.close(); }
}
