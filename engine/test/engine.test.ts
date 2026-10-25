import { describe, expect, it } from "vitest";
import {
  apply,
  assignRoles,
  createGame,
  eventsFor,
  GameRuleError,
  publicView,
  replay,
  roleComposition,
  type Command,
  type GameState,
  type RoleAssignment,
} from "../src/index.js";

// 5 players: A wolf, B seer, C doctor, D & E villagers
const FIVE: RoleAssignment[] = [
  { id: "A", role: "werewolf" },
  { id: "B", role: "seer" },
  { id: "C", role: "doctor" },
  { id: "D", role: "villager" },
  { id: "E", role: "villager" },
];

function run(state: GameState, ...cmds: Command[]) {
  const events = [];
  for (const c of cmds) {
    const t = apply(state, c);
    state = t.state;
    events.push(...t.events);
  }
  return { state, events };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof GameRuleError ? e.code : "not_rule_error";
  }
  return "no_error";
};

describe("roleComposition", () => {
  it("has one seer, one doctor and the right wolf count for 5–12 players", () => {
    const wolves = { 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3 } as const;
    for (const [n, w] of Object.entries(wolves)) {
      const roles = roleComposition(Number(n));
      expect(roles).toHaveLength(Number(n));
      expect(roles.filter((r) => r === "werewolf")).toHaveLength(w);
      expect(roles.filter((r) => r === "seer")).toHaveLength(1);
      expect(roles.filter((r) => r === "doctor")).toHaveLength(1);
    }
  });

  it("rejects counts outside 5–12", () => {
    expect(code(() => roleComposition(4))).toBe("bad_player_count");
    expect(code(() => roleComposition(13))).toBe("bad_player_count");
  });
});

describe("assignRoles", () => {
  it("is a permutation of the composition and deterministic for the same random source", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const seq = [3, 1, 4, 1, 5, 2];
    const rnd = () => {
      let i = 0;
      return (max: number) => (seq[i++ % seq.length]! % max);
    };
    const a = assignRoles(ids, rnd());
    const b = assignRoles(ids, rnd());
    expect(a).toEqual(b);
    expect(a.map((x) => x.role).sort()).toEqual(roleComposition(7).sort());
  });

  it("rejects an out-of-range random source", () => {
    expect(code(() => assignRoles(["a", "b", "c", "d", "e"], () => 99))).toBe("bad_random");
  });
});

describe("createGame", () => {
  it("starts at night 1 with everyone alive", () => {
    const { state, events } = createGame(FIVE);
    expect(state.phase).toBe("night");
    expect(state.round).toBe(1);
    expect(Object.values(state.players).every((p) => p.alive)).toBe(true);
    expect(events).toEqual([{ type: "night_started", round: 1, visibility: { scope: "public" } }]);
  });

  it("rejects a wrong composition", () => {
    const bad = FIVE.map((a) => (a.id === "D" ? { ...a, role: "werewolf" as const } : a));
    expect(code(() => createGame(bad))).toBe("bad_composition");
  });
});

describe("night", () => {
  it("kills the wolf target unless the doctor protects them", () => {
    const g = createGame(FIVE).state;
    const killed = run(g, { type: "night_action", actor: "A", target: "D" }, { type: "end_night" });
    expect(killed.state.players.D!.alive).toBe(false);
    expect(killed.state.phase).toBe("day");

    const saved = run(
      g,
      { type: "night_action", actor: "A", target: "D" },
      { type: "night_action", actor: "C", target: "D" },
      { type: "end_night" },
    );
    expect(saved.state.players.D!.alive).toBe(true);
    expect(saved.events.find((e) => e.type === "night_resolved")).toMatchObject({ eliminated: null });
  });

  it("tells only the seer whether the target is a werewolf", () => {
    const g = createGame(FIVE).state;
    const r = run(g, { type: "night_action", actor: "B", target: "A" }, { type: "end_night" });
    const result = r.events.find((e) => e.type === "inspection_result");
    expect(result).toMatchObject({ seer: "B", target: "A", isWerewolf: true });
    expect(eventsFor("B", r.events).some((e) => e.type === "inspection_result")).toBe(true);
    expect(eventsFor("D", r.events).some((e) => e.type === "inspection_result")).toBe(false);
  });

  it("breaks a werewolf tie by earliest seat", () => {
    const seven: RoleAssignment[] = [
      { id: "W1", role: "werewolf" },
      { id: "W2", role: "werewolf" },
      { id: "S", role: "seer" },
      { id: "Dr", role: "doctor" },
      { id: "V1", role: "villager" },
      { id: "V2", role: "villager" },
      { id: "V3", role: "villager" },
    ];
    const r = run(
      createGame(seven).state,
      { type: "night_action", actor: "W1", target: "V3" },
      { type: "night_action", actor: "W2", target: "V1" },
      { type: "end_night" },
    );
    expect(r.state.players.V1!.alive).toBe(false);
    expect(r.state.players.V3!.alive).toBe(true);
  });

  it("rejects illegal night actions", () => {
    const g = createGame(FIVE).state;
    expect(code(() => apply(g, { type: "night_action", actor: "D", target: "A" }))).toBe("no_night_action");
    expect(code(() => apply(g, { type: "night_action", actor: "B", target: "B" }))).toBe("bad_target");
    expect(code(() => apply(g, { type: "vote", voter: "A", target: "B" }))).toBe("wrong_phase");
    const once = apply(g, { type: "night_action", actor: "A", target: "D" }).state;
    expect(code(() => apply(once, { type: "night_action", actor: "A", target: "E" }))).toBe("already_acted");
  });
});

