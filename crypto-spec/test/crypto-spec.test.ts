import { readFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ACTION_CODE,
  actionHash,
  canonicalJson,
  commitRoles,
  configHash,
  merkleProof,
  merkleRoot,
  randomBytes32,
  ROLE_CODE,
  roleLeaf,
  verifyMerkleProof,
} from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("../vectors/v1.json", import.meta.url), "utf8"));
const h = (s: string): Hex => keccak256(toBytes(s));

describe("crypto-spec v1", () => {
  it("reproduces the committed vectors exactly", () => {
    const again = commitRoles(
      vectors.gameId,
      vectors.roleLeaves.map((l: { player: Hex; role: never; salt: Hex }) => ({ player: l.player, role: l.role, salt: l.salt })),
    );
    expect(again.root).toBe(vectors.rolesRoot);
    expect(again.players.map((p) => p.leaf)).toEqual(vectors.roleLeaves.map((l: { leaf: Hex }) => l.leaf));
    const a = vectors.action;
    expect(actionHash(vectors.gameId, a.round, a.player, a.action, a.target, a.nonce)).toBe(a.hash);
    expect(configHash(vectors.config.value)).toBe(vectors.config.hash);
  });

  it("double-hashes leaves over abi.encode like OpenZeppelin StandardMerkleTree", () => {
    const gameId = h("g");
    const player = "0x0000000000000000000000000000000000001001";
    const salt = h("s");
    const inner = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }], [gameId, player, ROLE_CODE.seer, salt]),
    );
    expect(roleLeaf(gameId, player, "seer", salt)).toBe(keccak256(inner));
  });

  it("changing any field of any player changes the root", () => {
    const base = vectors.roleLeaves.map((l: { player: Hex; role: never; salt: Hex }) => ({ player: l.player, role: l.role, salt: l.salt }));
    const root = commitRoles(vectors.gameId, base).root;
    const swapped = base.map((p: { role: string }, i: number) => (i === 3 ? { ...p, role: "werewolf" } : p));
    expect(commitRoles(vectors.gameId, swapped).root).not.toBe(root);
    expect(commitRoles(h("other game"), base).root).not.toBe(root);
  });

  it("proves every leaf for trees of 1 to 12 players", () => {
    for (let n = 1; n <= 12; n++) {
      const leaves = Array.from({ length: n }, (_, i) => h(`leaf${n}-${i}`));
      const root = merkleRoot(leaves);
      for (let i = 0; i < n; i++) expect(verifyMerkleProof(merkleProof(leaves, i), root, leaves[i]!)).toBe(true);
      expect(verifyMerkleProof(merkleProof(leaves, 0), root, h("intruder"))).toBe(false);
    }
  });

  it("action hash binds every field", () => {
    const a = vectors.action;
    const base = actionHash(vectors.gameId, a.round, a.player, a.action, a.target, a.nonce);
    expect(actionHash(vectors.gameId, 2, a.player, a.action, a.target, a.nonce)).not.toBe(base);
    expect(actionHash(vectors.gameId, a.round, a.player, "protect", a.target, a.nonce)).not.toBe(base);
    expect(actionHash(vectors.gameId, a.round, a.player, a.action, a.target, h("other nonce"))).not.toBe(base);
  });

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } })).toBe('{"a":{"c":"z","d":[1,{"x":1,"y":2}]},"b":1}');
    expect(configHash({ x: 1, y: 2 })).toBe(configHash({ y: 2, x: 1 }));
  });

  it("uses distinct non-zero codes and random 32-byte salts", () => {
    expect(new Set(Object.values(ROLE_CODE)).size).toBe(6);
    expect(new Set(Object.values(ACTION_CODE)).size).toBe(6);
    expect(Object.values(ROLE_CODE).concat(Object.values(ACTION_CODE)).every((c) => c > 0)).toBe(true);
    const s = randomBytes32();
    expect(s).toMatch(/^0x[0-9a-f]{64}$/);
    expect(randomBytes32()).not.toBe(s);
  });
});
