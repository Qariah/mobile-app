# Qariah design rules

The design rules of the app as it ships (3.2.3, `qariah-main`, 2026-11-06), read from the code and the store screenshots (`assets/screenshots/`, build 3367). Nothing here is invented: each rule names its source file. A rule that the code does not state, but that the shipped screens follow, is marked **(proposed)**; the owner confirms or strikes it. A mock, a critique and an implementation task read this file first (`.claude/skills/qariah-uxd/SKILL.md`; `docs/design/ux-critique-checklist.md`).

Sizes are in points (pt). Most values in the code pass through `moderateScale(n)` (`react-native-size-matters`, or `utils/scale.ts`), which scales them with the screen width up to the 430 pt cap (`utils/responsive.ts`, `PHONE_SCALE_CAP`). The numbers below are the `n` inside the call: what a 375 pt wide phone shows.

Change a rule in its own PR, with the source. Never from a mock.

## 1. Typography

| Role | Font | Source |
|---|---|---|
| UI, Latin | Manrope: Regular, Medium, SemiBold, Bold, Light, ExtraLight, ExtraBold | `hooks/useFonts.ts`; the role names `regular`, `medium`, `semiBold`, `bold`, `heading` (= Bold) in `utils/themeUtils.ts` |
| UI, Arabic | IBM Plex Sans Arabic, in place of each Manrope name when the app language has `uiFont: 'plexSansArabic'` (Bold stands in for ExtraBold) | `i18n/fonts.ts`; `i18n/languages.ts` |
| Quran text | DigitalKhatt (`dk_v1`, "Madani 1405", the default; `dk_v2`; `dk_indopak`) or the QCF page fonts (`qcf_v2`, downloaded on demand). Never a UI font | `store/mushafSettingsStore.ts` (the renderer type and the default); `services/qariahBoot.ts`; `services/mushaf/QCFFontLoader.ts`; `docs/i18n/README.md` ("Quran text always renders with Digital Khatt") |
| Surah name glyphs | `surah_names`, `surah_names_2` (the calligraphic surah title in a surah row) | `hooks/useFonts.ts`; `constants/surahNameGlyphs.ts` |
| Arabic text outside the Mushaf (a bio, an ayah quote) | Scheherazade New: Regular, Medium, SemiBold, Bold | `hooks/useFonts.ts` |

**The type scale** (`utils/themeUtils.ts`, `typography`, `scale(n)`):

| Token | pt | Use |
|---|---|---|
| `headingSize` | 30 | The reciter name on a profile; a hero title |
| `subheadingSize` | 18 | A section title ("Continue Listening"; the store screenshots show it bolder and about 22 pt: `components/RecitersView.tsx` sets its own size) |
| `bodySize` | 16 | A row title |
| `mediumSize` | 14 | The most used size in components (105 uses), a row title in a dense list |
| `smallSize` | 12 | A row subtitle, a chip label (the second most used: 13 at 96, 12 at 71) |
| `arabicSize` | 20 | Arabic text in a UI slot |
| `captionSize` | 10 | A caption; a section header in Settings (10.5, SemiBold, uppercase, letter spacing 1.2: `app/(tabs)/(d.settings)/index.tsx`) |

Rules:

- T1. A screen uses at most three text levels from the scale: a title, a body and a caption. The counts in the code cluster at 14, 13, 12, 16, 11 (`components/`, `app/`); a fourth level on one screen is a smell. **(proposed)**
- T2. Weight carries the hierarchy, not size alone: a title is Bold (`fonts.heading`), a label is Medium, body is Regular (`utils/themeUtils.ts`, `fonts`).
- T3. Line height: 18 for 13–14 pt text, 20 for 15–16 pt, 24 for 18 pt (the three most used pairs in `components/`).
- T4. No letter spacing on Arabic or any cursive script; `latinLetterSpacing` returns 0 under RTL (`utils/rtl.ts`; `docs/i18n/README.md`, rule 9).
- T5. The word in the UI for a reciter is "qariah" (plural "qariahs"); "Ayah" in the UI, "verse" only inside a sentence (`i18n/overrides/en.json`; `docs/i18n/README.md`, glossary).

## 2. Palette

The theme tokens (`styles/colorSchemes.ts`, read through `useTheme()` → `theme.colors`):

