/**
 * Writes crypto-spec/vectors/v1.json: fixed inputs and expected hashes. nox-contracts copies this
 * file and checks the Solidity side against it. Regenerate only when SPEC_VERSION changes.
 */
import { writeFileSync } from "node:fs";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { actionHash, commitRoles, configHash, resultHash, SPEC_VERSION, type Role } from "../src/index.js";

// Deterministic fixtures: ids and salts derived from labels, addresses from small integers.
const h = (label: string): Hex => keccak256(toBytes(label));
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}` as Address;

const gameId = h("nox:vector:game:1");
const roles: Role[] = ["werewolf", "seer", "doctor", "villager", "villager"];
const players = roles.map((role, i) => ({ player: addr(0x1001 + i), role, salt: h(`nox:vector:salt:${i}`) }));
const committed = commitRoles(gameId, players);

const nonce = h("nox:vector:nonce:0");
const config = { mode: "casual", theme: "classic", players: 5, timers: { lobby: 120, night: 60, discussion: 90, vote: 45 } };
const result = { round: 1, eliminated: addr(0x1004), revealedRole: "villager" };

const vectors = {
  specVersion: SPEC_VERSION,
  gameId,
  roleLeaves: committed.players.map((p) => ({ player: p.player, role: p.role, salt: p.salt, leaf: p.leaf, proof: p.proof })),
  rolesRoot: committed.root,
  action: {
    round: 1,
    player: addr(0x1001),
    action: "kill",
    target: addr(0x1004),
    nonce,
    hash: actionHash(gameId, 1, addr(0x1001), "kill", addr(0x1004), nonce),
  },
  config: { value: config, hash: configHash(config) },
  result: { value: result, hash: resultHash(result) },
};

writeFileSync(new URL("../vectors/v1.json", import.meta.url), JSON.stringify(vectors, null, 2) + "\n");
console.log("wrote crypto-spec/vectors/v1.json", vectors.rolesRoot);
