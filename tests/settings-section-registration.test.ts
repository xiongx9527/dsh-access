import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('access management registers as a top-level settings section, not a plugin card', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /name: 'settings\.section'/);
  assert.match(source, /id: 'dsh-access',\s*key: 'dsh-access'/);
  assert.match(source, /id: 'dsh-access-chat',\s*key: 'dsh-access-chat'/);
  assert.match(source, /id: 'dsh-access-token',\s*key: 'dsh-access-token'/);
  assert.match(source, /label: \(\) => '访问管理'/);
  assert.doesNotMatch(source, /name: 'settings\.plugin\.item'/);
});

test('user-facing access management labels use the new names', () => {
  const source = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8');
  assert.match(source, /title: '访问管理'/);
  assert.match(source, /accountTab: '账号权限'/);
  assert.match(source, /title: 'Access management'/);
  assert.match(source, /accountTab: 'Account permissions'/);
});

test('access management page renders open without a collapsible card header', () => {
  const source = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  assert.match(source, /return h\('div', \{ className: 'dsh-access-card open' \}, body\)/);
  assert.doesNotMatch(source, /aria-expanded.*open/);
  assert.doesNotMatch(source, /const \[open, setOpen\]/);
});
