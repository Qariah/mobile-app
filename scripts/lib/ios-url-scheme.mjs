// @ai
//
// scripts/lib/ios-url-scheme.mjs
// ------------------------------
// Qariah (TECH_DEBT #342, Sprint 51): the URL scheme of an iOS archive.
//
// The committed ios/ tree has the production scheme (`qariah`, written by the
// prebuild plugins from app.config.js). An internal beta archive
// (scripts/ios-archive.sh --beta) uses the scheme of its own bundle id
// (`qariah-beta`, config/appUrlScheme.js) everywhere a build registers or
// builds an app link:
//   - the app's URL types (CFBundleURLTypes): `qariah-beta`, `exp+qariah-beta`
//   - the app's `BayaanURLScheme` key (App Intents, AppLinks in the app)
//   - the widget's `BAYAAN_URL_SCHEME` build setting (widget and Live
//     Activity links; targets/widgets/Info.plist expands it)
//   - the share extension hand-off (`<scheme>://dataUrl=<scheme>ShareKey`,
//     ShareViewController.swift), which expo-share-intent reads in the app
//     with `Constants.expoConfig.scheme[0]` (app.config.js)
// This module rewrites those files (`applyUrlScheme`; the archive script backs
// them up first and restores them on exit) and finds each file that does not
// use the scheme of an archive (`checkUrlScheme`). The check also holds the
// OAuth rule: the QF OAuth callback scheme is never an iOS app URL scheme.
//
// The edits are plain text edits on the known Expo file formats, so the tests
// run on Linux CI with no macOS tool (no PlistBuddy).

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import appUrlScheme from '../../config/appUrlScheme.js';
import {
  hasWidgetTarget,
  readBuildSetting,
  readStringKey,
  writeStringKey,
} from './ios-app-group.mjs';

const {
  ARCHIVE_BUNDLE_ID_ENV,
  OAUTH_CALLBACK_SCHEME,
  devClientScheme,
  urlSchemeForBundleId,
} = appUrlScheme;

export {ARCHIVE_BUNDLE_ID_ENV, OAUTH_CALLBACK_SCHEME};

/** The files that register or build an app link, relative to the repo root. */
export const FILES = Object.freeze({
  appInfoPlist: 'ios/Qariah/Info.plist',
  shareSwift: 'ios/ShareExtension/ShareViewController.swift',
  widgetInfoPlist: 'targets/widgets/Info.plist',
  pbxproj: 'ios/Qariah.xcodeproj/project.pbxproj',
});

const SCHEME_KEY = 'BayaanURLScheme';
const WIDGET_SCHEME_SETTING = 'BAYAAN_URL_SCHEME';
const URL_SCHEMES_PATTERN =
  /(<key>CFBundleURLSchemes<\/key>\s*<array>)([\s\S]*?)(<\/array>)/g;
const SHARE_PROTOCOL_PATTERN = /(let shareProtocol: String = ")([^"\n]*)(")/g;
const SHARE_KEY_PATTERN = /(let sharedKey: String = ")([^"\n]*)(")/g;

// ─── The schemes of an archive ──────────────────────────────────────────────

/**
 * The schemes of an archive of the app `bundleId`:
 * `{scheme, devClientScheme, productionScheme, productionDevClientScheme}`.
 */
export function archiveSchemes(bundleId, productionBundleId, productionScheme) {
  const scheme = urlSchemeForBundleId(
    bundleId,
    productionBundleId,
    productionScheme,
  );
  return {
    scheme,
    devClientScheme: devClientScheme(scheme),
    productionScheme,
    productionDevClientScheme: devClientScheme(productionScheme),
  };
}

/** The key that the share extension and expo-share-intent use: `<scheme>ShareKey`. */
export function shareKeyFor(scheme) {
  return `${scheme}ShareKey`;
}

// ─── Text helpers ───────────────────────────────────────────────────────────

/** Every string of every CFBundleURLSchemes array of an Info.plist, in order. */
export function readUrlSchemes(xml) {
  const out = [];
  for (const match of xml.matchAll(URL_SCHEMES_PATTERN)) {
    for (const item of match[2].matchAll(/<string>([^<]*)<\/string>/g)) {
      out.push(item[1]);
    }
  }
  return out;
}

/** Rewrites each CFBundleURLSchemes string that `map` names. */
export function mapUrlSchemes(xml, map) {
  return xml.replace(URL_SCHEMES_PATTERN, (_match, open, body, close) => {
    const next = body.replace(
      /(<string>)([^<]*)(<\/string>)/g,
      (_item, a, value, b) => `${a}${map[value] ?? value}${b}`,
    );
    return `${open}${next}${close}`;
  });
}

function readOne(swift, pattern, name) {
  const matches = [...swift.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`expected one ${name} constant, found ${matches.length}`);
  }
  return matches[0][2];
}

