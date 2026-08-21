import assert from 'node:assert/strict';
import test from 'node:test';
import { nextChatPollState, pollUrl, type ChatPollState } from '../src/chat-polling.js';

const baseline: ChatPollState = { initialized: false, lastSeenId: 0, rebuilding: false, epoch: null };

test('empty databases establish an incremental zero baseline instead of repeated full loads', () => {
  const next = nextChatPollState(baseline, [], 0, 'db-a', 7, false);
  assert.deepEqual(next.state, { initialized: true, lastSeenId: 0, rebuilding: false, epoch: 'db-a' });
  assert.equal(next.unread, 0);
  assert.equal(pollUrl(next.state), '/gateway/api/messages?since=0');
});

test('incremental messages advance the cursor and count only other senders', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 4, rebuilding: false, epoch: 'db-a' };
  const next = nextChatPollState(state, [{ id: 5, sender_id: 7 }, { id: 6, sender_id: 8 }], 6, 'db-a', 7, false);
  assert.equal(next.state.lastSeenId, 6);
  assert.equal(next.unread, 1);
});

test('database id rollback schedules one full baseline rebuild without phantom unread', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 99, rebuilding: false, epoch: 'db-a' };
  const rollback = nextChatPollState(state, [], 3, 'db-b', 7, false);
  assert.deepEqual(rollback.state, { initialized: true, lastSeenId: 0, rebuilding: true, epoch: 'db-b' });
  assert.equal(pollUrl(rollback.state), '/gateway/api/messages');
  const rebuilt = nextChatPollState(rollback.state, [{ id: 1, sender_id: 8 }, { id: 3, sender_id: 8 }], 3, 'db-b', 7, false);
  assert.equal(rebuilt.unread, 0);
  assert.deepEqual(rebuilt.state, { initialized: true, lastSeenId: 3, rebuilding: false, epoch: 'db-b' });
});

test('open chat panels do not accrue unread messages', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 1, rebuilding: false, epoch: 'db-a' };
  assert.equal(nextChatPollState(state, [{ id: 2, sender_id: 8 }], 2, 'db-a', 7, true).unread, 0);
});

test('a limited incremental page advances only to the last delivered message', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 10, rebuilding: false, epoch: 'db-a' };
  const page = Array.from({ length: 300 }, (_, index) => ({ id: 11 + index, sender_id: 8 }));
  const next = nextChatPollState(state, page, 999, 'db-a', 7, false);
  assert.equal(next.state.lastSeenId, 310);
});

test('an equal-id database reset is detected by epoch', () => {
  const state: ChatPollState = { initialized: true, lastSeenId: 3, rebuilding: false, epoch: 'db-a' };
  assert.equal(nextChatPollState(state, [], 3, 'db-b', 7, false).state.rebuilding, true);
});
