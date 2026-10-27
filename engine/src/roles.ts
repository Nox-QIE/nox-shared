import { GameRuleError, type Role, type RoleAssignment, type RoleSet, type Team } from "./types.js";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;

const WEREWOLVES_BY_COUNT: Record<number, number> = {
  5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3,
};

/**
 * Role multiset for a player count. One seer and one doctor at every size; the extended set turns
 * one villager into the hunter from 6 players and another into the witch from 8.
 */
export function roleComposition(playerCount: number, roleSet: RoleSet = "classic"): Role[] {
  const wolves = WEREWOLVES_BY_COUNT[playerCount];
  if (wolves === undefined) {
    throw new GameRuleError("bad_player_count", `player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`);
  }
  const extra: Role[] = roleSet === "extended" ? [...(playerCount >= 6 ? ["hunter" as const] : []), ...(playerCount >= 8 ? ["witch" as const] : [])] : [];
  const villagers = playerCount - wolves - 2 - extra.length;
  return [
    ...Array<Role>(wolves).fill("werewolf"),
    "seer",
    "doctor",
    ...extra,
    ...Array<Role>(villagers).fill("villager"),
  ];
}

export function teamOf(role: Role): Team {
  return role === "werewolf" ? "wolves" : "village";
}

/**
 * Fisher–Yates shuffle with an injected random source, so the engine itself never
 * touches Math.random. Callers must pass a CSPRNG-backed `randomInt(maxExclusive)`.
 */
export function assignRoles(
  playerIds: readonly string[],
  randomInt: (maxExclusive: number) => number,
  roleSet: RoleSet = "classic",
): RoleAssignment[] {
  const roles = roleComposition(playerIds.length, roleSet);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new GameRuleError("duplicate_player", "player ids must be unique");
  }
  for (let i = roles.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new GameRuleError("bad_random", `randomInt(${i + 1}) returned ${j}`);
    }
    [roles[i], roles[j]] = [roles[j]!, roles[i]!];
  }
  return playerIds.map((id, i) => ({ id, role: roles[i]! }));
}
