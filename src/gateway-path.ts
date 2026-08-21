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
    const authorityStart = requestTarget.indexOf('//') + 2;
    const delimiter = requestTarget.slice(authorityStart).search(/[/?#]/);
    if (delimiter < 0 || requestTarget[authorityStart + delimiter] !== '/') return '/';
    return requestTarget.slice(authorityStart + delimiter).split(/[?#]/, 1)[0] || '/';
  }
  return requestTarget.split(/[?#]/, 1)[0] || '/';
}

function decodeAsciiEscapes(rawPath: string): { decoded: string; exhausted: boolean } {
  let decoded = rawPath;
  for (let index = 0; index < 16; index += 1) {
    const next = decoded.replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === decoded) return { decoded, exhausted: false };
    decoded = next;
  }
  return { decoded, exhausted: /%([0-7][0-9a-f])/i.test(decoded) };
}

/** Keep the reserved /gateway namespace out of the upstream SPA fallback. */
export function classifyGatewayRequestTarget(method: string, requestTarget: string): GatewayPathClass {
  // Only origin-form and well-formed HTTP absolute-form targets are supported. WHATWG treats
  // backslashes and extra leading slashes as separators, so forwarding those is ambiguous.
  if (requestTarget.includes('\\') || requestTarget.startsWith('//') || /^https?:\/{3,}/i.test(requestTarget)) {
    return 'reject';
  }
  const rawPath = rawPathOf(requestTarget);
  const { decoded, exhausted } = decodeAsciiEscapes(rawPath);
  if (exhausted || decoded.includes('\\')) return 'reject';
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
  if (rawPath !== normalized) return 'reject';
  const upperMethod = method.toUpperCase();
  return GATEWAY_ROUTES.some((route) => route.methods.includes(upperMethod) && route.path.test(normalized))
    ? 'gateway'
    : 'reject';
}
