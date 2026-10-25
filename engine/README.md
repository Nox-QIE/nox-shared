# @nox/engine

Aturan game Nox yang murni dan deterministik: tanpa I/O, tanpa `Math.random`, tidak pernah memutasi state lama. Dipakai bot (`nox-backend`) dan replay verifikasi di browser (`nox-frontend`).

## API
- `roleComposition(n)` — komposisi peran untuk 5–12 pemain (1 seer, 1 doctor, 1–3 werewolf).
- `assignRoles(ids, randomInt)` — Fisher–Yates dengan sumber acak dari luar (wajib CSPRNG di backend).
- `createGame(assignments, config?)` → `{ state, events }`, mulai malam 1.
- `apply(state, command)` → `{ state, events }`. Command: `night_action`, `end_night`, `vote`, `end_day`.
- `replay(assignments, commands)` — fold log perintah; hasil selalu sama untuk input sama.
- `publicView(state, events)` — data aman untuk AI Game Master (tanpa peran pemain hidup).
- `eventsFor(playerId, events)` — event publik + event privat milik pemain itu.

## Aturan
- Werewolf: target = suara terbanyak antar-werewolf; seri → kursi paling awal. Tidak bisa menarget sesama werewolf.
- Doctor melindungi satu pemain (boleh diri sendiri). Seer menyelidiki satu pemain (bukan diri sendiri); hasil hanya terlihat oleh seer.
- Siang: satu vote per pemain hidup, tidak bisa diganti; suara terbanyak tersingkir, seri → tidak ada yang tersingkir; abstain = tidak vote.
- Menang: village bila werewolf habis; wolves bila jumlah werewolf ≥ sisa village.

## Tes
```bash
npm test
```
