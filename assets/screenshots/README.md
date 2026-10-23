# Store screenshots — Qariah 3.2.2

Made on 2026-10-22 from Release build 3.2.2 (3367), `qariah-main` `153b4613`, with no
telemetry keys. The flows and the steps are in `.maestro/store-screenshots/README.md`.
No captions. All files are 24-bit RGB PNG with no alpha.

| Folder | Store slot | Size | Frames |
|---|---|---|---|
| `ios/en`, `ios/ar` | App Store, iPhone 6.9-inch | 1320×2868 | 9 English, 8 Arabic |
| `ipad/en`, `ipad/ar` | App Store, iPad 13-inch | 2064×2752 | 9 English, 7 Arabic |
| `android/en`, `android/ar` | Google Play, phone | 1080×1920 (9:16) | 8 English (the Play limit), 7 Arabic |

Upload the files of one folder in file-name order. The English set goes to the English
(U.S.) localization, the Arabic set to the Arabic localization.

## Frames

1. Listen home: Continue Listening, then Newly Added Recitations.
2. Browse all reciters (iPhone and iPad).
3. A reciter profile: Zaynab Talha.
4. A Mushaf page in dark mode: Al-Kahf, page 293.
5. The verse list view: Al-Mulk, with the Saheeh International translation.
6. The full player: Ya-Sin by Zaynab Talha, with the recited ayah highlighted.
7. Collection with demo data: playlists, favorite reciters, a download, loved surahs,
   bookmarks and a personal note.
8. English sets only: the Arabic interface (Listen home, right to left).
9. Notifications: the card after the first finished play (iPhone, Android), or
   Settings → Notifications (iPad, and the Arabic sets).
10. Home Screen widgets: the English Android set only (see below).

Each store set uses a subset of these, in this order; the file names say which.

## Not in this set

- **iOS widgets.** Small and medium Qariah widgets render blank on iOS (WidgetKit rejects
  the 1800×1500 brand-mark image), so there is no iOS widget frame yet. Add it after the
  fix: it is the tenth iPhone and iPad frame.
- **Arabic Android widgets.** With the app in Arabic on an English device, the widgets
  still showed English text, so the Arabic Android set has no widget frame.
- **The Arabic iPad reciter profile.** On the iPad the surah rows are wider than the
  screen; in Arabic the surah names are off-screen.
- The welcome screen, the tab bar alone, and CarPlay (not shipped to users).
