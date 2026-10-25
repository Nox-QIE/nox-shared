import { concat, encodeAbiParameters, getAddress, keccak256, toBytes, toHex, type Address, type Hex } from "viem";

/**
 * Canonical hashing for Nox commit-reveal. The same functions run on the server (commit), in the
 * browser (verify) and are mirrored in Solidity (NoxGame). Any change here is a breaking change:
 * bump SPEC_VERSION and regenerate vectors (npm run vectors).
 */
export const SPEC_VERSION = 1;

export type Role = "werewolf" | "seer" | "doctor" | "villager";
export type NightActionKind = "kill" | "inspect" | "protect";

/** uint8 codes used on-chain. 0 is reserved as "none". */
export const ROLE_CODE: Record<Role, number> = { villager: 1, werewolf: 2, seer: 3, doctor: 4 };
export const ACTION_CODE: Record<NightActionKind, number> = { kill: 1, inspect: 2, protect: 3 };

/** Teams as uint8 codes, matching NoxGame.Team. */
export const TEAM_CODE = { village: 1, wolves: 2 } as const;

/** 32 random bytes from the platform CSPRNG (Node and browsers). */
export function randomBytes32(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

/** Inner hash of a role leaf: keccak256(abi.encode(bytes32 gameId, address player, uint8 role, bytes32 salt)). */
function roleLeafInner(gameId: Hex, player: Address, role: Role, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }],
      [gameId, getAddress(player), ROLE_CODE[role], salt],
    ),
  );
}

/**
 * Role leaf, double-hashed as in OpenZeppelin's StandardMerkleTree so a leaf can never be confused
 * with an inner node: keccak256(bytes.concat(keccak256(abi.encode(gameId, player, role, salt)))).
 */
export function roleLeaf(gameId: Hex, player: Address, role: Role, salt: Hex): Hex {
  return keccak256(roleLeafInner(gameId, player, role, salt));
}

/**
 * Night action commitment:
 * keccak256(abi.encode(bytes32 gameId, uint16 round, address player, uint8 action, address target, bytes32 nonce)).
 */
export function actionHash(gameId: Hex, round: number, player: Address, action: NightActionKind, target: Address, nonce: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint16" }, { type: "address" }, { type: "uint8" }, { type: "address" }, { type: "bytes32" }],
      [gameId, round, getAddress(player), ACTION_CODE[action], getAddress(target), nonce],
    ),
  );
}

/** Commutative pair hash (sorted), as in OpenZeppelin MerkleProof. */
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** Layers bottom-up. An odd node at the end of a layer is carried up unchanged. */
function layers(leaves: Hex[]): Hex[][] {
  if (leaves.length === 0) throw new Error("merkle tree needs at least one leaf");
  const out: Hex[][] = [leaves];
  while (out[out.length - 1]!.length > 1) {
    const prev = out[out.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves: Hex[]): Hex {
  const ls = layers(leaves);
  return ls[ls.length - 1]![0]!;
}

/** Sibling path for leaves[index], verifiable with OpenZeppelin MerkleProof.verify(proof, root, leaf). */
export function merkleProof(leaves: Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) throw new Error("leaf index out of range");
  const proof: Hex[] = [];
  let i = index;
  for (const layer of layers(leaves).slice(0, -1)) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < layer.length) proof.push(layer[sibling]!);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkleProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  return proof.reduce((h, p) => hashPair(h, p), leaf).toLowerCase() === root.toLowerCase();
}

/** Stable JSON: object keys sorted at every level, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** keccak256 of the canonical JSON of a game config (mode, theme, timers, role composition...). */
export function configHash(config: unknown): Hex {
  return keccak256(toBytes(canonicalJson(config)));
}

/** keccak256 of the canonical JSON of a round result or of the full replay log. */
export function resultHash(result: unknown): Hex {
  return keccak256(toBytes(canonicalJson(result)));
}

export interface RoleCommitment {
  player: Address;
  role: Role;
  salt: Hex;
  leaf: Hex;
  proof: Hex[];
}

/** Everything the server needs at game start: one leaf + proof per player and the root to commit. */
export function commitRoles(gameId: Hex, assignments: { player: Address; role: Role; salt?: Hex }[]): { root: Hex; players: RoleCommitment[] } {
  const withSalt = assignments.map((a) => ({ ...a, player: getAddress(a.player), salt: a.salt ?? randomBytes32() }));
  const leaves = withSalt.map((a) => roleLeaf(gameId, a.player, a.role, a.salt));
  return {
    root: merkleRoot(leaves),
    players: withSalt.map((a, i) => ({ player: a.player, role: a.role, salt: a.salt, leaf: leaves[i]!, proof: merkleProof(leaves, i) })),
  };
}
