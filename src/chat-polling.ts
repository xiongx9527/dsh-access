export interface ChatPollState {
  initialized: boolean;
  lastSeenId: number;
  rebuilding: boolean;
  epoch: string | null;
}

export interface PollMessage { id: number; sender_id: number }

export function pollUrl(state: ChatPollState): string {
  return state.rebuilding || !state.initialized
    ? '/gateway/api/messages'
    : `/gateway/api/messages?since=${state.lastSeenId}`;
}

export function nextChatPollState(
  state: ChatPollState,
  messages: readonly PollMessage[],
  latestId: number,
  epoch: string,
  currentUserId: number,
  panelOpen: boolean,
): { state: ChatPollState; unread: number; replaceMessages: boolean } {
  if (!state.rebuilding && state.initialized && (latestId < state.lastSeenId || (state.epoch !== null && epoch !== state.epoch))) {
    return { state: { initialized: true, lastSeenId: 0, rebuilding: true, epoch }, unread: 0, replaceMessages: false };
  }
  const establishingBaseline = state.rebuilding || !state.initialized;
  const maxIncoming = messages.reduce((max, message) => Math.max(max, message.id), 0);
  const cursor = establishingBaseline ? latestId : (messages.length > 0 ? maxIncoming : state.lastSeenId);
  const unread = establishingBaseline || panelOpen
    ? 0
    : messages.filter((message) => message.id > state.lastSeenId && message.sender_id !== currentUserId).length;
  return {
    state: { initialized: true, lastSeenId: cursor, rebuilding: false, epoch },
    unread,
    replaceMessages: establishingBaseline,
  };
}
