export type GatewayPathClass = 'gateway' | 'upstream' | 'reject';

type Route = { methods: readonly string[]; path: RegExp };
const GATEWAY_ROUTES: readonly Route[] = [
  { methods: ['GET', 'POST'], path: /^\/gateway\/login\/?$/ },
  { methods: ['POST'], path: /^\/gateway\/setup\/?$/ },
  { methods: ['GET'], path: /^\/gateway\/logout\/?$/ },
  { methods: ['GET'], path: /^\/gateway\/api\/(me|directories|overview|chat-settings)\/?$/ },
  { methods: ['POST'], path: /^\/gateway\/api\/(logout|permissions|chat-settings)\/?$/ },
  { methods: ['GET', 'POST'], path: /^\/gateway\/api\/messages\/?$/ },
  { methods: ['GET'], path: /^\/gateway\/api\/messages\/stream\/?$/ },
  { methods: ['POST'], path: /^\/gateway\/api\/users\/?$/ },
  { methods: ['DELETE'], path: /^\/gateway\/api\/users\/[^/]+\/?$/ },
  { methods: ['POST'], path: /^\/gateway\/api\/usage\/report\/?$/ },
  { methods: ['GET'], path: /^\/gateway\/internal\/health\/?$/ },
  { methods: ['POST'], path: /^\/gateway\/internal\/(patch|revoke-user)\/?$/ },
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
export function classifyGatewayRequestTarget(method: string, requestTarget: string): GatewayPathClass {
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
  const upperMethod = method.toUpperCase();
  return GATEWAY_ROUTES.some((route) => route.methods.includes(upperMethod) && route.path.test(normalized))
    ? 'gateway'
    : 'reject';
}
