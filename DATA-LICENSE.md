# Qariah Data License

The Qariah source code is licensed under the GNU Affero General Public License v3.0 or later (see [`LICENSE`](./LICENSE)). **The data and media are not.**

## What ships in this repository

This open-source tree ships a **placeholder catalog** only — a single example reciter in `assets/data/catalog.json` and `data/reciters-fallback.json`. It exists so the app builds and runs. It is not real data.

The real Qariah catalog, reciter photos, audio recordings, and biographical text are **not in this repository**. They are served at runtime from Qariah storage and are governed by separate arrangements with individual reciters and rights holders — not by AGPL and not by this repository's license.

## What you may not do

- Redistribute Qariah's reciter audio, photos, biographical text, or curated catalog — whether obtained from the running app, Qariah storage, or any other source — as a standalone dataset or as part of a derivative product.
- Hot-link, mirror, or build against Qariah's storage origin. (The runtime catalog URL is supplied via the `EXPO_PUBLIC_CATALOG_URL` env var, deliberately kept out of source; a fork must point at its own.)
- Treat the placeholder catalog's schema as a license to the real data. The schema is free; the contents are not.

## Forking

Replace `assets/data/catalog.json` and `data/reciters-fallback.json` with your own catalog under your own arrangements, and set `EXPO_PUBLIC_CATALOG_URL` (see [`.env.example`](./.env.example)) to your own CDN. Do not reference Qariah's catalog, media, or storage.

## Bayaan-inherited data

Mushaf fonts, ayah timestamps, and public Qur'an text inherited from upstream [Bayaan](https://github.com/thebayaan/Bayaan) are governed by Bayaan's own terms. Qur'anic text itself is public domain.

## Permission

Uses not permitted above require written permission — open a GitHub issue or contact the project through the App Store / Google Play listings. The project must confirm with the underlying reciter or rights holder before extending rights it does not itself hold.
