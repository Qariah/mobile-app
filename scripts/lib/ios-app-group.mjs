// @ai
//
// scripts/lib/ios-app-group.mjs
// -----------------------------
// Qariah (TECH_DEBT #289, Sprint 50): the iOS App Group of an archive.
//
// The committed ios/ tree has the production group (`group.com.qariah.app`,
// written by the prebuild plugins from config/iosAppGroup.js). An internal
// beta archive (scripts/ios-archive.sh --beta) uses `group.<beta bundle id>`
// for every target. This module:
//   - rewrites the committed files to the group of an archive (`applyAppGroup`;
//     the archive script backs the files up first and restores them on exit),
//   - finds each file that does not use the group of an archive (`checkAppGroup`),
//   - reads what the Apple developer portal allows, through the read-only App
//     Store Connect API, and writes the owner step when a group is missing
//     (`evaluatePortalTarget`, `ownerInstructions`, `fetchPortalTarget`).
//
// The file edits are plain text edits on the known Expo file formats, so the
// tests run on Linux CI with no macOS tool (no PlistBuddy).

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {Buffer} from 'node:buffer';

import iosAppGroup from '../../config/iosAppGroup.js';

const {
  appGroupForBundleId,
  legacyAppGroupForBundleId,
  LEGACY_APP_GROUP_INFO_PLIST_KEY,
} = iosAppGroup;

export {appGroupForBundleId, legacyAppGroupForBundleId};
export const LEGACY_KEY = LEGACY_APP_GROUP_INFO_PLIST_KEY;

/** The files that hold the App Group, relative to the repository root. */
export const FILES = Object.freeze({
  appInfoPlist: 'ios/Qariah/Info.plist',
  appEntitlements: 'ios/Qariah/Qariah.entitlements',
  shareInfoPlist: 'ios/ShareExtension/ShareExtension-Info.plist',
  shareEntitlements: 'ios/ShareExtension/ShareExtension.entitlements',
  shareSwift: 'ios/ShareExtension/ShareViewController.swift',
  widgetEntitlements:
    'ios/.targets/BayaanWidgetsExtension/generated.entitlements',
  widgetInfoPlist: 'targets/widgets/Info.plist',
  pbxproj: 'ios/Qariah.xcodeproj/project.pbxproj',
});

/** The `INFOPLIST_FILE` build setting of each target (relative to ios/). */
const TARGET_INFO_PLISTS = Object.freeze({
  app: 'Qariah/Info.plist',
  share: 'ShareExtension/ShareExtension-Info.plist',
  widget: '../targets/widgets/Info.plist',
});

const APP_GROUPS_KEY = 'com.apple.security.application-groups';
const GROUP_PATTERN = /^group\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const SHARE_SWIFT_PATTERN =
  /(let hostAppGroupIdentifier: String = ")([^"\n]*)(")/g;
const WIDGET_GROUP_SETTING = 'BAYAAN_APP_GROUP';

// ─── Text helpers ───────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function assertGroup(group, name = 'group') {
  if (typeof group !== 'string' || !GROUP_PATTERN.test(group)) {
    throw new Error(
      `${name} must look like group.<bundle id>, got ${JSON.stringify(group)}`,
    );
  }
}

function stringKeyPattern(key) {
  return new RegExp(
    `(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`,
    'g',
  );
}

/** The string value of a plist key, or null when the key is absent. */
export function readStringKey(xml, key) {
  const matches = [...xml.matchAll(stringKeyPattern(key))];
  if (matches.length > 1) {
    throw new Error(`the key ${key} has ${matches.length} string values`);
  }
  return matches.length === 1 ? unescapeXml(matches[0][2]) : null;
}

/** Sets the string value of a plist key that is present exactly once. */
export function writeStringKey(xml, key, value) {
  const count = [...xml.matchAll(stringKeyPattern(key))].length;
  if (count !== 1) {
    throw new Error(`expected one string value of ${key}, found ${count}`);
  }
  return xml.replace(
    stringKeyPattern(key),
    (_match, open, _old, close) => `${open}${escapeXml(value)}${close}`,
  );
}

/**
 * Sets a string key. When the key is absent, adds it after the string key
 * `afterKey`, with the same indentation, so the diff stays local.
 */
