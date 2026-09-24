# `assets/branding/` — Qariah brand artwork

This directory holds every image referenced by `config/branding.js`. Replacing
a file here is the only thing the design team needs to do to swap Qariah's
brand artwork — `app.config.ts` reads paths from `config/branding.js`, so no
code changes are required to ship a redesign.

## Status — production artwork (Sprint 10)

The PNGs in this directory are **Qariah brand artwork**, generated from the
master logo at `_source/qariah-logo-short.png` (a 1024² PNG with transparent
background). They replaced the inherited Bayaan placeholders in the Sprint-10
brand-artwork rollout (see `DIVERGENCE_LEDGER.md`, "placeholder artwork → real"
row).

The master source files (`_source/qariah-logo-short.png`,
`_source/qariah-logo-full.jpeg`) live in `_source/` — the leading underscore
keeps them out of any glob-based Expo asset registration. They ship in git but
not in the app bundle.

**Sprint 20 source-PNG normalization (2026-05-18):** the inner sage circle in
`_source/qariah-logo-short.png` shipped at `#aac0ad` from the original design
file, which differs from the brand-canonical `#a4bba9` by ΔRGB(6,5,4) — small
enough to look the same in isolation but visible as a thin boundary line on
the splash screen (where the sage logo backdrop sits directly on a `#a4bba9`
splash background). Normalized in-place via
`magick … -fuzz 8% -fill '#a4bba9' -opaque '#aac0ad'`. The C glyph in dark
teal and the anti-aliasing pixels around the C ring are unchanged. If a
future design refresh re-introduces a non-canonical sage shade, re-run the
same normalization before generating variants.

## Brand colors

These are encoded both in `config/branding.js` (splash + adaptive bg) and in
the PNG variants themselves. Keep them in sync when iterating:

| Color | Hex | Used for |
|---|---|---|
| Qariah Teal | `#2f5059` | Q ring + book + tab on the logo; iOS dark icon bg; splash dark bg |
| Qariah Sage | `#a4bba9` | Inner circle on the logo; iOS light icon bg; splash light bg; Android adaptive bg |
| Beta Orange | `#c97a3b` | `ios-*-beta.png` BETA band — internal TestFlight variant |
| Public-Beta Purple | `#5645a1` | `ios-*-public-beta.png` PUBLIC BETA band — external TestFlight Public Link variant (Sprint 27, 2026-05-28) |

## Files

