import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isAccessManagementLabel } from '../src/client/index.js';

test('access icon matcher recognizes localized access management labels only', () => {
  assert.equal(isAccessManagementLabel('访问管理'), true);
  assert.equal(isAccessManagementLabel('  Access   management '), true);
  assert.equal(isAccessManagementLabel('插件'), false);
});

test('plugin installs an access-specific DOM icon without changing the host shell', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /dshpw-access-nav-icon/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /m5\.5 8/);
  assert.match(source, /dsh-access: access navigation icon/);
});
