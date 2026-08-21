import assert from 'node:assert/strict';
import test from 'node:test';
import { nextChatPollState, pollUrl, type ChatPollState } from '../src/chat-polling.js';

const baseline: ChatPollState = { initialized: false, lastSeenId: 0, rebuilding: false };

test('empty databases establish an incremental zero baseline instead of repeated full loads', () => {
  const next = nextChatPollState(baseline, [], 0, 7, false);
  assert.deepEqual(next.state, { initialized: true, lastSeenId: 0, rebuilding: false });
  assert.equal(next.unread, 0);
  assert.equal(pollUrl(next.state), '/gateway/api/messages?since=0');
});

test('incremental messages advance the cursor and count only other senders', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 4, rebuilding: false };
  const next = nextChatPollState(state, [{ id: 5, sender_id: 7 }, { id: 6, sender_id: 8 }], 6, 7, false);
  assert.equal(next.state.lastSeenId, 6);
  assert.equal(next.unread, 1);
});

test('database id rollback schedules one full baseline rebuild without phantom unread', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 99, rebuilding: false };
  const rollback = nextChatPollState(state, [], 3, 7, false);
  assert.deepEqual(rollback.state, { initialized: true, lastSeenId: 0, rebuilding: true });
  assert.equal(pollUrl(rollback.state), '/gateway/api/messages');
  const rebuilt = nextChatPollState(rollback.state, [{ id: 1, sender_id: 8 }, { id: 3, sender_id: 8 }], 3, 7, false);
  assert.equal(rebuilt.unread, 0);
  assert.deepEqual(rebuilt.state, { initialized: true, lastSeenId: 3, rebuilding: false });
});

test('open chat panels do not accrue unread messages', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 1, rebuilding: false };
  assert.equal(nextChatPollState(state, [{ id: 2, sender_id: 8 }], 2, 7, true).unread, 0);
});
