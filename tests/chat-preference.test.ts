import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('chat visibility preference is server-backed and scoped by authenticated user id', () => {
  const gateway = readFileSync(new URL('../src/gateway.ts', import.meta.url), 'utf8');
  assert.match(gateway, /chat_enabled:\$\{String\(me\.userId\)\}/);
  assert.match(gateway, /app\.get\('\/gateway\/api\/chat-settings'/);
  assert.match(gateway, /app\.post\('\/gateway\/api\/chat-settings'/);
});

test('chat launcher loads the account preference and the access page can restore it', () => {
  const chat = readFileSync(new URL('../src/client/chat.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/client/card.tsx', import.meta.url), 'utf8');
  assert.match(chat, /\/gateway\/api\/chat-settings/);
  assert.match(chat, /if \(chatEnabled !== true\) return null/);
  assert.match(card, /chatEnabled/);
  assert.match(card, /\/gateway\/api\/chat-settings/);
});
