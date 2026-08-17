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

const PRIVATE_IPV4_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const PHYSICAL_IFACE_RE = /^(?:wlan|wi-?fi|wireless|ethernet|eth\d|en\d|wlp\d|以太网|本地连接)/i;
const VPN_IFACE_RE = /(?:radmin|tailscale|zerotier|utun|tun|tap|vpn|vethernet|virtual|vmware|virtualbox|wsl|docker|teredo|hamachi|bluetooth|bridge|awdl|llw)/i;

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function selectLanIPv4(interfaces: InterfaceMap): string | null {
  const candidates: Array<{ ip: string; score: number; order: number }> = [];
  for (const [name, addresses] of Object.entries(interfaces ?? {})) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const ip = address.address;
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      let score = PRIVATE_IPV4_RE.test(ip) ? 100 : 0;
      if (PHYSICAL_IFACE_RE.test(name)) score += 20;
      if (VPN_IFACE_RE.test(name)) score -= 50;
      candidates.push({ ip, score, order: candidates.length });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  return candidates[0]?.ip ?? null;
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
    const encoded = await this.qrEncoder(url);
    this.qrCache.set(url, encoded);
    return encoded;
  }

  async status(gatewayRunning: boolean): Promise<RemoteAccessStatus> {
    const lanIp = selectLanIPv4(this.networkInterfacesFn());
    const lanUrl = lanIp ? `http://${lanIp}:${String(this.gatewayPort)}` : null;
    const tunnel = this.tunnel.snapshot();
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
