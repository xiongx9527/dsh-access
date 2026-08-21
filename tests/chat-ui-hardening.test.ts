import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/client/chat.tsx', import.meta.url), 'utf8');

test('chat launcher persists a per-account dragged position and suppresses accidental open', () => {
  assert.match(source, /dsh-access-chat-position:\$\{me\.id\}/);
  assert.match(source, /event\.pointerType === 'mouse' && event\.button !== 0/);
  assert.match(source, /draggedRef\.current/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /positionRef\.current/);
});

test('chat messages render avatars and optimistic sends recover on failure', () => {
  assert.match(source, /dsh-access-chat-avatar/);
  assert.match(source, /optimistic/);
  assert.match(source, /setDraft\(content\)/);
  assert.match(source, /temporaryId/);
});

test('chat animation is disabled for reduced-motion users', () => {
  assert.match(source, /prefers-reduced-motion: reduce/);
});
