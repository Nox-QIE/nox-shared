import { roleComposition, teamOf } from "./roles.js";
import {
  GameRuleError,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type NightActionKind,
  type PlayerState,
  type Role,
  type RoleAssignment,
  type Team,
  type Transition,
} from "./types.js";

const PUBLIC = { scope: "public" } as const;
const only = (...to: string[]) => ({ scope: "private", to }) as const;

export const DEFAULT_CONFIG: GameConfig = { revealOnDeath: true };

const ACTION_BY_ROLE: Partial<Record<Role, NightActionKind>> = {
  werewolf: "kill",
  seer: "inspect",
  doctor: "protect",
};

/** Create a game that starts at night 1. Validates the role composition. */
export function createGame(assignments: readonly RoleAssignment[], config: GameConfig = DEFAULT_CONFIG): Transition {
  const expected = [...roleComposition(assignments.length)].sort();
  const actual = assignments.map((a) => a.role).sort();
  if (expected.join() !== actual.join()) {
    throw new GameRuleError("bad_composition", `roles do not match composition for ${assignments.length} players`);
  }
  const players: Record<string, PlayerState> = {};
  for (const a of assignments) {
    if (players[a.id]) throw new GameRuleError("duplicate_player", `duplicate player ${a.id}`);
    players[a.id] = { role: a.role, alive: true };
  }
  const state: GameState = {
    phase: "night",
    round: 1,
    seats: assignments.map((a) => a.id),
    players,
    config,
    nightActions: {},
    votes: {},
    winner: null,
  };
  return { state, events: [{ type: "night_started", round: 1, visibility: PUBLIC }] };
}

/** Pure state transition. Throws GameRuleError on illegal commands; never mutates input. */
export function apply(state: GameState, cmd: Command): Transition {
  if (state.phase === "ended") throw new GameRuleError("game_over", "game has ended");
  switch (cmd.type) {
    case "night_action":
      return nightAction(state, cmd.actor, cmd.target);
    case "end_night":
      return endNight(state);
    case "vote":
      return vote(state, cmd.voter, cmd.target);
    case "end_day":
      return endDay(state);
  }
}

/** Fold a command log over an initial assignment. Same input always gives the same output. */
export function replay(
  assignments: readonly RoleAssignment[],
  commands: readonly Command[],
  config: GameConfig = DEFAULT_CONFIG,
): Transition {
  let { state, events } = createGame(assignments, config);
  const all = [...events];
  for (const cmd of commands) {
    const t = apply(state, cmd);
    state = t.state;
    all.push(...t.events);
  }
  return { state, events: all };
}

export function alivePlayers(state: GameState): string[] {
  return state.seats.filter((id) => state.players[id]!.alive);
}

function requireAlive(state: GameState, id: string, code: string): PlayerState {
  const p = state.players[id];
  if (!p) throw new GameRuleError(`${code}_unknown`, `unknown player ${id}`);
  if (!p.alive) throw new GameRuleError(`${code}_dead`, `player ${id} is eliminated`);
  return p;
}

function nightAction(state: GameState, actor: string, target: string): Transition {
  if (state.phase !== "night") throw new GameRuleError("wrong_phase", "night actions only at night");
  const me = requireAlive(state, actor, "actor");
  const kind = ACTION_BY_ROLE[me.role];
  if (!kind) throw new GameRuleError("no_night_action", `${me.role} has no night action`);
  const t = requireAlive(state, target, "target");
  if (kind === "kill" && t.role === "werewolf") throw new GameRuleError("bad_target", "werewolves cannot target werewolves");
  if (kind === "inspect" && target === actor) throw new GameRuleError("bad_target", "seer cannot inspect self");
  if (state.nightActions[actor]) throw new GameRuleError("already_acted", `${actor} already acted this night`);

  const next: GameState = { ...state, nightActions: { ...state.nightActions, [actor]: { kind, target } } };
  return { state: next, events: [{ type: "night_action_recorded", actor, kind, visibility: only(actor) }] };
}

