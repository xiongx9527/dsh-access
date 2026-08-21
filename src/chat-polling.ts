export interface ChatPollState {
  initialized: boolean;
  lastSeenId: number;
  rebuilding: boolean;
}

export interface PollMessage {
  id: number;
  sender_id: number;
}

export function pollUrl(state: ChatPollState): string {
  return state.rebuilding ? '/gateway/api/messages' : `/gateway/api/messages?since=${state.lastSeenId}`;
}

export function nextChatPollState(
  state: ChatPollState,
  messages: readonly PollMessage[],
  latestId: number,
  currentUserId: number,
  panelOpen: boolean,
): { state: ChatPollState; unread: number } {
  if (!state.rebuilding && state.initialized && latestId < state.lastSeenId) {
    return { state: { initialized: true, lastSeenId: 0, rebuilding: true }, unread: 0 };
  }
  const maxIncoming = messages.reduce((max, message) => Math.max(max, message.id), 0);
  const cursor = Math.max(latestId, maxIncoming);
  const unread = !state.initialized || state.rebuilding || panelOpen
    ? 0
    : messages.filter((message) => message.id > state.lastSeenId && message.sender_id !== currentUserId).length;
  return {
    state: { initialized: true, lastSeenId: cursor, rebuilding: false },
    unread,
  };
}
