import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('client registers a mobile sidebar toggle and 320px-safe layout rules', () => {
  const client = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/client/mobile.tsx', import.meta.url), 'utf8');
  assert.match(client, /dsh-passwords-mobile-nav/);
  assert.match(client, /@media\(max-width:640px\)/);
  assert.match(client, /data-dshpw-mobile-nav-open/);
  assert.match(client, /overflow-x:hidden/);
  assert.match(mobile, /matchMedia\(MOBILE_QUERY\)/);
  assert.match(mobile, /aria-expanded/);
  assert.match(mobile, /dshpw-mobile-backdrop/);
});
