export type GatewayPathClass = 'gateway' | 'upstream' | 'reject';

const GATEWAY_ROUTES = [
  /^\/gateway\/(login|setup|logout)\/?$/,
  /^\/gateway\/api\/(me|logout|directories|overview|permissions|chat-settings)\/?$/,
  /^\/gateway\/api\/users(?:\/[^/]+)?\/?$/,
  /^\/gateway\/api\/usage\/report\/?$/,
  /^\/gateway\/api\/messages(?:\/stream)?\/?$/,
  /^\/gateway\/internal\/(health|patch|revoke-user)\/?$/,
];

function rawPathOf(requestTarget: string): string {
  if (/^https?:\/\//i.test(requestTarget)) {
    try { return new URL(requestTarget).pathname; } catch { return requestTarget; }
  }
  return requestTarget.split('?')[0] || '/';
}

function decodePath(rawPath: string): { decoded: string; malformed: boolean } {
  let decoded = rawPath;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return { decoded, malformed: true };
    }
  }
  return { decoded, malformed: false };
}

/** Keep the reserved /gateway namespace out of the upstream SPA fallback. */
export function classifyGatewayPath(requestTarget: string): GatewayPathClass {
  const rawPath = rawPathOf(requestTarget);
  const { decoded, malformed } = decodePath(rawPath);
  const rawClaimsGateway = /^\/gateway(?:\/|$)/.test(rawPath);
  const decodedClaimsGateway = /^\/gateway(?:\/|$)/.test(decoded);
  let normalized: string;
  try {
    normalized = new URL(decoded.replace(/\/+/g, '/'), 'http://localhost').pathname;
  } catch {
    return rawClaimsGateway || decodedClaimsGateway ? 'reject' : 'upstream';
  }
  const normalizedClaimsGateway = normalized === '/gateway' || normalized.startsWith('/gateway/');
  if (!rawClaimsGateway && !decodedClaimsGateway && !normalizedClaimsGateway) return 'upstream';
  if (malformed || rawPath !== normalized) return 'reject';
  return GATEWAY_ROUTES.some((route) => route.test(normalized)) ? 'gateway' : 'reject';
}