export function upsertStringKey(xml, key, value, afterKey) {
  if (readStringKey(xml, key) !== null) return writeStringKey(xml, key, value);
  const anchor = new RegExp(
    `([ \\t]*)<key>${escapeRegExp(afterKey)}</key>(\\s*)<string>[^<]*</string>`,
  ).exec(xml);
  if (!anchor) throw new Error(`no string key ${afterKey} to add ${key} after`);
  const end = anchor.index + anchor[0].length;
  const added = `\n${anchor[1]}<key>${key}</key>${anchor[2]}<string>${escapeXml(
    value,
  )}</string>`;
  return xml.slice(0, end) + added + xml.slice(end);
}

/** Removes a string key (and its line) when it is present. */
export function removeStringKey(xml, key) {
  return xml.replace(
    new RegExp(
      `\\n[ \\t]*<key>${escapeRegExp(key)}</key>\\s*<string>[^<]*</string>`,
      'g',
    ),
    '',
  );
}

function arrayKeyPattern(key, flags = '') {
  return new RegExp(
    `([ \\t]*)<key>${escapeRegExp(
      key,
    )}</key>(\\s*)(<array/>|<array>([\\s\\S]*?)</array>)`,
    flags,
  );
}

/** The strings of a plist array key, or null when the key is absent. */
export function readStringArray(xml, key) {
  const matches = [...xml.matchAll(arrayKeyPattern(key, 'g'))];
  if (matches.length > 1) {
    throw new Error(`the key ${key} has ${matches.length} arrays`);
  }
  if (matches.length === 0) return null;
  const body = matches[0][4] ?? '';
  const others = body.replace(/<string>[^<]*<\/string>/g, '').trim();
  if (others)
    throw new Error(`the array ${key} has an item that is not a string`);
  return [...body.matchAll(/<string>([^<]*)<\/string>/g)].map(m =>
    unescapeXml(m[1]),
  );
}

/** Sets the strings of a plist array key that is present exactly once. */
export function writeStringArray(xml, key, values) {
  const count = [...xml.matchAll(arrayKeyPattern(key, 'g'))].length;
  if (count !== 1) {
    throw new Error(`expected one array value of ${key}, found ${count}`);
  }
  return xml.replace(
    arrayKeyPattern(key),
    (_match, indent, between, _array, body) => {
      const itemIndent =
        /\n([ \t]*)<string>/.exec(body ?? '')?.[1] ?? `${indent}  `;
      const array =
        values.length === 0
          ? '<array/>'
          : `<array>\n${values
              .map(v => `${itemIndent}<string>${escapeXml(v)}</string>`)
              .join('\n')}\n${indent}</array>`;
      return `${indent}<key>${key}</key>${between}${array}`;
    },
  );
}

function settingPattern(name) {
  return new RegExp(
    `^(\\t+${escapeRegExp(name)} = )("?)([^";\\n]*)\\2;$`,
    'gm',
  );
}

/** Every value of a pbxproj build setting, in file order. */
export function readBuildSetting(pbxproj, name) {
  return [...pbxproj.matchAll(settingPattern(name))].map(m => m[3]);
}

/** Sets every value of a pbxproj build setting (a group id needs no quotes). */
export function writeBuildSetting(pbxproj, name, value) {
  return pbxproj.replace(
    settingPattern(name),
    (_match, head) => `${head}${value};`,
  );
}

