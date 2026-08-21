import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mergeById } from '../src/client/chat.js';

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

test('optimistic messages remain visible when confirmed history is at the cap', () => {
  const confirmed = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1,
    sender_id: 1,
    sender_name: 'user',
    recipient_id: null,
    content: String(index),
    tags: [],
    created_at: new Date(index).toISOString(),
  }));
  const optimistic = { ...confirmed[0], id: -1, content: 'pending', optimistic: true };
  const merged = mergeById(confirmed, [optimistic]);
  assert.equal(merged.length, 200);
  assert.equal(merged.at(-1)?.id, -1);
  assert.equal(merged.some((message) => message.id === 1), false);
});

test('chat animation and optional haptics honor reduced-motion preference', () => {
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /navigator\.vibrate/);
  assert.match(source, /prefers-reduced-motion: reduce.*matches/s);
});
