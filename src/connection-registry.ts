export type ConnectionRevoker = (reason: string) => void;

/** Tracks revocable long-lived transports by authenticated user id. */
export class UserConnectionRegistry {
  private readonly byUser = new Map<number, Set<ConnectionRevoker>>();

  track(userId: number, revoke: ConnectionRevoker): () => void {
    let connections = this.byUser.get(userId);
    if (!connections) {
      connections = new Set();
      this.byUser.set(userId, connections);
    }
    connections.add(revoke);
    return () => {
      const current = this.byUser.get(userId);
      if (!current) return;
      current.delete(revoke);
      if (current.size === 0) this.byUser.delete(userId);
    };
  }

  revoke(userId: number, reason: string): number {
    const connections = this.byUser.get(userId);
    if (!connections) return 0;
    this.byUser.delete(userId);
    const pending = [...connections];
    for (const close of pending) {
      try {
        close(reason);
      } catch {
        // One broken transport must not prevent the remaining connections from closing.
      }
    }
    return pending.length;
  }

  count(userId: number): number {
    return this.byUser.get(userId)?.size ?? 0;
  }
}