describe("day", () => {
  const dayOne = () => run(createGame(FIVE).state, { type: "night_action", actor: "C", target: "D" }, { type: "end_night" }).state;

  it("eliminates the plurality and starts the next night", () => {
    const r = run(
      dayOne(),
      { type: "vote", voter: "B", target: "E" },
      { type: "vote", voter: "C", target: "E" },
      { type: "vote", voter: "A", target: "D" },
      { type: "end_day" },
    );
    expect(r.state.players.E!.alive).toBe(false);
    expect(r.state.phase).toBe("night");
    expect(r.state.round).toBe(2);
  });

  it("eliminates nobody on a tie", () => {
    const r = run(dayOne(), { type: "vote", voter: "B", target: "E" }, { type: "vote", voter: "C", target: "D" }, { type: "end_day" });
    expect(r.events.find((e) => e.type === "day_resolved")).toMatchObject({ eliminated: null });
  });

  it("rejects a second vote and votes from eliminated players", () => {
    const d = apply(dayOne(), { type: "vote", voter: "B", target: "E" }).state;
    expect(code(() => apply(d, { type: "vote", voter: "B", target: "D" }))).toBe("already_voted");
    const killedD = run(createGame(FIVE).state, { type: "night_action", actor: "A", target: "D" }, { type: "end_night" }).state;
    expect(code(() => apply(killedD, { type: "vote", voter: "D", target: "A" }))).toBe("voter_dead");
  });
});

describe("win conditions", () => {
  it("village wins when the last werewolf is voted out", () => {
    const r = replay(FIVE, [
      { type: "end_night" },
      { type: "vote", voter: "B", target: "A" },
      { type: "vote", voter: "C", target: "A" },
      { type: "end_day" },
    ]);
    expect(r.state.phase).toBe("ended");
    expect(r.state.winner).toBe("village");
    expect(r.events.at(-1)).toMatchObject({ type: "game_ended", winner: "village" });
  });

  it("wolves win when they equal the village", () => {
    const r = replay(FIVE, [
      { type: "night_action", actor: "A", target: "B" },
      { type: "end_night" },
      { type: "vote", voter: "A", target: "C" },
      { type: "vote", voter: "D", target: "C" },
      { type: "end_day" },
      { type: "night_action", actor: "A", target: "D" },
      { type: "end_night" },
    ]);
    expect(r.state.winner).toBe("wolves");
    expect(code(() => apply(r.state, { type: "end_day" }))).toBe("game_over");
  });
});

describe("replay & views", () => {
  const log: Command[] = [
    { type: "night_action", actor: "A", target: "E" },
    { type: "night_action", actor: "B", target: "C" },
    { type: "end_night" },
    { type: "vote", voter: "B", target: "D" },
    { type: "end_day" },
  ];

  it("is deterministic", () => {
    expect(replay(FIVE, log)).toEqual(replay(FIVE, log));
  });

  it("does not mutate earlier states", () => {
    const g = createGame(FIVE).state;
    const snapshot = JSON.stringify(g);
    run(g, ...log);
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it("public view never exposes roles of living players", () => {
    const { state, events } = replay(FIVE, log);
    const view = publicView(state, events);
    expect(JSON.stringify(view)).not.toMatch(/werewolf|seer|doctor/);
    expect(view.alive).toEqual(["A", "B", "C"]);
    expect(view.eliminated.map((e) => e.id)).toEqual(["D", "E"]);
  });
});
