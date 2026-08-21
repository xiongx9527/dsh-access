export interface ChatPollState {
  initialized: boolean;
  lastSeenId: number;
  rebuilding: boolean;
  epoch: string | null;
}

export interface PollMessage { id: number; sender_id: number }

export function pollUrl(state: ChatPollState): string {
  return state.rebuilding ? '/gateway/api/messages' : `/gateway/api/messages?since=${state.lastSeenId}`;
}

export function nextChatPollState(
  state: ChatPollState,
  messages: readonly PollMessage[],
  latestId: number,
  epoch: string,
  currentUserId: number,
  panelOpen: boolean,
): { state: ChatPollState; unread: number } {
  if (!state.rebuilding && state.initialized && (latestId < state.lastSeenId || (state.epoch !== null && epoch !== state.epoch))) {
    return { state: { initialized: true, lastSeenId: 0, rebuilding: true, epoch }, unread: 0 };
  }
  const maxIncoming = messages.reduce((max, message) => Math.max(max, message.id), 0);
  const cursor = messages.length > 0 ? maxIncoming : (state.rebuilding || !state.initialized ? latestId : state.lastSeenId);
  const unread = !state.initialized || state.rebuilding || panelOpen
    ? 0
    : messages.filter((message) => message.id > state.lastSeenId && message.sender_id !== currentUserId).length;
  return { state: { initialized: true, lastSeenId: cursor, rebuilding: false, epoch }, unread };
}
