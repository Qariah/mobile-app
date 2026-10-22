# Play Store graphics — assets pending design

Each subdirectory below should contain numbered image files (`1.png`, `2.png`, ...) per Google Play's asset spec. None are filled in yet — the v2 launch needs:

| Directory | Format | Spec | Required? |
|---|---|---|---|
| `icon/` | PNG | 512×512, ≤ 1 MB, no transparency | yes |
| `feature-graphic/` | PNG/JPG | 1024×500, ≤ 1 MB | yes |
| `phone-screenshots/` | PNG/JPG | 16:9 or 9:16, 320–3840 px on shorter side | min 2, max 8 |
| `seven-inch-screenshots/` | PNG/JPG | 1024×600 or 1280×800 | optional |
| `large-tablet-screenshots/` | PNG/JPG | 2048×1536 etc. | optional |

Reference (Bayaan upstream): `~/claude/qariah-v2/.git` upstream/develop tree at `android/app/src/main/play/listings/en-US/graphics/`. Lifts of the asset spec but Qariah-specific designs needed — nothing in Bayaan's listing is appropriate to reuse.

For S5.5 close, only `icon/1.png` + `feature-graphic/1.png` + at least 2 phone screenshots are strictly required for a Play submission. Tablet screenshots can come post-launch.
