# Qariah

**Women reciters of the Qur'an — a recitation app for iOS and Android.**

[![React Native](https://img.shields.io/badge/React_Native-0.83-61DAFB?logo=react)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo_SDK-55-000020?logo=expo)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

---

> ### About this repository
>
> This is the **public AGPL source mirror** of the Qariah mobile app, published to satisfy the
> source-availability terms of the GNU Affero General Public License. It is **automatically
> generated and force-pushed** from a private development workspace, so it is effectively
> **read-only**: pull requests opened here are overwritten on the next publish. See the
> [Contributing & feedback](#contributing--feedback) section for where changes and bug reports go.
>
> It ships a **placeholder catalog** (a single example reciter) so the tree builds and runs. The
> real Qariah catalog, audio, reciter photos, and biographies are **not in this repository** —
> they are governed by separate licensing arrangements with reciters and rights holders. See
> [DATA-LICENSE.md](DATA-LICENSE.md).

---

## What Qariah is

Qariah is a Qur'an recitation app dedicated to **women reciters** — a curated catalog spanning
many reciters, multiple narrations (rewayat), and several languages, with more added over time.

Qariah is a rebranded fork of **[Bayaan](https://github.com/thebayaan/Bayaan)** and inherits
Bayaan's full feature surface — player, Mushaf, downloads, translations — diverging only on its
catalog, its branding, and an optional [Quran Foundation](https://quran.foundation) account layer
for syncing favorites and notes across devices.

The app runs **fully anonymously**: browse, listen, and read the Mushaf with no account and no API
keys. Signing in (Quran Foundation OAuth) only adds optional cross-device sync.

---

## Features

- **Quran player** — stream or download recitations across multiple rewayat. Background playback,
  lock-screen controls, sleep timer, playback speed, repeat modes.
- **Digital Mushaf** — full Uthmani text rendered with [Digital Khatt](https://github.com/DigitalKhatt/DigitalKhatt)
  via Skia, with verse follow-along synced to audio and multiple reading themes.
- **Multi-Qira'at (rewayat)** — canonical KFGQPC narrations selectable in settings, with
  published-mushaf-style highlighting of differences from Hafs.
- **Offline downloads** — download a reciter's complete Qur'an for offline playback.
- **Translations & tafseer** — multiple translation languages and tafseer editions, downloadable
  for offline use, plus a word-by-word overlay.
- **Favorites & notes** — bookmark reciters, surahs, and verses; optionally sync them to your
  Quran Foundation account.
- **Search, themes, i18n** — fast fuzzy search, light/dark themes, and full RTL support.

---

## What this repository contains

| Included | Not included |
| --- | --- |
| The full mobile-app source (TypeScript / React Native / Expo) | The real reciter catalog, audio, photos, and biographies ([DATA-LICENSE.md](DATA-LICENSE.md)) |
| A **placeholder** catalog (one example reciter) so the tree builds | Any credentials, signing keys, or storage origins (stripped before publish) |
| `.env.example` documenting every runtime variable | Internal operational tooling, strategy, and planning docs |

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | React 19 + React Native 0.83 + Expo SDK 55 |
| Language | TypeScript 5.9 (strict) |
| Navigation | Expo Router (file-based) |
| Audio | expo-audio (background playback) |
| Mushaf rendering | @shopify/react-native-skia (Digital Khatt) |
| State | Zustand |
| Local storage | expo-sqlite (FTS5) + react-native-mmkv |
| Auth (optional) | Quran Foundation OAuth2 (PKCE) |
| Observability (opt-in) | Sentry + PostHog (no-op when env keys absent) |

---

## Build and run

### Prerequisites

- Node.js 20+
- iOS: macOS with Xcode 15+ (CocoaPods ships with macOS)
- Android: Android Studio with an emulator, JDK 17+

### Steps

```bash
git clone https://github.com/Qariah/mobile-app.git
cd mobile-app
cp .env.example .env.local      # defaults are fine to build; no account needed
npm install                      # postinstall writes android/local.properties
npm run ios                      # or: npm run android
```

Out of the box, the tree **builds and launches with the one-reciter placeholder catalog**. To turn
it into a working app with your own content:

1. **Catalog** — set `EXPO_PUBLIC_CATALOG_URL` (see [`.env.example`](.env.example)) to a catalog
   you host, or replace `assets/data/catalog.json` with your own. The catalog schema is free; the
   Qariah catalog data is not (see [DATA-LICENSE.md](DATA-LICENSE.md)).
2. **Audio** — host your own recitation audio and point the catalog's `server` fields at it.
3. **Sign-in (optional)** — register your own Quran Foundation OAuth client and set
   `EXPO_PUBLIC_QF_CLIENT_ID` in `.env.local`. Everything except favorites-sync works without it.

---

## Forking and rebranding

Qariah's code is free to fork under the AGPL, but the **name and brand are not**. Before you
distribute a fork through any channel you **must** rebrand — new name, icons, bundle identifier,
and brand strings — and replace the catalog with your own content. See
[TRADEMARKS-QARIAH.md](TRADEMARKS-QARIAH.md) (Qariah's registered mark) and
[TRADEMARKS.md](TRADEMARKS.md) (the upstream Bayaan mark, which also still applies).

---

## Licensing

- **Code** — [GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified
  version as a network service, you must offer your modified source to its users; any fork must be
  AGPL-licensed too.
- **Reciter catalog, audio, photos, and biographies** — **not** AGPL. Governed by
  [DATA-LICENSE.md](DATA-LICENSE.md).
- **"Qariah" name and logo** — a registered trademark, **not** licensed under the AGPL. See
  [TRADEMARKS-QARIAH.md](TRADEMARKS-QARIAH.md).
- **Third-party dependencies and fonts** — see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

---

## Contributing & feedback

This repository is a one-way published mirror, so we can't accept pull requests here — but
contributions are welcome through the right channels:

- **Found a bug or have feedback?** Open a [GitHub issue](https://github.com/Qariah/mobile-app/issues)
  or email **info@qariah.org**.
- **Improving the shared app engine** (player, Mushaf, downloads)? Qariah inherits these from
  [Bayaan](https://github.com/thebayaan/Bayaan) — contribute upstream there and the improvement flows
  back into Qariah on the next sync.
- **Building your own fork?** See [Build and run](#build-and-run) and
  [Forking and rebranding](#forking-and-rebranding). The code is AGPL; the Qariah name, brand, and
  catalog are not.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not open a public
issue for a security report.

---

## Acknowledgements

Qariah is built on **[Bayaan](https://github.com/thebayaan/Bayaan)** — our thanks to the Bayaan
project for the open-source foundation. Qur'anic text is in the public domain; fonts and bundled
content are attributed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

Built with care for the Muslim community.