| Token | Light | Dark |
|---|---|---|
| `background` | `#f4f3ec` | `#050b10` |
| `backgroundSecondary` | `#edebe3` | `#06151C` |
| `text` | `#06151C` | `#ffffff` |
| `textSecondary` | `#052c39` | `#B0B0B0` |
| `card` | `#dcdeda` | `#050b10` |
| `border` | `#a4a4a4` | `#332f38` |
| `secondary` | `#f0f0f0` | `#1c1a1e` |
| `light` | `#f4f4f4` | `#242326` |
| `accent` | `#5645a1` | `#00623a` |
| `tertiary` | `#5645a1` | `#ba5b37` |
| `error` | `#DC2626` | `#EF4444` |
| `primary` | `#2196F3` (Material Blue) | the same |

Facts a mock must know:

- P1. **`theme.colors.primary` is Material Blue `#2196F3`**: `store/themeStore.ts` defaults `primaryColor` to `'Blue'`, and no Qariah screen calls `setPrimaryColor`. It is used 41 times in `components/` and `app/` (a selected state, a progress fill, a link). `theme.colors.accent` is used 0 times there. So the live accent of the UI is blue, and the "accent" token is dead. **(proposed)** A mock does not add blue; it uses `text` for the primary action and `primary` only where the screen already does (a selected chip, a progress bar).
- P2. The brand colors are sage `#a4bba9` (the light splash, the Android icon background) and teal `#2f5059` (the dark splash) (`config/branding.js`, `assets.splash`, `assets.appIcon`). Teal is the "Reciters" tile accent on the Listen tab (`components/hero/ListenTabTopGrid.tsx`, `RECITERS_ACCENT`); the "Surahs" tile is `#5645a1` and "Shuffle" is `#c97a3b` there. These three are tile colors, not UI tokens.
- P3. The primary action is a filled `text`-colored button with `background`-colored label ("Play all", `components/reciter-profile/`; the store screenshot `assets/screenshots/ios/en/03-reciter-profile.png`). Secondary actions are outlined chips: 1 px `border` at low alpha, `text` label.
- P4. A chip or a badge background is `text` at 6 % alpha; its icon and label are `textSecondary` (`components/badges/FollowAlongBadge.tsx`). A Settings card is `text` at 4 % with a 1 px border at 6 % (`app/(tabs)/(d.settings)/index.tsx`).
- P5. Hero cards take one of six session palettes (purple, gold, teal, rose, indigo, emerald; `components/hero/heroThemes.ts`) or a surah mesh palette (`components/hero/SurahGradientMesh.tsx`, `paletteForKey`). A new card never gets a seventh palette.
- P6. The reader has its own themes: 7 light (default `#f4f3ec`, parchment, white, sage `#e8ebe4`, rose, cool, sand) and 7 dark (dark-default `#050b10`, dark-sepia, oled, dark-sage, charcoal, indigo, dark-amber) (`constants/readingThemes.ts`; defaults in `store/mushafSettingsStore.ts`). A Mushaf mock uses `default` and `dark-default`.
- P7. Lite mode (Android phones under 3 GB RAM or 32-bit only, `services/lite/liteMode.ts`) draws one flat tint in place of the mesh and no shadows (`withoutShadowInLite`). A mock for the Galaxy A10s is a Lite-mode mock: no gradient, no shadow.

## 3. Spacing and radii

- S1. The unit is 7 (`theme.spacing.unit`, `utils/themeUtils.ts`), but the code uses literal values. The horizontal screen padding is 16 (`ROW_PADDING`, `components/listen/rowItemLayout.ts`; padding 16 is the most used value, 157 times). The gap between cards in a row is 8 (`ROW_GAP`).
- S2. The padding ladder is 4, 8, 12, 16, 20 (the five most used values). A row is 12 pt vertical and 14 pt horizontal in Settings (`app/(tabs)/(d.settings)/index.tsx`).
- S3. Radii: 12 for a card and a chip (87 uses), 14 for a Settings card and a button, 8 and 10 for an inner element, 20 for a hero card, 16 for an image. A full pill is 32 or half the height. One radius per element level: outer card 14–20, inner element 8–12.
- S4. The tab bar is 55 on Android and 50 on iOS, plus the safe area (`utils/constants.ts`, `TAB_BAR_HEIGHT`; on iOS the native UITabBar is 49, `hooks/useBottomInset.ts`). The mini player adds 64 on iOS (8 + 36 + 20) and the floating player 50 + 8 on Android (`FLOATING_PLAYER_HEIGHT`, `FLOATING_PLAYER_BOTTOM_MARGIN`). A list's last row clears both: use `useBottomInset()`.
- S5. Row heights: a surah row is 45 (`components/SurahItem.tsx`); a reciter row image is 50 (`components/ReciterItem.tsx`, `components/TrackItem.tsx`); the header is 56 with a 44 back button (`components/Header.tsx`). Card widths in the Listen rows: recent 120, featured 140, rewayah and country 130, playlist 110, circular 64 + 6 (`components/listen/rowItemLayout.ts`).
- S6. Content on a tablet sits in a 720 pt column (`components/layout/MaxWidthContainer.tsx`); a no-op on a phone.

