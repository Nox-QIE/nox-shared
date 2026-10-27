export type Role = "werewolf" | "seer" | "doctor" | "villager" | "hunter" | "witch" | "cupid";
export type Team = "wolves" | "village";
export type Phase = "night" | "day" | "ended";
/** Secret actions committed on chain: the night roles' actions, and the hunter's last shot. */
export type NightActionKind = "kill" | "inspect" | "protect" | "heal" | "poison" | "shoot" | "link";
/**
 * "classic": werewolves, seer, doctor, villagers. "extended" adds the hunter (6+ players), cupid (7+)
 * and the witch (8+).
 */
export type RoleSet = "classic" | "extended";

export interface RoleAssignment {
  /** Stable player id (wallet address or Telegram id). */
  id: string;
  role: Role;
}

export interface GameConfig {
  /** Reveal a player's role publicly when they are eliminated. */
  revealOnDeath: boolean;
  /** Role set; "classic" when absent. */
  roleSet?: RoleSet;
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
  /** Potions each witch has used (one heal and one poison per game). */
  potionsUsed: Readonly<Record<string, readonly ("heal" | "poison")[]>>;
  /** A hunter who just died and must shoot (or pass) before the game goes on to `next`. */
  pendingShot: { hunter: string; next: "day" | "night" } | null;
  /** The lovers: cupid and the player cupid linked on night 1. When one dies, the other dies too. */
  lovers: readonly [string, string] | null;
}

export type Command =
  /** `kind` is needed only for the witch, who picks between her potions. */
  | { type: "night_action"; actor: string; target: string; kind?: NightActionKind }
  | { type: "end_night" }
  | { type: "vote"; voter: string; target: string }
  | { type: "end_day" }
  | { type: "shoot"; actor: string; target: string }
  | { type: "skip_shot" };

export type Visibility = { scope: "public" } | { scope: "private"; to: readonly string[] };

export type GameEvent =
  | { type: "night_started"; round: number; visibility: Visibility }
  | { type: "night_action_recorded"; actor: string; kind: NightActionKind; visibility: Visibility }
  | { type: "inspection_result"; seer: string; target: string; isWerewolf: boolean; visibility: Visibility }
  | { type: "night_resolved"; round: number; eliminated: string | null; revealedRole: Role | null; visibility: Visibility }
  /** The wolves have all chosen: the witch learns their victim while she still holds her heal. */
  | { type: "victim_known"; witch: string; target: string; visibility: Visibility }
  /** A death besides the night's victim and the day's exile: the witch's poison or the hunter's shot. */
  | { type: "player_died"; round: number; id: string; cause: "poison" | "shot" | "heartbreak"; revealedRole: Role | null; visibility: Visibility }
  /** Cupid's link, told to both lovers only. */
  | { type: "lovers_linked"; lovers: readonly [string, string]; visibility: Visibility }
  | { type: "hunter_must_shoot"; hunter: string; visibility: Visibility }
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
