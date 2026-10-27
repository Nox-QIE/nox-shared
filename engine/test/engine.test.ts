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

describe("extended roles: hunter and witch", () => {
  // 8 players: W1 W2 wolves, S seer, Dr doctor, H hunter, Wi witch, V1 V2 villagers
  const EIGHT: RoleAssignment[] = [
    { id: "W1", role: "werewolf" },
    { id: "W2", role: "werewolf" },
    { id: "S", role: "seer" },
    { id: "Dr", role: "doctor" },
    { id: "H", role: "hunter" },
    { id: "Wi", role: "witch" },
    { id: "V1", role: "villager" },
    { id: "V2", role: "villager" },
  ];
  const EXT = { revealOnDeath: true, roleSet: "extended" as const };
  const start = () => createGame(EIGHT, EXT).state;

  it("adds the hunter from 6 players and the witch from 8, only in the extended set", () => {
    expect(roleComposition(5, "extended")).not.toContain("hunter");
    expect(roleComposition(6, "extended").filter((r) => r === "hunter")).toHaveLength(1);
    expect(roleComposition(7, "extended")).not.toContain("witch");
    const eight = roleComposition(8, "extended");
    expect(eight.filter((r) => r === "witch")).toHaveLength(1);
    expect(eight.filter((r) => r === "villager")).toHaveLength(2);
    expect(roleComposition(8)).not.toContain("hunter");
    expect(code(() => createGame(EIGHT))).toBe("bad_composition"); // classic config rejects them
  });

  it("tells the witch the wolves' victim once every wolf chose, and her heal saves them", () => {
    const one = apply(start(), { type: "night_action", actor: "W1", target: "V1" });
    expect(one.events.some((e) => e.type === "victim_known")).toBe(false);
    const two = apply(one.state, { type: "night_action", actor: "W2", target: "V1" });
    expect(two.events.find((e) => e.type === "victim_known")).toMatchObject({ witch: "Wi", target: "V1", visibility: { scope: "private", to: ["Wi"] } });
    const r = run(two.state, { type: "night_action", actor: "Wi", target: "V1", kind: "heal" }, { type: "end_night" });
    expect(r.state.players.V1!.alive).toBe(true);
    expect(r.state.potionsUsed).toEqual({ Wi: ["heal"] });
    // The heal is gone: next night she is no longer told, and cannot heal again.
    const n2 = run(r.state, { type: "end_day" }, { type: "night_action", actor: "W1", target: "V2" }, { type: "night_action", actor: "W2", target: "V2" });
    expect(n2.events.some((e) => e.type === "victim_known")).toBe(false);
    expect(code(() => apply(n2.state, { type: "night_action", actor: "Wi", target: "V2", kind: "heal" }))).toBe("potion_used");
  });

  it("poison kills whoever it targets, through the doctor, and is announced as its own death", () => {
    const r = run(
      start(),
      { type: "night_action", actor: "W1", target: "V1" },
      { type: "night_action", actor: "W2", target: "V1" },
      { type: "night_action", actor: "Dr", target: "W1" },
      { type: "night_action", actor: "Wi", target: "W1", kind: "poison" },
      { type: "end_night" },
    );
    expect(r.state.players.V1!.alive).toBe(false);
    expect(r.state.players.W1!.alive).toBe(false);
    expect(r.events.find((e) => e.type === "player_died")).toMatchObject({ id: "W1", cause: "poison", revealedRole: "werewolf" });
    expect(publicView(r.state, r.events).eliminated).toEqual([
      { id: "W1", revealedRole: "werewolf" },
      { id: "V1", revealedRole: "villager" },
    ]);
  });

  it("rejects witch mistakes: no potion named, poisoning herself, a potion she lacks", () => {
    const g = start();
    expect(code(() => apply(g, { type: "night_action", actor: "Wi", target: "V1" }))).toBe("kind_required");
    expect(code(() => apply(g, { type: "night_action", actor: "Wi", target: "Wi", kind: "poison" }))).toBe("bad_target");
    expect(code(() => apply(g, { type: "night_action", actor: "Wi", target: "V1", kind: "kill" }))).toBe("kind_required");
    expect(code(() => apply(g, { type: "night_action", actor: "S", target: "V1", kind: "protect" }))).toBe("bad_kind");
    expect(code(() => apply(g, { type: "night_action", actor: "H", target: "V1" }))).toBe("no_night_action");
  });

  it("a hunter killed at night shoots before the day starts; nothing else may happen first", () => {
    const night = run(start(), { type: "night_action", actor: "W1", target: "H" }, { type: "night_action", actor: "W2", target: "H" }, { type: "end_night" });
    expect(night.state.pendingShot).toEqual({ hunter: "H", next: "day" });
    expect(night.events.at(-1)).toMatchObject({ type: "hunter_must_shoot", hunter: "H" });
    expect(code(() => apply(night.state, { type: "vote", voter: "S", target: "W1" }))).toBe("shot_pending");
    expect(code(() => apply(night.state, { type: "shoot", actor: "S", target: "W1" }))).toBe("not_hunter");
    const shot = apply(night.state, { type: "shoot", actor: "H", target: "W2" });
    expect(shot.state.players.W2!.alive).toBe(false);
    expect(shot.state.phase).toBe("day");
    expect(shot.events.map((e) => e.type)).toEqual(["player_died", "day_started"]);
    expect(code(() => apply(shot.state, { type: "skip_shot" }))).toBe("no_shot");
  });

  it("a hunter voted out shoots before the next night, and the shot can decide the game", () => {
    // Night 1: wolves take V1. Day 1: the village exiles H; H shoots W1. Then W2 alone vs S Dr Wi V2.
    const day = run(start(), { type: "night_action", actor: "W1", target: "V1" }, { type: "night_action", actor: "W2", target: "V1" }, { type: "end_night" });
    const voted = run(day.state, { type: "vote", voter: "W1", target: "H" }, { type: "vote", voter: "W2", target: "H" }, { type: "end_day" });
    expect(voted.state.pendingShot).toEqual({ hunter: "H", next: "night" });
    expect(voted.state.round).toBe(1); // the shot belongs to round 1
    const shot = apply(voted.state, { type: "shoot", actor: "H", target: "W1" });
    expect(shot.state.phase).toBe("night");
    expect(shot.state.round).toBe(2);
    // Village win by shot: only W2 left; exile W2 on day 2 is not needed if the hunter takes the last wolf.
    const last = replay(
      [
        { id: "W", role: "werewolf" },
        { id: "S", role: "seer" },
        { id: "Dr", role: "doctor" },
        { id: "H", role: "hunter" },
        { id: "V1", role: "villager" },
        { id: "V2", role: "villager" },
      ],
      [{ type: "night_action", actor: "W", target: "H" }, { type: "end_night" }, { type: "shoot", actor: "H", target: "W" }],
      EXT,
    );
    expect(last.state.winner).toBe("village");
  });

  it("a hunter who lets the timer run out shoots nobody", () => {
    const night = run(start(), { type: "night_action", actor: "W1", target: "H" }, { type: "night_action", actor: "W2", target: "H" }, { type: "end_night" });
    const r = apply(night.state, { type: "skip_shot" });
    expect(r.state.phase).toBe("day");
    expect(r.events.map((e) => e.type)).toEqual(["day_started"]);
  });
});