## 4. The component set

Use one of these. A new component is a decision for the owner, named in the mock's brief.

| Component | File | Shape |
|---|---|---|
| Bottom sheet (modal) | `components/BottomSheetModal.tsx`; the Qariah copy `components/auth/QariahBottomSheetModal.tsx` | gorhom sheet, default snap `['40%']` (auth sheets 50–55 %), a 5 pt handle at 20 % text alpha, a backdrop; `accessible={false}` on the Qariah copy |
| Action sheet | `components/sheets/*.tsx` (28 sheets, `react-native-actions-sheet`, registered in `sheets.tsx`) | A list of rows with an icon and a label (PlayerOptions, SurahOptions, VerseActions, RewayatInfo, …) |
| Full player | `components/player/v2/PlayerSheet.tsx` | A 100 % gorhom sheet, pan down to close, `accessible={false}`; on a tablet `TabletPlayer.tsx` (two columns, sidebar 360) |
| Mini player | iOS: `components/player/v2/MiniPlayer/index.tsx` (the `NativeTabs.BottomAccessory`, about 46 pt: 36 artwork, title, subtitle, 36 play). Android: `components/player/v2/FloatingPlayer/` (a floating bar above the tab bar, 50 tall, 10 side margin) | Artwork, two text lines, play |
| Tab bar | Android `components/BottomTabBar.tsx` (custom icons from `components/Icons.tsx`, unfocused at 50 % text alpha); iOS `app/(tabs)/_layout.tsx` NativeTabs (SF `headphones`, `gearshape`) | Listen, Mushaf, Collection, Settings, and the search button |
| Header | `components/Header.tsx` (title, back, blur); `components/ScreenHeader.tsx` (title 22) | Back button 44 in a round pill (the store screenshots) |
| Button | `components/Button.tsx` | `title`, `size` small/medium/large, `icon`, `loading`, `disabled`; radius 14 |
| Chip (filter) | `components/browse/BrowseReciters.tsx` (the rewayah chips) | Outlined pill, selected = filled `text` at low alpha |
| Badge | `components/badges/FollowAlongBadge.tsx` (the only badge) | `size` `'small'` (18 pt circle, icon only) or `'default'` (icon 9 + label 8 pt Medium, radius 6, padding 6 × 2) |
| Cards | `components/cards/`: ReciterCard, CircularReciterCard (small, medium 64, large), SurahCard, RecitationCard, RewayatCard, CountryCard, PlaylistCard, RecentReciterCard, TrackCard, DownloadCard, LovedCard | An image, a name, a one-line subtitle |
| Rows | `components/ReciterItem.tsx` (image 50, name, `secondaryText`, options, `showFollowAlong`); `components/SurahItem.tsx` (glyph, "n. Name", translated name, place chip, options); `components/TrackItem.tsx` | Options is a "…" at the trailing edge |
| Settings row | `app/(tabs)/(d.settings)/index.tsx` with `components/settings/settingsSlot.ts` and `*SettingsItem.ts` | Icon slot 24, title Medium 13.5, description Regular 11, a 1 px divider inset 16, a Switch at 0.8 |
| Listen-tab top | `components/hero/ListenTabTopGrid.tsx` (through `branding.listenTabTopComponent`) | "Browse by": three tiles, Feather icons 26, press spring to 0.97 |
| Listen rows | `components/RecitersView.tsx` with `components/listen/` (`NewlyAddedRecitationsRow`, `RtlRowFlatList`); the order in `config/branding.js` `homeRowConfig` | A section title, a horizontal row of cards |
| Grid | `components/browse/BrowseGrid.tsx` with `BrowseReciterCard.tsx` | 3 columns on a phone; the card shows the image, the name, the rewayah |
| Modal card | `components/notifications/NotificationSoftPrompt.tsx` | An RN Modal with two actions, platform wording |
| Lists | FlashList (24 files), FlatList (35), LegendList (4) | `estimatedItemSize` 72 for a row list |
| Loading | `components/LoadingIndicator.tsx`; `components/QariahMushafLoading.tsx`; skeleton rows in the reciter profile (the single-tab gate, `components/reciter-profile/ReciterProfile.tsx`) | A list never shows a blank area while it loads |
| Icons | Feather (247 uses) is the family; Ionicons (48) where Feather has no glyph; `components/Icons.tsx` (71 custom SVG icons) for the tab bar and the brand marks | A new icon is Feather first **(proposed)** |

