const HIDDEN_UNICODE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad\u180e\u034f\u061c\u115f\u1160]/g;

export function sanitizeHiddenUnicode(content: string): string {
  return content.replace(HIDDEN_UNICODE_RE, '');
}

export function sanitizeText(content: string): string {
  return content
    .replace(HIDDEN_UNICODE_RE, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, ' ')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, ' ')
    .replace(/url\(\s*['"]?[^)'"]+['"]?\s*\)/gi, ' ')
    .replace(/image-set\([^)]*\)/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeJsonStrings(value: unknown, depth = 0): unknown {
  if (depth > 64) return null;
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonStrings(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeJsonStrings(nested, depth + 1)]));
}
