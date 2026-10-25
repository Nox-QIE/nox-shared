import type { GameEvent, GameState, Phase, Role, Team } from "./types.js";

/** What everyone (including the AI Game Master) may see. Never contains live roles. */
export interface PublicView {
  phase: Phase;
  round: number;
  alive: string[];
  eliminated: { id: string; revealedRole: Role | null }[];
  votesCast: number;
  winner: Team | null;
}

export function publicView(state: GameState, events: readonly GameEvent[]): PublicView {
  const revealed = new Map<string, Role | null>();
  for (const e of events) {
    if ((e.type === "night_resolved" || e.type === "day_resolved") && e.eliminated) {
      revealed.set(e.eliminated, e.revealedRole);
    }
  }
  const ended = state.phase === "ended";
  return {
    phase: state.phase,
    round: state.round,
    alive: state.seats.filter((id) => state.players[id]!.alive),
    eliminated: state.seats
      .filter((id) => !state.players[id]!.alive)
      .map((id) => ({ id, revealedRole: ended ? state.players[id]!.role : (revealed.get(id) ?? null) })),
    votesCast: Object.keys(state.votes).length,
    winner: state.winner,
  };
}

/** Events a given player is allowed to see (public + their own private ones). */
export function eventsFor(playerId: string, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => e.visibility.scope === "public" || e.visibility.to.includes(playerId));
}
