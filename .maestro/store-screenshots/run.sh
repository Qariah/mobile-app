#!/bin/bash
# Run the store-screenshot flows with the labels of one app language.
#
# Usage:
#   run.sh --device <udid|serial> --lang en|ar [--ipad] [-e KEY=VALUE] --out <dir> <flow> [<flow> ...]
# A flow is a path relative to this folder, for example seed.yaml or
# frames/01-listen.yaml. See README.md for the order.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVICE="" LANG_CODE="en" OUT="" IPAD=false
FLOWS=()
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --lang) LANG_CODE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --ipad) IPAD=true; shift ;;
    -e) EXTRA+=(-e "$2"); shift 2 ;;
    *) FLOWS+=("$1"); shift ;;
  esac
done
if [ -z "$DEVICE" ] || [ -z "$OUT" ] || [ ${#FLOWS[@]} -eq 0 ]; then
  echo "usage: run.sh --device <udid|serial> --lang en|ar --out <dir> <flow>..." >&2
  exit 2
fi
mkdir -p "$OUT"

# Tab labels: iOS 18 prefixes the selected tab with ", " and the iPad sidebar
# with an icon glyph and ", ", so allow a prefix.
# iOS gives system labels ("Tab Bar") in the app's language.
if [ "$LANG_CODE" = "ar" ]; then
  L=(
    L_TABBAR='شريط علامات التبويب' L_LISTEN='(.*, )?الاستماع' L_MUSHAF_TAB='(.*, )?المصحف' L_COLLECTION='(.*, )?مكتبتي'
    L_SETTINGS='(.*, )?الإعدادات' L_SEARCH='(.*, )?بحث' L_TABS_MIN='الاستماع|المصحف|الإعدادات'
    L_BACK='رجوع' L_CANCEL='إلغاء' L_SEARCH_BOX='ابحث عن سورة أو قارئة' L_RECITERS='القارئات'
    L_ASC='.*تصاعدي' L_JUZ='.*الجزء.*' L_PAUSE='إيقاف مؤقت'
    L_MUSHAF_SETTINGS='إعدادات المصحف.*' L_VIEW_MUSHAF='المصحف' L_VIEW_LIST='قائمة'
    L_SHEET_OPEN='طريقة العرض|لفظ الجلالة|تلوين التجويد'
    L_DARK='داكن' L_SETTINGS_TOP='الحساب|المظهر' L_LIGHT='فاتح' L_NOTIF_ROW='.*اختر الإشعارات التي تصلك.*'
    L_CARD='.*إشعارات تطبيق قارئة.*' L_LANGUAGE='.*اللغة.*' L_RESTART='إعادة التشغيل'
    R_ZAYNAB='.*زينب طلحة.*' R_SUHAIMI='.*عتيقة سهيمي.*'
    S_YASIN='سورة يس،.*' S_KAWTHAR='سورة الكوثر،.*'
    G_FATIHAH='.*الفاتحة.*' G_KAHF='.*الكهف.*' G_MULK='.*الملك.*'
    T_PLAYER='[0٠]:[0٠][7-9٧-٩]' PLAYER_CLOSE='88%,10%'
  )
else
  L=(
    L_TABBAR='Tab Bar' L_LISTEN='.*Listen' L_MUSHAF_TAB='.*Mushaf' L_COLLECTION='.*Collection'
    L_SETTINGS='.*Settings' L_SEARCH='.*Search' L_TABS_MIN='Listen|Mushaf|Settings'
    L_BACK='Back' L_CANCEL='Cancel' L_SEARCH_BOX='Search surahs or reciters' L_RECITERS='Reciters'
    L_ASC='.*Asc' L_JUZ='.*JUZ.*' L_PAUSE='Pause'
    L_MUSHAF_SETTINGS='Mushaf Settings.*' L_VIEW_MUSHAF='Mushaf' L_VIEW_LIST='List'
    L_SHEET_OPEN='VIEW TYPE|DIVINE NAMES|Tajweed Coloring'
    L_DARK='Dark' L_SETTINGS_TOP='ACCOUNT|APPEARANCE' L_LIGHT='Light' L_NOTIF_ROW='.*Choose the notifications you get.*'
    L_CARD='.*Notifications from Qariah.*' L_LANGUAGE='.*Language.*' L_RESTART='Restart'
    R_ZAYNAB='.*Zaynab Talha.*' R_SUHAIMI='.*Qah Suhaimi.*'
    S_YASIN='Surah Ya-Sin.*' S_KAWTHAR='Surah Al-Kawthar.*'
    G_FATIHAH='.*Al-Fatihah.*' G_KAHF='.*Al-Kahf.*' G_MULK='.*Al-Mulk.*'
    T_PLAYER='0:0[7-9]' PLAYER_CLOSE='12%,10%'
  )
fi

# iPad: the player opens from the sidebar's player at the bottom (right in
# Arabic, left in English). The tablet player pane is on the left in both
# languages, with its close button top left and Play/Pause in the middle.
if [ "$IPAD" = true ]; then
  if [ "$LANG_CODE" = "ar" ]; then L+=(PLAYER_OPEN='96%,93%'); else L+=(PLAYER_OPEN='4%,93%'); fi
  L+=(PLAYER_CLOSE='3%,5%' PLAYER_PAUSE='22%,47%')
else
  L+=(PLAYER_OPEN='' PLAYER_PAUSE='')
fi

ARGS=(-e "OUT=$OUT" -e "IPAD=$IPAD")
for kv in "${L[@]}"; do ARGS+=(-e "$kv"); done
ARGS+=(${EXTRA[@]+"${EXTRA[@]}"})

export PATH="$HOME/.maestro/bin:$PATH"
for flow in "${FLOWS[@]}"; do
  echo "== $flow ($LANG_CODE)"
  maestro --device "$DEVICE" test "${ARGS[@]}" "$HERE/$flow"
done
