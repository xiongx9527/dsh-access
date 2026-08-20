import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/client/account.tsx', import.meta.url), 'utf8');

test('account chrome polls current identity so deleted, banned, and credential-changed pages redirect even if SSE is interrupted', () => {
  assert.match(source, /setInterval\(\(\) => \{/);
  assert.match(source, /fetch\('\/gateway\/api\/me'/);
  assert.match(source, /body\.code === 'ACCOUNT_BANNED'/);
  assert.match(source, /window\.location\.assign\(`\/gateway\/login\?reason=\$\{reason\}`\)/);
});
