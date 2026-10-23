# Store screenshots — Maestro flows

These flows make the App Store and Google Play screenshots in `assets/screenshots/`.
They are not part of the regression suite: `.maestro/config.yaml` runs `flows/**` only.
First used for 3.2.2 on 2026-10-22 (build 3367, `qariah-main` `153b4613`).

## What you need

- A Release build with no telemetry: empty `EXPO_PUBLIC_SENTRY_DSN` and
  `EXPO_PUBLIC_POSTHOG_API_KEY` (see `qariah-boot-gate-verify`). With no PostHog key,
  the notifications holdout arm is "notify", so the Notifications page and card show.
- Devices:
  - iPhone 6.9-inch: the "iPhone 17 Pro Max" simulator, 1320×2868.
  - iPad 13-inch: the "iPad Pro 13-inch (M5)" simulator, 2064×2752.
  - Android: the `qariah_pixel_7` emulator with the screen set to 9:16
    (`adb shell wm size 1080x1920`). Google Play wants 9:16; the default 1080×2400 is
    longer than 2:1.
- A clean status bar:
  - iOS: `xcrun simctl status_bar <udid> override --time 9:41 --batteryState discharging --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi --operatorName ""`
  - Android: `settings put global sysui_demo_allowed 1`, then the `com.android.systemui.demo`
    broadcasts (`enter`, `clock -e hhmm 0941`, `battery -e level 100 -e plugged false`,
    `network -e wifi show -e level 4 -e fully true`, `notifications -e visible false`).

## Order (each device)

`run.sh` passes the labels of one app language (`--lang en|ar`) and, with `--ipad`, the
iPad positions. Each flow writes its shots to `--out`.

1. `seed.yaml` (English): a fresh install, then 5 favorite reciters, 4 loved surahs,
   2 playlists, 1 download, 3 bookmarks, 1 personal note and 3 plays. No sign-in.
2. `frames/08-card.yaml` (English) first: the notifications card shows only once, after the
   first finished play.
3. `frames/06-player.yaml`, then `01`, `02`, `03`, `04` (also writes `05`), `07`,
   `08-notifications`, `09-dark`. Run the player first, so that the mini player in the
   other shots names Zaynab Talha's Ya-Sin. The player frame takes 8 shots: keep the one
   with 36:1 highlighted.
4. `set-language.yaml` with `-e LANG_OPTION=العربية` (English labels), then the same frames
   with `--lang ar`. Back to English: `LANG_OPTION=English` with the Arabic labels.

Example:

```bash
.maestro/store-screenshots/run.sh --device <udid> --lang en --out <dir> seed.yaml frames/08-card.yaml frames/06-player.yaml frames/01-listen.yaml
```

## Android Home Screen widgets

The Pixel launcher's widget picker has no Add button, so drag each widget with raw motion
events (a long-press first, then small moves):

1. Open the picker on the Qariah widgets: `maestro --device <serial> test -e PRESS=50%,52% android/open-widget-picker.yaml`
   (`PRESS` is an empty point of the Home Screen).
2. Drag the widget preview to its cell, for example:
   `adb shell "input motionevent DOWN 540 1100; sleep 1.2; input motionevent MOVE 540 900; sleep 0.3; input motionevent MOVE 540 600; sleep 1; input motionevent UP 540 600"`
3. To widen a widget, long-press it (`DOWN`, `sleep 1.5`, `UP`), then drag its side handle.

The 3.2.2 frame has Continue Listening (2×2), Quick Surah (2×2) and Ayah of the Day (3×2).
To free the row under them, Photos and YouTube were turned off for the shot with
`pm disable-user --user 0` and turned on again with `pm enable` (Gmail was already off on
this emulator). A drag of a Home Screen icon opened the app drawer instead, and the launcher
stopped responding once.

## Known limits (2026-10-22)

- **iPad:** the reciter profile rows are wider than the screen, so the "More options" button
  is off-screen (in Arabic the surah names are off-screen instead). `seed.yaml` cannot add
  loved surahs or playlists there. The 3.2.2 iPad set used the seeded iPhone data, copied
  with `simctl`: `Documents/`, `Library/Application Support/`, `Library/Preferences/` of the
  app container, and the `group.com.qariah.app` container. Quit the app on both simulators
  first.
- **iPad:** the player lives in the sidebar, which Maestro cannot see; `run.sh --ipad` opens,
  pauses and closes it by position.
- **iOS Home Screen widgets:** small and medium Qariah widgets fail to render
  (`WidgetKit … imageTooLarge (1800×1500)`, from the 600×500 pt `BrandMark.svg`). The widget
  frame waits for that fix. Maestro can add widgets with `ios/add-widget.yaml`
  (`appId: com.apple.springboard`), but it cannot tap Home Screen icons.
- **Android widgets in Arabic:** with the app in Arabic and the device in English, the
  widgets still showed English text (not checked why: the snapshot may only refresh on a
  playback change, or the widget text may follow the device language). The Arabic Android
  set has no widget frame.
- iOS 26 shrinks the tab bar after a scroll; `subflows/home.yaml` taps the shrunken icon to
  show the full bar. iOS gives the "Tab Bar" label in the app's language.
- The Maestro text match is a full, case-insensitive regex: `.*Suhaimi.*` also matched the
  Android search box text "Suhaimi", so the flows use full names.

## After the shots

- `compress.sh <in> <out>`: pngquant (quality 80–95) and oxipng, as in Sprint 26, but the
  result stays a 24-bit RGB PNG with no alpha (Google Play asks for "JPEG or 24-bit PNG (no
  alpha)"). About 65–70% smaller; no visible loss.
- `contact-sheet.sh <out.jpg>`: one image with every frame under `assets/screenshots/`.