/** The share extension's group constant (ShareViewController.swift). */
export function readShareSwiftGroup(swift) {
  const matches = [...swift.matchAll(SHARE_SWIFT_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(
      `expected one hostAppGroupIdentifier constant, found ${matches.length}`,
    );
  }
  return matches[0][2];
}

export function writeShareSwiftGroup(swift, group) {
  readShareSwiftGroup(swift);
  return swift.replace(
    SHARE_SWIFT_PATTERN,
    (_match, open, _old, close) => `${open}${group}${close}`,
  );
}

/**
 * The PRODUCT_BUNDLE_IDENTIFIER values of each target, found by the target's
 * INFOPLIST_FILE: `{app: [...], share: [...], widget: [...]}` (unique values).
 */
export function targetBundleIds(pbxproj) {
  const out = {app: new Set(), share: new Set(), widget: new Set()};
  const blocks = pbxproj.matchAll(
    // A configuration can have a baseConfigurationReference line before its
    // buildSettings (the app target's Pods xcconfig).
    /isa = XCBuildConfiguration;[^{]*?buildSettings = \{([\s\S]*?)\n\t\t\t\};/g,
  );
  for (const [, body] of blocks) {
    const plist = /\bINFOPLIST_FILE = "?([^";\n]+)"?;/.exec(body)?.[1];
    const id = /\bPRODUCT_BUNDLE_IDENTIFIER = "?([^";\n]+)"?;/.exec(body)?.[1];
    if (!plist || !id) continue;
    for (const [target, file] of Object.entries(TARGET_INFO_PLISTS)) {
      if (plist === file) out[target].add(id);
    }
  }
  return {
    app: [...out.app],
    share: [...out.share],
    widget: [...out.widget],
  };
}

/** True when the Xcode project has the widget extension target. */
export function hasWidgetTarget(pbxproj) {
  return pbxproj.includes(`INFOPLIST_FILE = ${TARGET_INFO_PLISTS.widget};`);
}

// ─── The group of an archive ────────────────────────────────────────────────

/**
 * The groups of an archive of the app `bundleId`: `{group, legacyGroup}`.
 * `legacyGroup` is the group the build moves its data from (beta only).
 */
export function archiveGroups(bundleId, productionBundleId, options) {
  return {
    group: appGroupForBundleId(bundleId),
    legacyGroup: legacyAppGroupForBundleId(
      bundleId,
      productionBundleId,
      options,
    ),
  };
}

