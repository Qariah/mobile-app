#!/usr/bin/env node
// @ai
//
// scripts/check-widget-fonts.mjs
// ------------------------------
// Qariah (Sprint 51): fail when a finished build lacks the widget fonts. The
// build scripts call it after the build, before an export or an upload:
//   scripts/android-archive.sh      the APK and the AAB
//   scripts/ios-archive.sh          the .xcarchive
//   scripts/android-upload-play.sh  the AAB, again, before the upload
// The checks are in scripts/lib/widget-fonts.mjs. It reads the build and
// changes nothing.
//
// Usage:
//   node scripts/check-widget-fonts.mjs [--root <repo>] <build>...
//   <build> is an .apk, an .aab or an .xcarchive folder.
//
// A build that has no widget module (a release line from before the widgets,
// for example hotfix/3.2.0-anr-splash) is skipped, and the script prints "skip".
// With --root, the script fails instead of skipping when <repo> holds the widget
// module (modules/bayaan-widgets/android for Android, targets/widgets for iOS)
// but the build does not. The archive scripts pass --root, because they know
// their own source tree. The upload script has only the AAB, so it does not.
//
// Environment: SKIP_WIDGET_FONT_CHECK=1 turns the check off. The script prints a
// WARNING and exits 0. Set it on the command line, for one call, and only when
// a build without the widget fonts is deliberate.
//
// Exit codes: 0 every build has the fonts (or the check is skipped), 1 a build
// lacks a font (or has an empty one), 2 the call is wrong or a file cannot be
// read.

import path from 'node:path';
import process from 'node:process';

import {
  FIX_HINT,
  artifactKind,
  checkWidgetFonts,
  describeResult,
  treeHasWidgets,
} from './lib/widget-fonts.mjs';

const USAGE =
  'usage: node scripts/check-widget-fonts.mjs [--root <repo>] <apk|aab|xcarchive>...';

function parseArgs(args) {
  const builds = [];
  let root = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--root') {
      i += 1;
      root = args[i];
      if (!root || root.startsWith('-')) return null;
    } else if (arg.startsWith('-')) {
      return null;
    } else {
      builds.push(arg);
    }
  }
  return builds.length > 0 ? {builds, root} : null;
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(2);
}
const {builds, root} = parsed;

if (process.env.SKIP_WIDGET_FONT_CHECK === '1') {
  console.error(
    `WARNING: SKIP_WIDGET_FONT_CHECK=1 is set, so the widget fonts of ${builds.join(', ')} are NOT checked. The widgets can show no Quran text.`,
  );
  process.exit(0);
}

let failed = false;
let broken = false;
for (const build of builds) {
  try {
    const requireWidgets =
      root !== null && treeHasWidgets(artifactKind(build), path.resolve(root));
    const result = checkWidgetFonts(build, {requireWidgets});
    const lines = describeResult(result);
    (result.ok ? console.log : console.error)(lines.join('\n'));
    if (!result.ok) failed = true;
  } catch (error) {
    console.error(`ERROR ${build}: ${error.message}`);
    broken = true;
  }
}
if (failed) console.error(FIX_HINT);
if (broken) process.exit(2);
process.exit(failed ? 1 : 0);
