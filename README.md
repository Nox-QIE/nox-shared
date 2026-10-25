# nox-shared

Paket bersama yang dipakai backend, frontend, dan tes kontrak.

| Folder | Isi |
|---|---|
| `engine/` | Aturan game murni & deterministik + replay (jalan di server dan browser) |
| `crypto-spec/` | Spesifikasi kanonik leaf peran, actionHash, Merkle, resultHash, configHash + test vector |
| `config/` | Chain 1983/1990, RPC dengan failover, alamat kontrak per environment |

Dikonsumsi sebagai dependency (git atau registry paket). Bagian dari [Nox](https://github.com/Nox-QIE).
