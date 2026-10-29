export class TurnNavigation {
  following = true;
  private seen = new Set<string>();

  reset() { this.following = true; this.seen.clear(); }
  pause(turns: {id: string}[]) {
    this.following = false;
    for (const turn of turns) this.seen.add(turn.id);
  }
  unread(turns: {id: string}[]) {
    return this.following ? 0 : turns.filter(turn => !this.seen.has(turn.id)).length;
  }
  shouldDisplay(current: {id: string; createdAt: number} | null, incoming: {id: string; createdAt: number}) {
    return this.following && (!current || incoming.id === current.id || incoming.createdAt >= current.createdAt);
  }
}