Rules:

- C1. A screen has one filled primary action ("Play all"); everything else is an outlined chip, a text button or a row (`assets/screenshots/ios/en/03-reciter-profile.png`). **(proposed)**
- C2. A row's secondary content is one line of `textSecondary`; a third line is a chip (the place chip under a surah; `components/SurahItem.tsx`).
- C3. A badge sits inline after the name, never over the image (`FollowAlongBadge` in `components/ReciterItem.tsx` and `components/browse/BrowseReciterCard.tsx`, `showFollowAlong`).
- C4. A sheet is the place for options and explanations; a new screen is for a list or a reader. A bottom sheet never stacks on a sheet: `await SheetManager.hide()` before `show()` (CLAUDE.md, "RN / UI component gotchas").
- C5. A long name truncates with an ellipsis at one line ("Ameera Al-Mutaw…", `assets/screenshots/ios/en/02-reciters.png`); it never wraps a card.

## 5. Arabic and RTL

- R1. The app language sets the direction once, at the next launch: `I18nManager.forceRTL`, `allowRTL`, `swapLeftAndRightInRTL(true)` (`i18n/language.ts`); Android relaunches the process (`i18n/restart.ts`), iOS cannot. A mock never shows a mixed-direction screen.
- R2. Mirror the layout, not the media: a back arrow, a list, a progress bar and a chip row mirror; a photo, a video and the play icon do not (`docs/i18n/README.md`, rule 8; `utils/rtl.ts` `flipX`). The RTL store screenshot (`assets/screenshots/ios/ar/01-listen.png`) shows the tab bar, the hero tiles and the card rows mirrored and the play triangle unchanged.
- R3. Reciter names in Arabic come from the catalog (`name_arabic`, `i18n/qariahReciterNames.ts`); surah names from `data/surahData.json` (`name_arabic`); country and rewayah names from the `qariah` namespace (`i18n/qariahCatalog.ts`, `i18n/qariahRewayah.ts`). Never transliterate.
- R4. A Latin run inside Arabic text is isolated with FSI/PDI (`i18n/qariahBidi.ts`, `isolate()`), so "Elgo" in "مريم من أكاديمية Elgo" keeps its place.
- R5. Numbers: the durations and counts in the Arabic screenshot use Arabic-Indic digits ("١٩ د"); format through `i18n/format.ts` and the number helpers, never by hand (`docs/i18n/README.md`, rule 7). Lists use `formatList` (`i18n/qariahList.ts`), because Hermes has no `Intl.ListFormat`.
- R6. The app name in Arabic is "قارئة" in a brand slot and "تطبيق قارئة" inside a sentence (`i18n/qariahAppName.ts`); `branding.appName` stays "Qariah".
- R7. Every new string has an English line in `i18n/locales/en/qariah.json` and an Arabic line in `i18n/locales/ar/qariah.json`, generated from the review pack, not typed (CLAUDE.md, "Fork discipline"; `scripts/i18n-qariah-from-review.mjs`). Qariah wording of an upstream key goes in `i18n/overrides/<lang>.json`.
- R8. Letter spacing is 0 under RTL (`utils/rtl.ts`); the Settings section header's 1.2 spacing applies to Latin only.

## 6. Dark mode