/** The hand-off scheme and key of the share extension (ShareViewController.swift). */
export function readShareSwift(swift) {
  return {
    protocol: readOne(swift, SHARE_PROTOCOL_PATTERN, 'shareProtocol'),
    key: readOne(swift, SHARE_KEY_PATTERN, 'sharedKey'),
  };
}

/** Sets the hand-off scheme of the share extension, and its key `<scheme>ShareKey`. */
export function writeShareSwift(swift, scheme) {
  readShareSwift(swift);
  return swift
    .replace(SHARE_PROTOCOL_PATTERN, (_m, a, _old, b) => `${a}${scheme}${b}`)
    .replace(
      SHARE_KEY_PATTERN,
      (_m, a, _old, b) => `${a}${shareKeyFor(scheme)}${b}`,
    );
}

/**
 * Sets every value of a pbxproj build setting. Xcode quotes a value with a
 * character outside `[A-Za-z0-9_.$/]` (for example `-`), so this does too.
 */
export function writeQuotedBuildSetting(pbxproj, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoted = /^[A-Za-z0-9_.$/]+$/.test(value) ? value : `"${value}"`;
  return pbxproj.replace(
    new RegExp(`^(\\t+${escaped} = )("?)([^";\\n]*)\\2;$`, 'gm'),
    (_match, head) => `${head}${quoted};`,
  );
}