| File | Used by | Treatment |
|---|---|---|
| `icon.png` | iOS asset catalog (legacy primary) | Logo on Sage `#a4bba9`, 1024² opaque |
| `ios-light.png` | iOS 18+ icon (light) | Same as `icon.png` |
| `ios-dark.png` | iOS 18+ icon (dark) | **Inverted-color** logo (sage Q + teal interior) on Teal `#2f5059` bg, 1024² opaque |
| `ios-tinted.png` | iOS 18+ icon (tinted) | White silhouette on transparent — system applies user's tint color at runtime |
| `adaptive-icon.png` | Android adaptive icon foreground | Logo on transparent, scaled to **55% of canvas** (560/1024) so it survives any mask shape (circle / squircle / rounded square). Composited at runtime against `androidAdaptive.backgroundColor` = Sage. Safe-zone math below — do not raise this scale without recomputing. |
| `notification_icon.png` | Android notification icon | **Q outline + mushaf** silhouette — Android strips color to alpha-only, so we drop the sage interior (becomes transparent) and convert the dark-teal Q ring, tab, and mushaf to white. The mushaf detail survives at status-bar scale; it grounds the icon as Qariah's even when monochrome. White-on-transparent. |
| `splash-icon.png` | Splash logo (light mode) | Logo on transparent, scaled to **30% of canvas** (360/1200), centered. Sits on Sage `backgroundColor`. Sized down from 50% in Sprint 20 to fit Android 12+ `windowSplashScreenAnimatedIcon`'s 66.7% viewport with comfortable margin for the C glyph's asymmetric opening — see safe-zone math below. |
| `splash-icon-dark.png` | Splash logo (dark mode) | Inverted-color logo on transparent, scaled to **30% of canvas** (360/1200), centered. Sits on Teal `backgroundColorDark`. |
| `ios-{light,dark,tinted}-beta.png` | iOS internal-beta TestFlight icon | Same base as the matching non-beta variant + an **orange `#c97a3b` band** at the bottom 194px tall (y=830→1024), white bold "BETA" centered. Tinted variant uses solid gray band (system tint can't reach the band). Sprint 20. |
| `ios-{light,dark,tinted}-public-beta.png` | iOS public-beta TestFlight Public Link icon | Same base as the matching non-beta variant + a **purple `#5645a1` band** at the bottom 194px tall (y=830→1024), white bold "PUBLIC BETA" centered. Tinted variant uses solid gray band. Sprint 27, 2026-05-28. |

## Regenerating

**Sprint 27 master shape (2026-05-25):** the master at
`_source/qariah-logo-short.png` is a 1024² PNG with the sage `#a4bba9`
background BAKED IN (not transparent). This fixed the "closed-circle"
visual ambiguity — when the interior sage circle was a separate region
inside a transparent canvas, the post-composite icon had three same-color
regions (interior sage + gap sage + AppIcon-bg sage) and the eye read
the Q ring as closed. With sage baked into the master, the gap flows
continuously into the interior and the Q reads as an open letter.

Earlier transparent-bg master is archived at
`_source/qariah-logo-short-transparent.png` for reference / rollback.

If `_source/qariah-logo-short.png` changes, regenerate the 8 variants
with this recipe (note the new preprocessing step that extracts a
Q-on-transparent intermediate for the variants that need transparency):

```bash
SRC=assets/branding/_source/qariah-logo-short.png
OUT=assets/branding
TMP="${TMPDIR:-/tmp}/qariah-icon-build"
mkdir -p "$TMP"

# PREPROCESS — strip the sage from the master to get Q+book on transparent.
# Needed for iOS tinted, splash, notification, Android adaptive — all of
# which expect a Q-only silhouette on transparent so the runtime composites
# them onto a backing color (system tint, splash bg, launcher adaptive bg).
magick "$SRC" -fuzz 8% -transparent '#a4bba9' "$TMP/q-on-transparent.png"

# Inverted (sage Q + interior on transparent) — for dark + splash-dark variants
magick "$TMP/q-on-transparent.png" -fill '#a4bba9' -opaque '#2f5059' "$TMP/logo-inverted.png"

# White silhouette — for notification icon (Android strips color to alpha)
magick "$TMP/q-on-transparent.png" -channel RGB -evaluate set 100% +channel "$TMP/q-with-mushaf-white.png"

# 1+2 — iOS legacy + light: extract Q-on-transparent, scale to 60% of the
# canvas, composite back onto sage. DON'T just resize the master directly —
# the user-supplied sage-baked master draws the Q at ~85% of its canvas,
# which makes the AppIcon Q crowd the icon edges (vs the breathing-room
# proportions of pre-2026-05-25 builds). 615/1024 ≈ 60% scale restores the
# pre-refresh visual proportions. Build 988 was the first to ship the
# crowded-Q version; build 989+ uses this recipe.
magick "$TMP/q-on-transparent.png" -resize 615x615 -background '#a4bba9' -gravity center -extent 1024x1024 -alpha off "$OUT/icon.png"
cp "$OUT/icon.png" "$OUT/ios-light.png"

# 3 — iOS dark: inverted (sage Q) on Teal
magick "$TMP/logo-inverted.png" -resize 560x560 -background '#2f5059' -gravity center -extent 1024x1024 -alpha off "$OUT/ios-dark.png"

# 4 — iOS tinted: white silhouette on transparent (system applies user tint)
magick "$TMP/q-on-transparent.png" -resize 560x560 -background transparent -gravity center -extent 1024x1024 \
  -channel RGB -evaluate set 100% +channel "$OUT/ios-tinted.png"

# 5 — Android adaptive foreground: 55% scale (Google safe-zone math below)
# Android adaptive-icon foreground safe zone = 66dp / 108dp = 61% (Google spec —
# anything outside the inner 66dp circle gets clipped by tighter launcher masks
# like Samsung's squircle). Logo at 55% (560/1024) sits comfortably inside the
# safe zone. DO NOT raise past 60% without testing against Samsung-style tight
# masks — the C glyph's right edge was clipped at 70% (the pre-Sprint-20 value)
# on every launcher mask we tested.
magick "$TMP/q-on-transparent.png" -resize 560x560 -background transparent -gravity center -extent 1024x1024 "$OUT/adaptive-icon.png"

# 6+7 — Splash light/dark: 30% scale, transparent (app bg fills the rest)
# Android 12+ SplashScreen API draws `windowSplashScreenAnimatedIcon` inside a
# 192dp viewport inside a 288dp drawable canvas = 66.7% safe zone. At 50% (the
# pre-Sprint-20 value) the C glyph's asymmetric opening pushed against the
# circular mask edge and clipped on the right. At 30% (360/1200) the logo
# presents quietly with comfortable margin. DO NOT raise without testing the
# Android 12+ circular mask in a fresh emulator boot.
magick "$TMP/q-on-transparent.png" -resize 360x360 -background transparent -gravity center -extent 1200x1200 "$OUT/splash-icon.png"
magick "$TMP/logo-inverted.png" -resize 360x360 -background transparent -gravity center -extent 1200x1200 "$OUT/splash-icon-dark.png"

# 8 — Android notification: white Q+book on transparent
magick "$TMP/q-with-mushaf-white.png" -resize 870x870 -background transparent -gravity center -extent 1024x1024 "$OUT/notification_icon.png"

# 9+10+11 — iOS BETA-banded variants (internal TestFlight).
#   Band rect: y=830→1024 (194px = ~19% of 1024). Sample colors taken from
#   the existing files in Sprint 27 (#c97a3b orange, white text, ~100pt Arial-Bold).
for v in light dark; do
  magick "$OUT/ios-${v}.png" \
    -fill '#c97a3b' -draw "rectangle 0,830 1024,1024" \
    -fill white -font Arial-Bold -pointsize 128 \
    -gravity south -annotate +0+45 "BETA" \
    "$OUT/ios-${v}-beta.png"
done
# Tinted: solid gray band (system tint can't reach the band region).
magick "$OUT/ios-tinted.png" \
  -fill 'gray50' -draw "rectangle 0,830 1024,1024" \
  -fill white -font Arial-Bold -pointsize 128 \
  -gravity south -annotate +0+45 "BETA" \
  "$OUT/ios-tinted-beta.png"

# 12+13+14 — iOS PUBLIC-BETA-banded variants (external TestFlight Public Link).
#   Same geometry as BETA, purple #5645a1 band, smaller 100pt text to fit "PUBLIC BETA".
for v in light dark; do
  magick "$OUT/ios-${v}.png" \
    -fill '#5645a1' -draw "rectangle 0,830 1024,1024" \
    -fill white -font Arial-Bold -pointsize 100 \
    -gravity south -annotate +0+45 "PUBLIC BETA" \
    "$OUT/ios-${v}-public-beta.png"
done
magick "$OUT/ios-tinted.png" \
  -fill 'gray50' -draw "rectangle 0,830 1024,1024" \
  -fill white -font Arial-Bold -pointsize 100 \
  -gravity south -annotate +0+45 "PUBLIC BETA" \
  "$OUT/ios-tinted-public-beta.png"
```

The BETA + PUBLIC BETA variants are swapped into the AppIcon at archive
time by `scripts/ios-archive.sh --beta` / `--public-beta`, with EXIT-trap
restore to the prod icon. No need to commit them to the native asset
catalog — the archive script handles that.

After regen, also propagate to native asset catalogs:

```bash
# iOS AppIcon (3 variants)
cp $OUT/ios-light.png  ios/Qariah/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
cp $OUT/ios-dark.png   ios/Qariah/Images.xcassets/AppIcon.appiconset/App-Icon-dark-1024x1024@1x.png
cp $OUT/ios-tinted.png ios/Qariah/Images.xcassets/AppIcon.appiconset/App-Icon-tinted-1024x1024@1x.png

# iOS splash imageset (3 sizes light + 3 sizes dark)
for size in 500 1000 1500; do
  suffix=""; [ "$size" = "1000" ] && suffix="@2x"; [ "$size" = "1500" ] && suffix="@3x"
  magick $OUT/splash-icon.png      -resize ${size}x${size} ios/Qariah/Images.xcassets/SplashScreenLogo.imageset/image${suffix}.png
  magick $OUT/splash-icon-dark.png -resize ${size}x${size} ios/Qariah/Images.xcassets/SplashScreenLogo.imageset/dark_image${suffix}.png
done

# Android mipmaps (5 densities × 3 variants) + notification (5 densities)
for density in mdpi:48:108:24 hdpi:72:162:36 xhdpi:96:216:48 xxhdpi:144:324:72 xxxhdpi:192:432:96; do
  IFS=: read d legacy fg notif <<<"$density"
  magick $OUT/icon.png          -resize ${legacy}x${legacy} android/app/src/main/res/mipmap-$d/ic_launcher.webp
  cp android/app/src/main/res/mipmap-$d/ic_launcher.webp android/app/src/main/res/mipmap-$d/ic_launcher_round.webp
  magick $OUT/adaptive-icon.png -resize ${fg}x${fg}         android/app/src/main/res/mipmap-$d/ic_launcher_foreground.webp
  magick $OUT/notification_icon.png -resize ${notif}x${notif} android/app/src/main/res/drawable-$d/notification_icon.png
done
```

Splash screen background colors are configured in `config/branding.js`
(`assets.splash.backgroundColor` / `backgroundColorDark`), not in the PNGs
themselves.

The recipe is also baked into the rollout PR's commit message for archaeology.