/** Werewolf target = plurality of wolf choices; ties go to the earliest seat. */
function wolfTarget(state: GameState): string | null {
  const counts = new Map<string, number>();
  for (const [, a] of Object.entries(state.nightActions)) {
    if (a.kind === "kill") counts.set(a.target, (counts.get(a.target) ?? 0) + 1);
  }
  return pluralityBySeat(state.seats, counts);
}

function pluralityBySeat(seats: readonly string[], counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const id of seats) {
    const c = counts.get(id) ?? 0;
    if (c > bestCount) {
      best = id;
      bestCount = c;
    }
  }
  return best;
}

function endNight(state: GameState): Transition {
  if (state.phase !== "night") throw new GameRuleError("wrong_phase", "not night");
  const events: GameEvent[] = [];
  const actions = Object.entries(state.nightActions);

  for (const [seer, a] of actions) {
    if (a.kind !== "inspect") continue;
    const isWerewolf = state.players[a.target]!.role === "werewolf";
    events.push({ type: "inspection_result", seer, target: a.target, isWerewolf, visibility: only(seer) });
  }

  const protectedIds = new Set(actions.filter(([, a]) => a.kind === "protect").map(([, a]) => a.target));
  const target = wolfTarget(state);
  const eliminated = target && !protectedIds.has(target) ? target : null;

  const players = { ...state.players };
  if (eliminated) players[eliminated] = { ...players[eliminated]!, alive: false };
  const revealedRole = eliminated && state.config.revealOnDeath ? players[eliminated]!.role : null;
  events.push({ type: "night_resolved", round: state.round, eliminated, revealedRole, visibility: PUBLIC });

  const after: GameState = { ...state, players, nightActions: {} };
  return finishOr(after, events, () => ({
    state: { ...after, phase: "day" },
    events: [...events, { type: "day_started", round: state.round, visibility: PUBLIC }],
  }));
}

function vote(state: GameState, voter: string, target: string): Transition {
  if (state.phase !== "day") throw new GameRuleError("wrong_phase", "votes only during the day");
  requireAlive(state, voter, "voter");
  requireAlive(state, target, "target");
  if (state.votes[voter]) throw new GameRuleError("already_voted", `${voter} already voted`);
  const next: GameState = { ...state, votes: { ...state.votes, [voter]: target } };
  return { state: next, events: [{ type: "vote_recorded", voter, target, visibility: PUBLIC }] };
}

/** Plurality eliminates; a tie at the top eliminates nobody. Abstainers simply did not vote. */
function endDay(state: GameState): Transition {
  if (state.phase !== "day") throw new GameRuleError("wrong_phase", "not day");
  const counts = new Map<string, number>();
  for (const t of Object.values(state.votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
  const eliminated = max > 0 && leaders.length === 1 ? leaders[0]! : null;

  const players = { ...state.players };
  if (eliminated) players[eliminated] = { ...players[eliminated]!, alive: false };
  const revealedRole = eliminated && state.config.revealOnDeath ? players[eliminated]!.role : null;
  const tally = Object.fromEntries(state.seats.filter((id) => counts.has(id)).map((id) => [id, counts.get(id)!]));
  const events: GameEvent[] = [
    { type: "day_resolved", round: state.round, eliminated, revealedRole, tally, visibility: PUBLIC },
  ];

  const after: GameState = { ...state, players, votes: {} };
  return finishOr(after, events, () => {
    const round = state.round + 1;
    return {
      state: { ...after, phase: "night", round },
      events: [...events, { type: "night_started", round, visibility: PUBLIC }],
    };
  });
}

export function winnerOf(state: GameState): Team | null {
  let wolves = 0;
  let village = 0;
  for (const id of state.seats) {
    const p = state.players[id]!;
    if (!p.alive) continue;
    if (teamOf(p.role) === "wolves") wolves++;
    else village++;
  }
  if (wolves === 0) return "village";
  if (wolves >= village) return "wolves";
  return null;
}

function finishOr(after: GameState, events: GameEvent[], cont: () => Transition): Transition {
  const winner = winnerOf(after);
  if (!winner) return cont();
  const roles = Object.fromEntries(after.seats.map((id) => [id, after.players[id]!.role]));
  return {
    state: { ...after, phase: "ended", winner },
    events: [...events, { type: "game_ended", winner, roles, visibility: PUBLIC }],
  };
}
