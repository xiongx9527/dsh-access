/** Parse one Cookie header value without treating Unicode whitespace as RFC 6265 OWS. */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const field of cookieHeader.split(';')) {
    const part = field.replace(/^[\t ]+|[\t ]+$/g, '');
    const equals = part.indexOf('=');
    if (equals <= 0 || part.slice(0, equals) !== name) continue;
    const raw = part.slice(equals + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
