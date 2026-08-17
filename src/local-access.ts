/** Marker added by the 3088 gateway before proxying to the loopback DSH host. */
export const GATEWAY_PROXY_HEADER = 'x-dsh-passwords-gateway-proxy';

export type ProxyHeaders = Record<string, string | string[] | undefined>;

export interface PluginCaller {
  userId: number;
  username: string;
  role: 'admin' | 'user';
}

export interface PluginUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

/** Always overwrite a client-supplied marker so gateway traffic cannot pose as direct 3080 traffic. */
export function markGatewayProxyHeaders(headers: ProxyHeaders): void {
  headers[GATEWAY_PROXY_HEADER] = '1';
}

function loopbackHostname(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
  } catch {
    return false;
  }
}

function loopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized.startsWith('127.') || normalized.startsWith('::ffff:127.');
}

/** True only for a browser/process connected directly to the loopback-bound DSH upstream. */
export function isDirectLocalPluginRequest(input: {
  remoteAddress: string | undefined;
  host: string | undefined;
  gatewayMarker: string | string[] | undefined;
}): boolean {
  if (input.gatewayMarker === '1' || (Array.isArray(input.gatewayMarker) && input.gatewayMarker.includes('1'))) {
    return false;
  }
  return loopbackAddress(input.remoteAddress) && loopbackHostname(input.host);
}

/** Prefer a real JWT caller; otherwise grant only true direct local requests the real admin account. */
export function resolvePluginCaller(
  authenticated: PluginCaller | null,
  directLocal: boolean,
  users: readonly PluginUser[],
): PluginCaller | null {
  if (authenticated) return authenticated;
  if (!directLocal) return null;
  const admin = users.find((user) => user.role === 'admin');
  return admin ? { userId: admin.id, username: admin.username, role: 'admin' } : null;
}
