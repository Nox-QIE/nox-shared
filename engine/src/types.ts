export type Role = "werewolf" | "seer" | "doctor" | "villager";
export type Team = "wolves" | "village";
export type Phase = "night" | "day" | "ended";
export type NightActionKind = "kill" | "inspect" | "protect";

export interface RoleAssignment {
  /** Stable player id (wallet address or Telegram id). */
  id: string;
  role: Role;
}

export interface GameConfig {
  /** Reveal a player's role publicly when they are eliminated. */
  revealOnDeath: boolean;
}

export interface PlayerState {
  role: Role;
  alive: boolean;
}

export interface GameState {
  phase: Phase;
  /** Starts at 1; increments when a new night begins. */
  round: number;
  /** Seat order, fixed at creation. Used for deterministic tie-breaks. */
  seats: readonly string[];
  players: Readonly<Record<string, PlayerState>>;
  config: GameConfig;
  /** Night actions submitted in the current night, keyed by actor id. */
  nightActions: Readonly<Record<string, { kind: NightActionKind; target: string }>>;
  /** Day votes in the current day, keyed by voter id. */
  votes: Readonly<Record<string, string>>;
  winner: Team | null;
}

export type Command =
  | { type: "night_action"; actor: string; target: string }
  | { type: "end_night" }
  | { type: "vote"; voter: string; target: string }
  | { type: "end_day" };

export type Visibility = { scope: "public" } | { scope: "private"; to: readonly string[] };

export type GameEvent =
  | { type: "night_started"; round: number; visibility: Visibility }
  | { type: "night_action_recorded"; actor: string; kind: NightActionKind; visibility: Visibility }
  | { type: "inspection_result"; seer: string; target: string; isWerewolf: boolean; visibility: Visibility }
  | { type: "night_resolved"; round: number; eliminated: string | null; revealedRole: Role | null; visibility: Visibility }
  | { type: "day_started"; round: number; visibility: Visibility }
  | { type: "vote_recorded"; voter: string; target: string; visibility: Visibility }
  | { type: "day_resolved"; round: number; eliminated: string | null; revealedRole: Role | null; tally: Record<string, number>; visibility: Visibility }
  | { type: "game_ended"; winner: Team; roles: Record<string, Role>; visibility: Visibility };

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

export class GameRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}