function read(root, rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function has(root, rel) {
  return existsSync(path.join(root, rel));
}

// ─── Apply and check ────────────────────────────────────────────────────────

/**
 * Rewrites every app-link file under `root` to the scheme of an archive.
 * Returns the files it changed. A run with the production schemes changes
 * nothing.
 */
export function applyUrlScheme(root, schemes) {
  const {scheme, productionScheme} = schemes;
  const edits = new Map();
  const edit = (rel, fn) => {
    const before = edits.get(rel) ?? read(root, rel);
    edits.set(rel, fn(before));
  };

  edit(FILES.appInfoPlist, xml => {
    const out = mapUrlSchemes(xml, {
      [productionScheme]: scheme,
      [schemes.productionDevClientScheme]: schemes.devClientScheme,
    });
    return writeStringKey(out, SCHEME_KEY, scheme);
  });

  if (has(root, FILES.shareSwift)) {
    edit(FILES.shareSwift, swift => writeShareSwift(swift, scheme));
  }

  const pbxproj = read(root, FILES.pbxproj);
  if (hasWidgetTarget(pbxproj)) {
    if (readBuildSetting(pbxproj, WIDGET_SCHEME_SETTING).length === 0) {
      throw new Error(
        `${FILES.pbxproj} has the widget target but no ${WIDGET_SCHEME_SETTING} (run prebuild)`,
      );
    }
    edit(FILES.pbxproj, text =>
      writeQuotedBuildSetting(text, WIDGET_SCHEME_SETTING, scheme),
    );
  }

  const changed = [];
  for (const [rel, text] of edits) {
    if (text !== read(root, rel)) {
      writeFileSync(path.join(root, rel), text);
      changed.push(rel);
    }
  }
  return changed;
}

/**
 * One line for each file that does not use the scheme of the archive, and for
 * an iOS URL type that is the QF OAuth callback scheme. An empty list means
 * every target uses the scheme.
 */
export function checkUrlScheme(root, schemes) {
  const {scheme, productionScheme} = schemes;
  const problems = [];
  const safe = (rel, fn) => {
    try {
      fn();
    } catch (error) {
      problems.push(`  - ${rel}: ${error.message}`);
    }
  };

  safe(FILES.appInfoPlist, () => {
    const xml = read(root, FILES.appInfoPlist);
    const types = readUrlSchemes(xml);
    for (const wanted of [scheme, schemes.devClientScheme]) {
      if (!types.includes(wanted)) {
        problems.push(
          `  - ${FILES.appInfoPlist} URL types [${types.join(', ')}] have no ${wanted}`,
        );
      }
    }
    const forbidden = [OAUTH_CALLBACK_SCHEME];
    if (scheme !== productionScheme) {
      forbidden.push(productionScheme, schemes.productionDevClientScheme);
    }
    for (const bad of forbidden.filter(s => types.includes(s))) {
      problems.push(
        bad === OAUTH_CALLBACK_SCHEME
          ? `  - ${FILES.appInfoPlist} URL types have the OAuth callback scheme ${bad} (it breaks iOS sign-in)`
          : `  - ${FILES.appInfoPlist} URL types still have ${bad} (another app answers to it)`,
      );
    }
    const key = readStringKey(xml, SCHEME_KEY);
    if (key !== scheme) {
      problems.push(
        `  - ${FILES.appInfoPlist} ${SCHEME_KEY} is ${key ?? '<missing>'}, not ${scheme}`,
      );
    }
  });

  if (has(root, FILES.shareSwift)) {
    safe(FILES.shareSwift, () => {
      const {protocol, key} = readShareSwift(read(root, FILES.shareSwift));
      if (protocol !== scheme) {
        problems.push(
          `  - ${FILES.shareSwift} shareProtocol is ${protocol}, not ${scheme}`,
        );
      }
      if (key !== shareKeyFor(scheme)) {
        problems.push(
          `  - ${FILES.shareSwift} sharedKey is ${key}, not ${shareKeyFor(scheme)}`,
        );
      }
    });
  }

  safe(FILES.pbxproj, () => {
    const pbxproj = read(root, FILES.pbxproj);
    if (!hasWidgetTarget(pbxproj)) return;
    safe(FILES.widgetInfoPlist, () => {
      const value = readStringKey(
        read(root, FILES.widgetInfoPlist),
        SCHEME_KEY,
      );
      if (value !== `$(${WIDGET_SCHEME_SETTING})`) {
        problems.push(
          `  - ${FILES.widgetInfoPlist} has no ${SCHEME_KEY} = $(${WIDGET_SCHEME_SETTING}) key`,
        );
      }
    });
    const settings = [
      ...new Set(readBuildSetting(pbxproj, WIDGET_SCHEME_SETTING)),
    ];
    if (settings.length === 0) {
      problems.push(
        `  - the widget target has no ${WIDGET_SCHEME_SETTING} build setting (run prebuild)`,
      );
    } else if (settings.length !== 1 || settings[0] !== scheme) {
      problems.push(
        `  - the widget ${WIDGET_SCHEME_SETTING} build setting is [${settings.join(
          ', ',
        )}], not ${scheme}`,
      );
    }
  });

  return problems;
}

/**
 * One line for each way the Expo config (`require('app.config.js')`, read
 * with ARCHIVE_BUNDLE_ID_ENV set) does not match the archive. The build embeds
 * that config (Constants.expoConfig), and expo-share-intent reads `scheme[0]`.
 */
export function configSchemeProblems(appConfig, schemes) {
  const raw = appConfig?.expo?.scheme;
  const list = Array.isArray(raw) ? raw : [raw];
  const problems = [];
  if (list[0] !== schemes.scheme) {
    problems.push(
      `  - app.config.js scheme[0] is ${String(list[0])}, not ${schemes.scheme}`,
    );
  }
  if (!list.includes(OAUTH_CALLBACK_SCHEME)) {
    problems.push(
      `  - app.config.js scheme has no ${OAUTH_CALLBACK_SCHEME} (Android sign-in needs it)`,
    );
  }
  return problems;
}

/** The app-link values of the tree under `root`, one line each (dry run). */
export function describeUrlSchemes(root) {
  const lines = [];
  const xml = read(root, FILES.appInfoPlist);
  lines.push(`      app URL types: ${readUrlSchemes(xml).join(', ')}`);
  lines.push(`      app ${SCHEME_KEY}: ${readStringKey(xml, SCHEME_KEY)}`);
  if (has(root, FILES.shareSwift)) {
    const {protocol, key} = readShareSwift(read(root, FILES.shareSwift));
    lines.push(`      share extension hand-off: ${protocol}://dataUrl=${key}`);
  }
  const pbxproj = read(root, FILES.pbxproj);
  if (hasWidgetTarget(pbxproj)) {
    const settings = [
      ...new Set(readBuildSetting(pbxproj, WIDGET_SCHEME_SETTING)),
    ];
    lines.push(`      widget ${WIDGET_SCHEME_SETTING}: ${settings.join(', ')}`);
  }
  return lines;
}
