# @nox/crypto-spec

Canonical hashing for Nox commit-reveal (spec v1). The same functions run on the server (commit), in the browser (verify), and are mirrored in Solidity by `NoxGame` in [nox-contracts](https://github.com/Nox-QIE/nox-contracts).

```ts
import { commitRoles, actionHash, verifyMerkleProof } from "@nox/shared/crypto-spec";
```

| Item | Definition |
|---|---|
| Role codes (`uint8`) | villager 1, werewolf 2, seer 3, doctor 4 (0 = none) |
| Action codes (`uint8`) | kill 1, inspect 2, protect 3 |
| Team codes (`uint8`) | village 1, wolves 2 |
| Role leaf | `keccak256(bytes.concat(keccak256(abi.encode(bytes32 gameId, address player, uint8 role, bytes32 salt))))` (double hash, as OpenZeppelin StandardMerkleTree) |
| Merkle tree | Sorted-pair keccak256 (OpenZeppelin `MerkleProof`), odd node carried up; proofs verify with `MerkleProof.verify` |
| Night action | `keccak256(abi.encode(bytes32 gameId, uint16 round, address player, uint8 action, address target, bytes32 nonce))` |
| `configHash`, `resultHash` | `keccak256` of canonical JSON (keys sorted at every level, no whitespace) |
| Salt / nonce | 32 bytes from the platform CSPRNG (`randomBytes32`) |

`vectors/v1.json` holds fixed inputs and expected outputs. Regenerate with `npm run vectors` only when the spec changes (bump `SPEC_VERSION`); nox-contracts copies this file and its Solidity tests must pass against it.
