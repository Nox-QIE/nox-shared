# @nox/engine

Aturan game Nox yang murni dan deterministik: tanpa I/O, tanpa `Math.random`, tidak pernah memutasi state lama. Dipakai bot (`nox-backend`) dan replay verifikasi di browser (`nox-frontend`).

## API
- `roleComposition(n, roleSet?)` — komposisi peran untuk 5–12 pemain (1 seer, 1 doctor, 1–3 werewolf). `roleSet: "extended"` (lewat `config.roleSet`) mengubah satu villager jadi hunter mulai 6 pemain dan satu lagi jadi witch mulai 8 pemain.
- `assignRoles(ids, randomInt, roleSet?)` — Fisher–Yates dengan sumber acak dari luar (wajib CSPRNG di backend).
- `createGame(assignments, config?)` → `{ state, events }`, mulai malam 1.
- `apply(state, command)` → `{ state, events }`. Command: `night_action` (witch wajib `kind: "heal" | "poison"`), `end_night`, `vote`, `end_day`, `shoot`, `skip_shot`.
- `replay(assignments, commands)` — fold log perintah; hasil selalu sama untuk input sama.
- `publicView(state, events)` — data aman untuk AI Game Master (tanpa peran pemain hidup).
- `eventsFor(playerId, events)` — event publik + event privat milik pemain itu.

## Aturan
- Werewolf: target = suara terbanyak antar-werewolf; seri → kursi paling awal. Tidak bisa menarget sesama werewolf.
- Doctor melindungi satu pemain (boleh diri sendiri). Seer menyelidiki satu pemain (bukan diri sendiri); hasil hanya terlihat oleh seer.
- Siang: satu vote per pemain hidup, tidak bisa diganti; suara terbanyak tersingkir, seri → tidak ada yang tersingkir; abstain = tidak vote.
- Witch: dua ramuan, masing-masing sekali per game, satu aksi per malam. Begitu semua werewolf hidup memilih, witch yang masih punya heal diberi tahu korbannya (event privat `victim_known`). Heal menyelamatkan seperti doctor; poison membunuh target (bukan diri sendiri) dan tidak bisa dicegah doctor; diumumkan sebagai `player_died` (`cause: "poison"`).
- Hunter: bila mati (malam, diracun, atau diusir), game berhenti di `pendingShot` sampai `shoot` (satu target hidup, `player_died` `cause: "shot"`) atau `skip_shot`. Command lain ditolak `shot_pending`. Cek kemenangan baru dijalankan setelah tembakan, lalu game lanjut ke siang/malam berikutnya.
- Menang: village bila werewolf habis; wolves bila jumlah werewolf ≥ sisa village.

## Tes
```bash
npm test
```