- D1. `themeMode` is `'system'` by default and follows `Appearance` (`store/themeStore.ts`); `useTheme().isDarkMode` picks the token set. A mock shows both sets of section 2.
- D2. Dark assets: the splash (`splash-icon-dark.png`, background `#2f5059`), the iOS icon set (`ios-dark`, `ios-light`, `ios-tinted`), the tablet sidebar mark (`sidebar-logo-dark.png`) (`config/branding.js`). A new asset with a light-only version is a finding.
- D3. The dark ground is near-black blue (`#050b10`), not grey. Elevation reads through a lighter surface (`backgroundSecondary` `#06151C`, `light` `#242326`), not through a shadow. Lite mode has no shadow at all (P7).
- D4. A hard-coded pair is a smell: the code has four (`'#fff':'#1a1a2e'` in `components/hero/random-recitation/backgrounds.tsx`, and three more). A mock uses the tokens by name; the implementer reads `theme.colors`.

## 7. iPad

- I1. A tablet is an iPad, or a shortest side of 700 pt or more (`utils/responsive.ts`, `TABLET_BREAKPOINT`; `hooks/useResponsive.ts`). A phone never gets a tablet path.
- I2. The tablet shell is a sidebar (rail 88 compact, 240 expanded; `components/tablet/TabletSidebar.tsx`, the mark from `branding.sidebarLogo`), a docked player (`TabletDockedPlayer.tsx`) and a 720 pt content column (`components/layout/MaxWidthContainer.tsx`). The grid measures its own width (`components/browse/BrowseGrid.tsx`, #384).
- I3. The Mushaf shows facing pages in landscape (`components/mushaf/constants.ts`, `facingPages`; single page max 720, landscape 640), and the rotation runs on the native stage (`modules/rotation-stage`, `components/mushaf/MushafRotationStage.tsx`).
- I4. Split View is supported (`UIRequiresFullScreen=false`; case EDG-20 in `docs/operations/regression-test-plan.md`). A tablet mock is optional for a phone-only change; the UX skill makes one when the brief names a tablet screen.
- I5. The open decision is TECH_DEBT #385 (raise the 720 pt column, or an iPad design); iPad is 7.1 % of iOS installs (CLAUDE.md, "2026-10-28").

## 8. Accessibility

- A1. **Accessibility is the test surface on iOS.** XCUITest sees what VoiceOver sees (CLAUDE.md, "Verification & testing"). A control the driver cannot reach is a control a VoiceOver user cannot reach.
- A2. A container that holds controls gets `accessible={false}`: a gorhom sheet and a `TouchableWithoutFeedback` are accessible by default and swallow every control inside them. The four sites: `components/auth/QariahBottomSheetModal.tsx`, `components/player/v2/PlayerSheet.tsx`, `components/browse/BrowseReciters.tsx`, `components/system-playlist/SystemPlaylistDetail.tsx`. A new sheet, card or row with buttons inside does the same.
- A3. Every control has a label that says what it does. The Qariah labels live under `qariah:a11y` (`i18n/locales/en/qariah.json`: `playRecitation` "Play {{surah}} by {{reciter}}", `player.skipForward`, …). An icon-only button without `accessibilityLabel` is a defect.
- A4. `accessibilityRole="button"` on every tappable (121 uses); `togglebutton`, `radio`, `checkbox`, `link`, `alert` where the semantics fit; `role="search"` on the search field.
- A5. Touch targets: the back button, the search input and the header back are 44 × 44 (`components/BackButton.tsx`, `components/Header.tsx`, `components/SearchInput.tsx`); a small control adds `hitSlop` 8–12 (88 uses). There is no constant: 44 pt is the floor. **(proposed)**
- A6. The regression cases that watch this: I18N-04 (the Arabic back arrow with TalkBack and VoiceOver), EDG-18 (VoiceOver across the mini player, the full player and the verse sheet) (`docs/operations/regression-test-plan.md`).

## 9. Motion

- M1. Press feedback is a spring to scale 0.97 (`damping: 20, stiffness: 400, mass: 0.5`; `components/hero/ListenTabTopGrid.tsx` and five more). Timing durations are 150 or 200 ms for a state change, 300 for a reveal (`withTiming` in `components/`).
- M2. Sheets snap: the full player at `['100%']`, a modal sheet at `['40%']`; pan down closes (`PlayerSheet.tsx`, `BottomSheetModal.tsx`).
- M3. `LayoutAnimation` for a list that grows or shrinks (`MushafLayoutSheet`, `VerseActionsSheet`, `SimilarVersesContent`, `DhikrReader`).
- M4. Haptics: Light for a selection, Medium for a confirm, Heavy once (`utils/haptics.ts`; SurahItem, ThemePicker, ListenTabTopGrid, …).
- M5. The now-playing bars animate while audio plays (`components/NowPlayingIndicator.tsx`, 15 animations); in Lite mode they are still (`components/QariahNowPlayingBars.tsx`).
- M6. A rotation on iOS runs on the native stage; never a JS mask (CLAUDE.md, "RN / UI component gotchas"). Motion never carries meaning on its own: the state has a word or an icon too. **(proposed)**

## 10. Voice

The `qariah` i18n namespace (`i18n/locales/en/qariah.json`, 44 keys, 325 strings) and the overrides of upstream keys (`i18n/overrides/en.json`, 81 strings).

- V1. "Qariah" is the brand and the noun: "Browse Qariahs", "Favorite Qariahs", "Search qariahs...", "Go to Qariah" (`i18n/overrides/en.json`). Title case in a title or a button, lower case inside a sentence.
- V2. Sentence case for a message, a short label for a button, a full sentence for a message; plain and respectful (`docs/i18n/README.md`, "Tone"). The one uppercase eyebrow in the app is "START LISTENING" on the Listen top card (`listenTop.eyebrow`); do not add another. **(proposed)**
- V3. An action names what happens: "Play all", "Clear cache", "Allow notifications", "Sign in with Quran Foundation". No "Submit", no "OK" where a verb fits (Android's soft prompt uses "OK" after "Choose notifications": `NotificationSoftPrompt.tsx`).
- V4. An error says what happened and what to do, with no apology: "We could not read your notification choices. Try again later." (`settings.notifications.readFailed`); "Qariah hit an unexpected error on this screen. Your downloads and saved items are safe." (`errorBoundary`).
- V5. A description under a toggle is one line: "Keep audio playing when the screen is off" (`settings.backgroundPlaybackDesc`).
- V6. No exclamation marks; no "please". The strings have none. **(proposed)**
- V7. A reciter's honorific stays in the name as the catalog has it ("Layla Hasan رحمها الله").
- V8. Interpolate, never concatenate: `{{appName}}`, `{{surah}}`, `{{count}}` with `_one` and `_other` plurals (`docs/i18n/README.md`, rules 5 and 6).

## 11. The screens, as shipped

For orientation; the store set is `assets/screenshots/{ios,android,ipad}/{en,ar}/` (build 3367, 2026-10-22).

- Listen (`01-listen.png`): the "Browse by" top card (eyebrow, title, three tiles), then the rows of `homeRowConfig` ("Continue Listening" with "Clear", "Newly Added Recitations", "Browse by Rewaya", "Browse by Country", "Full Quran", honored, paradise). A card is an image with the name under it and a one-line subtitle.
- Browse All (`02-reciters.png`): round back pill, "Browse All" title, a search pill with a filter button, the rewayah chips ("All", "Nafi'", "Ibn Kathir", …), a 3-column grid.
- Reciter profile (`03-reciter-profile.png`): a 48 pt image with "114 surahs · 1 rewayah", the name at 30, a country chip, the bio line, "Play all" (filled), "Shuffle" / "Favorited" / "Download" (outlined), the rewayah tab, sort controls, "JUZ 1" headers and surah rows.
- Mushaf dark, verse view, player, collection, Arabic Listen, notifications: the rest of the set.

## Sources that a rule may cite

`config/branding.js` · `styles/colorSchemes.ts` · `utils/themeUtils.ts` · `store/themeStore.ts` · `constants/readingThemes.ts` · `hooks/useFonts.ts` · `i18n/fonts.ts` · `i18n/languages.ts` · `i18n/language.ts` · `utils/rtl.ts` · `utils/responsive.ts` · `utils/constants.ts` · `hooks/useBottomInset.ts` · `components/listen/rowItemLayout.ts` · `components/badges/FollowAlongBadge.tsx` · `components/*.tsx` · `app/(tabs)/(d.settings)/index.tsx` · `i18n/locales/en/qariah.json` · `i18n/overrides/en.json` · `docs/i18n/README.md` · `docs/operations/regression-test-plan.md` · `assets/screenshots/` · CLAUDE.md ("RN / UI component gotchas", "Verification & testing").