function read(root, rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function has(root, rel) {
  return existsSync(path.join(root, rel));
}

/**
 * Rewrites every App Group file under `root` to `group`. The app also gets
 * `legacyGroup` (second in its entitlements, and the QariahLegacyAppGroup
 * Info.plist key that modules/qariah-app-group reads) when it is not null.
 * Returns the files it changed. A run with the committed values changes
 * nothing.
 */
export function applyAppGroup(root, {group, legacyGroup = null}) {
  assertGroup(group);
  if (legacyGroup !== null) assertGroup(legacyGroup, 'legacyGroup');
  const edits = new Map();
  const edit = (rel, fn) => {
    const before = edits.get(rel) ?? read(root, rel);
    edits.set(rel, fn(before));
  };

  edit(FILES.appInfoPlist, xml => {
    let out = writeStringKey(xml, 'AppGroupIdentifier', group);
    out = writeStringKey(out, 'BayaanAppGroup', group);
    return legacyGroup
      ? upsertStringKey(out, LEGACY_KEY, legacyGroup, 'BayaanAppGroup')
      : removeStringKey(out, LEGACY_KEY);
  });
  edit(FILES.appEntitlements, xml =>
    writeStringArray(xml, APP_GROUPS_KEY, [group, legacyGroup].filter(Boolean)),
  );

  if (has(root, FILES.shareEntitlements)) {
    edit(FILES.shareEntitlements, xml =>
      writeStringArray(xml, APP_GROUPS_KEY, [group]),
    );
    edit(FILES.shareInfoPlist, xml =>
      writeStringKey(xml, 'AppGroupIdentifier', group),
    );
    edit(FILES.shareSwift, swift => writeShareSwiftGroup(swift, group));
  }

  const pbxproj = read(root, FILES.pbxproj);
  if (hasWidgetTarget(pbxproj)) {
    edit(FILES.widgetEntitlements, xml =>
      writeStringArray(xml, APP_GROUPS_KEY, [group]),
    );
    if (readBuildSetting(pbxproj, WIDGET_GROUP_SETTING).length === 0) {
      throw new Error(
        `${FILES.pbxproj} has the widget target but no ${WIDGET_GROUP_SETTING} (run prebuild)`,
      );
    }
    edit(FILES.pbxproj, text =>
      writeBuildSetting(text, WIDGET_GROUP_SETTING, group),
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

function sameList(a, b) {
  return (
    Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
  );
}

function show(list) {
  return list === null ? '<missing>' : `[${list.join(', ')}]`;
}

/**
 * One line for each file that does not use `group` (and, for the app,
 * `legacyGroup`). An empty list means every target uses the group.
 */
export function checkAppGroup(root, {group, legacyGroup = null}) {
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
    for (const key of ['AppGroupIdentifier', 'BayaanAppGroup']) {
      const value = readStringKey(xml, key);
      if (value !== group) {
        problems.push(
          `  - ${FILES.appInfoPlist} ${key} is ${value ?? '<missing>'}, not ${group}`,
        );
      }
    }
    const legacy = readStringKey(xml, LEGACY_KEY);
    if (legacy !== legacyGroup) {
      problems.push(
        legacyGroup
          ? `  - ${FILES.appInfoPlist} ${LEGACY_KEY} is ${legacy ?? '<missing>'}, not ${legacyGroup}`
          : `  - ${FILES.appInfoPlist} has ${LEGACY_KEY} = ${legacy}, but this archive moves no data`,
      );
    }
  });

  const expectArray = (rel, expected) =>
    safe(rel, () => {
      const groups = readStringArray(read(root, rel), APP_GROUPS_KEY);
      if (!sameList(groups, expected)) {
        problems.push(
          `  - ${rel} allows ${show(groups)}, not ${show(expected)}`,
        );
      }
    });

  expectArray(FILES.appEntitlements, [group, legacyGroup].filter(Boolean));

  if (has(root, FILES.shareEntitlements)) {
    expectArray(FILES.shareEntitlements, [group]);
    safe(FILES.shareInfoPlist, () => {
      const value = readStringKey(
        read(root, FILES.shareInfoPlist),
        'AppGroupIdentifier',
      );
      if (value !== group) {
        problems.push(
          `  - ${FILES.shareInfoPlist} AppGroupIdentifier is ${value ?? '<missing>'}, not ${group}`,
        );
      }
    });
    safe(FILES.shareSwift, () => {
      const value = readShareSwiftGroup(read(root, FILES.shareSwift));
      if (value !== group) {
        problems.push(
          `  - ${FILES.shareSwift} hostAppGroupIdentifier is ${value}, not ${group}`,
        );
      }
    });
  }

  safe(FILES.pbxproj, () => {
    const pbxproj = read(root, FILES.pbxproj);
    if (!hasWidgetTarget(pbxproj)) return;
    expectArray(FILES.widgetEntitlements, [group]);
    safe(FILES.widgetInfoPlist, () => {
      const value = readStringKey(
        read(root, FILES.widgetInfoPlist),
        'BayaanAppGroup',
      );
      if (value !== `$(${WIDGET_GROUP_SETTING})`) {
        problems.push(
          `  - ${FILES.widgetInfoPlist} has no BayaanAppGroup = $(${WIDGET_GROUP_SETTING}) key`,
        );
      }
    });
    const settings = [
      ...new Set(readBuildSetting(pbxproj, WIDGET_GROUP_SETTING)),
    ];
    if (!sameList(settings, [group])) {
      problems.push(
        `  - the widget ${WIDGET_GROUP_SETTING} build setting is ${show(
          settings.length ? settings : null,
        )}, not ${group} (run prebuild)`,
      );
    }
  });

  return problems;
}

/**
 * The targets of the archive and the groups their entitlements ask for:
 * `[{target, bundleId, groups}]`. Reads the (patched) files under `root`.
 */
export function archiveTargets(root) {
  const pbxproj = read(root, FILES.pbxproj);
  const ids = targetBundleIds(pbxproj);
  const one = (target, list) => {
    if (list.length !== 1) {
      throw new Error(
        `the ${target} target has ${list.length} bundle ids (${list.join(', ')})`,
      );
    }
    return list[0];
  };
  const groupsOf = rel =>
    readStringArray(read(root, rel), APP_GROUPS_KEY) ?? [];
  const targets = [
    {
      target: 'app',
      bundleId: one('app', ids.app),
      groups: groupsOf(FILES.appEntitlements),
    },
  ];
  if (has(root, FILES.shareEntitlements) && ids.share.length > 0) {
    targets.push({
      target: 'share extension',
      bundleId: one('share extension', ids.share),
      groups: groupsOf(FILES.shareEntitlements),
    });
  }
  if (hasWidgetTarget(pbxproj)) {
    targets.push({
      target: 'widget',
      bundleId: one('widget', ids.widget),
      groups: groupsOf(FILES.widgetEntitlements),
    });
  }
  return targets;
}

// ─── The developer portal (read-only App Store Connect API) ─────────────────

/**
 * The App Groups in a provisioning profile (`profileContent`, base64 of the
 * signed .mobileprovision). The entitlements are a plain XML plist inside the
 * signed data. Returns [] when the profile has no App Groups entitlement.
 */
export function profileAppGroups(profileContentBase64) {
  if (!profileContentBase64) return [];
  const text = Buffer.from(profileContentBase64, 'base64').toString('latin1');
  return readStringArray(text, APP_GROUPS_KEY) ?? [];
}

/**
 * The portal state of one target, from App Store Connect data:
 *   - bundleIdRecord: the bundleIds row with this exact identifier, or null
 *   - capabilityTypes: the capabilityType of each of its bundleIdCapabilities
 *   - profiles: [{name, state, groups}] (groups from profileAppGroups)
 * Status:
 *   ok             an ACTIVE profile lists every group the target asks for
 *   no-app-id      the App ID is not registered
 *   no-app-groups  the App ID does not have the App Groups capability
 *   missing-groups ACTIVE profiles exist, and none lists every group. A change
 *                  of the App ID makes its old profiles invalid, so an ACTIVE
 *                  profile shows the App ID as it is now.
 *   unconfirmed    no ACTIVE profile: the archive (automatic signing) makes
 *                  one. This is normal just after a portal change.
 */
export function evaluatePortalTarget({
  bundleId,
  groups,
  bundleIdRecord,
  capabilityTypes = [],
  profiles = [],
}) {
  const base = {bundleId, groups, missingGroups: [], evidence: null};
  if (!bundleIdRecord) {
    return {...base, status: 'no-app-id', missingGroups: [...groups]};
  }
  if (groups.length > 0 && !capabilityTypes.includes('APP_GROUPS')) {
    return {...base, status: 'no-app-groups', missingGroups: [...groups]};
  }
  const active = profiles.filter(p => p.state === 'ACTIVE');
  const knownGroups = [...new Set(active.flatMap(p => p.groups))];
  if (active.length === 0) {
    return {...base, status: groups.length ? 'unconfirmed' : 'ok', knownGroups};
  }
  let best = null;
  let bestMissing = groups;
  for (const profile of active) {
    const missing = groups.filter(g => !profile.groups.includes(g));
    if (best === null || missing.length < bestMissing.length) {
      best = profile;
      bestMissing = missing;
    }
  }
  if (bestMissing.length === 0) {
    return {...base, status: 'ok', evidence: best.name, knownGroups};
  }
  return {
    ...base,
    status: 'missing-groups',
    missingGroups: bestMissing,
    evidence: best.name,
    knownGroups,
  };
}

const PORTAL_GROUPS_URL =
  'https://developer.apple.com/account/resources/identifiers/list/applicationGroup';
const PORTAL_IDS_URL =
  'https://developer.apple.com/account/resources/identifiers/list';

/**
 * A portal description for a group (letters, digits and spaces only): the
 * labels after the top-level domain, for example `group.com.qariah.app.beta`
 * gives "Qariah App Beta".
 */
export function groupDescription(group) {
  return group
    .replace(/^group\./, '')
    .split('.')
    .slice(1)
    .map(label => label.replace(/[^A-Za-z0-9]+/g, ' ').trim())
    .filter(Boolean)
    .map(label => label[0].toUpperCase() + label.slice(1))
    .join(' ');
}

/** One status line for each target. */
export function portalLines(results) {
  return results.map(r => {
    const want = r.groups.join(', ') || 'no group';
    switch (r.status) {
      case 'ok':
        return `    OK          ${r.bundleId}: ${want}${
          r.evidence ? ` (profile "${r.evidence}")` : ''
        }`;
      case 'no-app-id':
        return `    MISSING     ${r.bundleId}: the App ID is not registered`;
      case 'no-app-groups':
        return `    MISSING     ${r.bundleId}: the App ID does not have the App Groups capability`;
      case 'missing-groups':
        return `    MISSING     ${r.bundleId}: no active profile allows ${r.missingGroups.join(
          ', ',
        )} (the App ID does not have the group)`;
      default:
        return `    UNCONFIRMED ${r.bundleId}: no active profile yet; the archive makes one (needs ${want})`;
    }
  });
}

/**
 * The owner step for the targets that are MISSING, as lines; [] when nothing
 * is missing. The App Store Connect API cannot register an App Group or
 * assign one to an App ID, so this is an owner step.
 */
export function ownerInstructions(results, {rerun} = {}) {
  const missing = results.filter(r =>
    ['no-app-id', 'no-app-groups', 'missing-groups'].includes(r.status),
  );
  if (missing.length === 0) return [];
  const known = new Set(results.flatMap(r => r.knownGroups ?? []));
  const toRegister = [...new Set(missing.flatMap(r => r.missingGroups))].filter(
    g => !known.has(g),
  );
  const lines = [
    'Owner step in the Apple Developer portal. The App Store Connect API cannot set App Groups, so an agent cannot do it.',
  ];
  let step = 1;
  if (toRegister.length > 0) {
    lines.push(`  ${step}. Open ${PORTAL_GROUPS_URL}`);
    for (const group of toRegister) {
      lines.push(
        `     If ${group} is not in the list: click "+", select "App Groups", click "Continue",`,
        `     type the description "${groupDescription(group)}" and the identifier ${group},`,
        '     click "Continue", then click "Register".',
      );
    }
    step += 1;
  }
  lines.push(`  ${step}. Open ${PORTAL_IDS_URL}`);
  for (const r of missing.filter(m => m.status === 'no-app-id')) {
    lines.push(
      `     Register the App ID ${r.bundleId}: click "+", select "App IDs", then "App". Set the`,
      `     Bundle ID to "Explicit" ${r.bundleId}, tick "App Groups", click "Continue", then "Register".`,
    );
  }
  lines.push(
    '     For each App ID below: click it. Tick "App Groups" if it is off. Click "Configure" (or "Edit")',
    '     next to App Groups. Tick each group on its line, and keep the groups that are ticked.',
    '     Click "Continue", then "Save", then "Confirm".',
  );
  for (const r of missing) {
    lines.push(`       ${r.bundleId}: ${r.groups.join(', ')}`);
  }
  step += 1;
  if (rerun) {
    lines.push(`  ${step}. Run: ${rerun}`);
    lines.push(
      '     Expect OK or UNCONFIRMED. UNCONFIRMED is normal: a portal change makes the old profiles',
      '     invalid, and the archive (automatic signing) makes new ones.',
    );
  }
  return lines;
}

/**
 * Reads the portal state of one target through `get(path)` (an App Store
 * Connect GET). Read only. The identifier filter also matches longer ids, so
 * the row must match the bundle id exactly.
 */
export async function fetchPortalTarget(target, get) {
  const list = await get(
    `/v1/bundleIds?filter[identifier]=${encodeURIComponent(
      target.bundleId,
    )}&include=bundleIdCapabilities&limit=200`,
  );
  const record =
    (list.data || []).find(d => d.attributes?.identifier === target.bundleId) ??
    null;
  if (!record) {
    return evaluatePortalTarget({...target, bundleIdRecord: null});
  }
  const capIds = new Set(
    (record.relationships?.bundleIdCapabilities?.data || []).map(c => c.id),
  );
  const capabilityTypes = (list.included || [])
    .filter(i => i.type === 'bundleIdCapabilities' && capIds.has(i.id))
    .map(i => i.attributes?.capabilityType);
  const profiles = await get(`/v1/bundleIds/${record.id}/profiles?limit=200`);
  return evaluatePortalTarget({
    ...target,
    bundleIdRecord: record,
    capabilityTypes,
    profiles: (profiles.data || []).map(p => ({
      name: p.attributes?.name ?? p.id,
      state: p.attributes?.profileState,
      groups: profileAppGroups(p.attributes?.profileContent),
    })),
  });
}
