export type HostResolver = (hostname: string) => Promise<readonly string[]>;

type V4 = [number, number, number, number];

function parseV4(input: string): V4 | null {
  const fields = input.split('.');
  if (fields.length < 1 || fields.length > 4) return null;
  const values = fields.map((field) => {
    if (/^0x[0-9a-f]+$/i.test(field)) return Number.parseInt(field.slice(2), 16);
    if (/^0[0-7]+$/.test(field)) return Number.parseInt(field.slice(1), 8);
    if (/^\d+$/.test(field)) return Number.parseInt(field, 10);
    return Number.NaN;
  });
  if (values.some((value) => !Number.isSafeInteger(value))) return null;
  const widths = [0xffffffff, 0xffffff, 0xffff, 0xff];
  if (values.slice(0, -1).some((value) => value > 0xff) || values.at(-1)! > widths[fields.length - 1]) return null;
  const bytes = values.slice(0, -1);
  const last = values.at(-1)!;
  for (let shift = (4 - fields.length) * 8; shift >= 0; shift -= 8) bytes.push((last >>> shift) & 0xff);
  return bytes as V4;
}

function privateV4([a, b]: V4): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function parseV6(input: string): number[] | null {
  const source = input.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(source) || source.split('::').length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const out: number[] = [];
    for (const [index, field] of side.split(':').entries()) {
      if (/^[0-9a-f]{1,4}$/.test(field)) out.push(Number.parseInt(field, 16));
      else if (index === side.split(':').length - 1) {
        const v4 = parseV4(field); if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else return null;
    }
    return out;
  };
  const halves = source.split('::');
  const left = parseSide(halves[0]); const right = parseSide(halves[1] ?? '');
  if (!left || !right) return null;
  let groups: number[];
  if (halves.length === 1) groups = left.length === 8 ? left : [];
  else groups = left.length + right.length < 8 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : [];
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >>> 8, group & 0xff]);
}

function privateV6(bytes: number[]): boolean {
  if (bytes.every((value) => value === 0)) return true;
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) return true;
  if (bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return privateV4(bytes.slice(12) as V4);
  if (bytes.slice(0, 12).every((value) => value === 0)) return privateV4(bytes.slice(12) as V4);
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((value) => value === 0)) return privateV4(bytes.slice(12) as V4);
  return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) >= 0x80) || bytes[0] === 0xff;
}

export function isPrivateHost(host: string): boolean {
  let value = host.trim().toLowerCase();
  if (!value || value === 'localhost' || value === 'localhost.localdomain' || value.includes('%')) return true;
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracket) value = bracket[1];
  else if (/^[^:]+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  const v4 = parseV4(value); if (v4) return privateV4(v4);
  const v6 = parseV6(value); return v6 ? privateV6(v6) : false;
}

export async function isSshHostAllowed(host: string, resolve: HostResolver): Promise<boolean> {
  const value = host.trim().toLowerCase();
  if (!value || isPrivateHost(value)) return false;
  if (parseV4(value) || parseV6(value)) return true;
  try {
    const addresses = await resolve(value);
    return addresses.length > 0 && addresses.every((address) => !isPrivateHost(address));
  } catch { return false; }
}

export async function sshHostRequestAllowed(
  method: string,
  pathname: string,
  body: unknown,
  resolve: HostResolver,
): Promise<boolean> {
  const needsCheck = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) &&
    /^\/api\/dsh-ssh[.\/](hosts|test)([.\/]|$)/.test(pathname);
  if (!needsCheck) return true;
  if (body === null || typeof body !== 'object') return false;
  const host = (body as Record<string, unknown>).host;
  return typeof host !== 'string' ? true : isSshHostAllowed(host, resolve);
}
