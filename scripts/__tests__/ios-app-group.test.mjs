// @ai
//
// Tests for scripts/lib/ios-app-group.mjs (TECH_DEBT #289): the App Group
// rewrite of a --beta archive, the check, and the developer-portal report.
// The file tests run on copies of the committed ios/ files in a temp folder.
//
// Run:  node --test scripts/__tests__/ios-app-group.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {Buffer} from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {IOS_BUNDLE_ID} from '../lib/app-ids.mjs';
import {
  FILES,
  LEGACY_KEY,
  groupDescription,
  applyAppGroup,
  archiveGroups,
  archiveTargets,
  checkAppGroup,
  evaluatePortalTarget,
  fetchPortalTarget,
  ownerInstructions,
  portalLines,
  profileAppGroups,
  readStringArray,
  readStringKey,
} from '../lib/ios-app-group.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROD = IOS_BUNDLE_ID;
const BETA = `${PROD}.beta`;
const PROD_GROUP = `group.${PROD}`;
const BETA_GROUP = `group.${BETA}`;

/** A temp copy of every App Group file of the committed tree. */
function copyTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qariah-app-group-'));
  for (const rel of Object.values(FILES)) {
    mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
    cpSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
}

function snapshot(dir) {
  return Object.fromEntries(
    Object.values(FILES).map(rel => [
      rel,
      readFileSync(path.join(dir, rel), 'utf8'),
    ]),
  );
}

/** A --beta archive also rewrites the bundle ids (ios-archive.sh sed step). */
function patchBetaBundleIds(dir) {
  const file = path.join(dir, FILES.pbxproj);
  const text = readFileSync(file, 'utf8')
    .replaceAll(
      `PRODUCT_BUNDLE_IDENTIFIER = ${PROD};`,
      `PRODUCT_BUNDLE_IDENTIFIER = ${BETA};`,
    )
    .replaceAll(
      `PRODUCT_BUNDLE_IDENTIFIER = "${PROD}.share-extension";`,
      `PRODUCT_BUNDLE_IDENTIFIER = "${BETA}.share-extension";`,
    )
    .replaceAll(
      `PRODUCT_BUNDLE_IDENTIFIER = ${PROD}.widget;`,
      `PRODUCT_BUNDLE_IDENTIFIER = ${BETA}.widget;`,
    );
  writeFileSync(file, text);
}

describe('archiveGroups: the group of each variant', () => {
  it('production and the public beta (production bundle id) keep the production group', () => {
    assert.deepEqual(archiveGroups(PROD, PROD), {
      group: PROD_GROUP,
      legacyGroup: null,
    });
  });

  it('the internal beta gets its own group and moves data from the production group', () => {
    assert.deepEqual(archiveGroups(BETA, PROD), {
      group: BETA_GROUP,
      legacyGroup: PROD_GROUP,
    });
    assert.deepEqual(archiveGroups(BETA, PROD, {moveData: false}), {
      group: BETA_GROUP,
      legacyGroup: null,
    });
  });
});

describe('the committed tree', () => {
  it('uses the production group everywhere and has no legacy key', () => {
    assert.deepEqual(checkAppGroup(ROOT, archiveGroups(PROD, PROD)), []);
    const plist = readFileSync(path.join(ROOT, FILES.appInfoPlist), 'utf8');
    assert.equal(readStringKey(plist, LEGACY_KEY), null);
  });

  it('is not a valid beta tree until the beta rewrite runs', () => {
    assert.ok(checkAppGroup(ROOT, archiveGroups(BETA, PROD)).length > 0);
  });
});

describe('applyAppGroup', () => {
  it('changes nothing for a production or public-beta archive', () => {
    const dir = copyTree();
    try {
      const before = snapshot(dir);
      assert.deepEqual(applyAppGroup(dir, archiveGroups(PROD, PROD)), []);
      assert.deepEqual(snapshot(dir), before);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('gives every target the beta group, and the app the production group second', () => {
    const dir = copyTree();
    try {
      const changed = applyAppGroup(dir, archiveGroups(BETA, PROD));
      assert.deepEqual(
        changed.sort(),
        [
          FILES.appEntitlements,
          FILES.appInfoPlist,
          FILES.pbxproj,
          FILES.shareEntitlements,
          FILES.shareInfoPlist,
          FILES.shareSwift,
          FILES.widgetEntitlements,
        ].sort(),
      );
      const read = rel => readFileSync(path.join(dir, rel), 'utf8');
      const groupsKey = 'com.apple.security.application-groups';
      assert.deepEqual(
        readStringArray(read(FILES.appEntitlements), groupsKey),
        [BETA_GROUP, PROD_GROUP],
      );
      assert.deepEqual(
        readStringArray(read(FILES.shareEntitlements), groupsKey),
        [BETA_GROUP],
      );
      assert.deepEqual(
        readStringArray(read(FILES.widgetEntitlements), groupsKey),
        [BETA_GROUP],
      );
      const plist = read(FILES.appInfoPlist);
      assert.equal(readStringKey(plist, 'AppGroupIdentifier'), BETA_GROUP);
      assert.equal(readStringKey(plist, 'BayaanAppGroup'), BETA_GROUP);
      assert.equal(readStringKey(plist, LEGACY_KEY), PROD_GROUP);
      assert.equal(
        readStringKey(read(FILES.shareInfoPlist), 'AppGroupIdentifier'),
        BETA_GROUP,
      );
      assert.match(
        read(FILES.shareSwift),
        new RegExp(`hostAppGroupIdentifier: String = "${BETA_GROUP}"`),
      );
      const pbxproj = read(FILES.pbxproj);
      assert.equal(pbxproj.match(/BAYAAN_APP_GROUP = /g).length, 2);
      assert.equal(
        pbxproj.match(new RegExp(`BAYAAN_APP_GROUP = ${BETA_GROUP};`, 'g'))
          .length,
        2,
      );
      // The other entitlements of the app stay.
      assert.match(read(FILES.appEntitlements), /aps-environment/);
      assert.deepEqual(checkAppGroup(dir, archiveGroups(BETA, PROD)), []);
      // A second run changes nothing.
      assert.deepEqual(applyAppGroup(dir, archiveGroups(BETA, PROD)), []);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('writes back the exact committed bytes when it runs again with the production group', () => {
    const dir = copyTree();
    try {
      const before = snapshot(dir);
      applyAppGroup(dir, archiveGroups(BETA, PROD));
      applyAppGroup(dir, archiveGroups(PROD, PROD));
      assert.deepEqual(snapshot(dir), before);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('archiveTargets reads the beta ids and the groups each target asks for', () => {
    const dir = copyTree();
    try {
      patchBetaBundleIds(dir);
      applyAppGroup(dir, archiveGroups(BETA, PROD));
      assert.deepEqual(archiveTargets(dir), [
        {target: 'app', bundleId: BETA, groups: [BETA_GROUP, PROD_GROUP]},
        {
          target: 'share extension',
          bundleId: `${BETA}.share-extension`,
          groups: [BETA_GROUP],
        },
        {target: 'widget', bundleId: `${BETA}.widget`, groups: [BETA_GROUP]},
      ]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('checkAppGroup', () => {
  it('names each file that keeps another group', () => {
    const dir = copyTree();
    try {
      applyAppGroup(dir, archiveGroups(BETA, PROD));
      const swift = path.join(dir, FILES.shareSwift);
      writeFileSync(
        swift,
        readFileSync(swift, 'utf8').replace(BETA_GROUP, PROD_GROUP),
      );
      assert.deepEqual(checkAppGroup(dir, archiveGroups(BETA, PROD)), [
        `  - ${FILES.shareSwift} hostAppGroupIdentifier is ${PROD_GROUP}, not ${BETA_GROUP}`,
      ]);
      // A production archive must not keep the beta's legacy key.
      assert.ok(
        checkAppGroup(dir, archiveGroups(PROD, PROD)).some(line =>
          line.includes(`has ${LEGACY_KEY}`),
        ),
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── Developer portal ───────────────────────────────────────────────────────

/** A fake .mobileprovision: some binary bytes around the entitlements plist. */
function profileContent(groups) {
  const array = groups.length
    ? `<array>\n${groups.map(g => `\t\t\t<string>${g}</string>`).join('\n')}\n\t\t</array>`
    : '<array/>';
  const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>Entitlements</key><dict>
\t\t<key>com.apple.security.application-groups</key>
\t\t${array}
\t</dict></dict></plist>`;
  return Buffer.concat([
    Buffer.from([0x30, 0x82, 0x01, 0xff]),
    Buffer.from(xml, 'utf8'),
    Buffer.from([0x00, 0xa0]),
  ]).toString('base64');
}

describe('profileAppGroups', () => {
  it('reads the App Groups of a signed profile', () => {
    assert.deepEqual(profileAppGroups(profileContent([PROD_GROUP])), [
      PROD_GROUP,
    ]);
    assert.deepEqual(profileAppGroups(profileContent([])), []);
    assert.deepEqual(profileAppGroups(undefined), []);
  });
});

describe('evaluatePortalTarget', () => {
  const record = {id: 'X1', attributes: {identifier: BETA}};
  const want = [BETA_GROUP, PROD_GROUP];

  it('is ok when an active profile lists every group', () => {
    const r = evaluatePortalTarget({
      bundleId: BETA,
      groups: want,
      bundleIdRecord: record,
      capabilityTypes: ['APP_GROUPS'],
      profiles: [
        {name: 'old', state: 'INVALID', groups: []},
        {name: 'store', state: 'ACTIVE', groups: [PROD_GROUP, BETA_GROUP]},
      ],
    });
    assert.equal(r.status, 'ok');
    assert.equal(r.evidence, 'store');
  });

  it('names the missing group when the active profile does not list it (today)', () => {
    const r = evaluatePortalTarget({
      bundleId: BETA,
      groups: want,
      bundleIdRecord: record,
      capabilityTypes: ['APP_GROUPS'],
      profiles: [{name: 'store', state: 'ACTIVE', groups: [PROD_GROUP]}],
    });
    assert.equal(r.status, 'missing-groups');
    assert.deepEqual(r.missingGroups, [BETA_GROUP]);
  });

  it('is unconfirmed with no active profile (just after a portal change)', () => {
    const r = evaluatePortalTarget({
      bundleId: BETA,
      groups: want,
      bundleIdRecord: record,
      capabilityTypes: ['APP_GROUPS'],
      profiles: [{name: 'old', state: 'INVALID', groups: [PROD_GROUP]}],
    });
    assert.equal(r.status, 'unconfirmed');
  });

  it('finds a missing App ID and a missing capability', () => {
    assert.equal(
      evaluatePortalTarget({bundleId: BETA, groups: want, bundleIdRecord: null})
        .status,
      'no-app-id',
    );
    assert.equal(
      evaluatePortalTarget({
        bundleId: BETA,
        groups: want,
        bundleIdRecord: record,
        capabilityTypes: ['PUSH_NOTIFICATIONS'],
      }).status,
      'no-app-groups',
    );
  });
});

describe('ownerInstructions', () => {
  it('is empty when nothing is missing', () => {
    assert.deepEqual(
      ownerInstructions([
        {bundleId: BETA, groups: [BETA_GROUP], status: 'ok', missingGroups: []},
        {
          bundleId: BETA,
          groups: [BETA_GROUP],
          status: 'unconfirmed',
          missingGroups: [],
        },
      ]),
      [],
    );
  });

  it('names the group to register and the groups of each App ID', () => {
    const results = [
      {
        bundleId: BETA,
        groups: [BETA_GROUP, PROD_GROUP],
        status: 'missing-groups',
        missingGroups: [BETA_GROUP],
        knownGroups: [PROD_GROUP],
      },
      {
        bundleId: `${BETA}.share-extension`,
        groups: [BETA_GROUP],
        status: 'missing-groups',
        missingGroups: [BETA_GROUP],
        knownGroups: [PROD_GROUP],
      },
    ];
    const text = ownerInstructions(results, {
      rerun: './scripts/ios-archive.sh --dry-run --beta',
    }).join('\n');
    assert.match(text, /identifiers\/list\/applicationGroup/);
    assert.match(
      text,
      new RegExp(`the identifier ${BETA_GROUP.replaceAll('.', '\\.')}`),
    );
    assert.match(text, /the description "[A-Za-z0-9 ]+ Beta"/);
    // The production group exists (a profile lists it): no step to register it.
    assert.doesNotMatch(
      text,
      new RegExp(`If ${PROD_GROUP.replaceAll('.', '\\.')} is not`),
    );
    assert.match(text, new RegExp(`${BETA}: ${BETA_GROUP}, ${PROD_GROUP}`));
    assert.match(text, new RegExp(`${BETA}\\.share-extension: ${BETA_GROUP}`));
    assert.match(text, /Run: \.\/scripts\/ios-archive\.sh --dry-run --beta/);
    assert.equal(portalLines(results).length, 2);
  });

  it('gives a portal description with letters, digits and spaces only', () => {
    assert.equal(
      groupDescription('group.org.fork-app.app.beta'),
      'Fork app App Beta',
    );
    assert.match(groupDescription(BETA_GROUP), /^[A-Za-z0-9 ]+$/);
  });

  it('tells the owner to register a missing App ID', () => {
    const text = ownerInstructions([
      {
        bundleId: `${BETA}.widget`,
        groups: [BETA_GROUP],
        status: 'no-app-id',
        missingGroups: [BETA_GROUP],
      },
    ]).join('\n');
    assert.match(text, new RegExp(`Register the App ID ${BETA}\\.widget`));
  });
});

describe('fetchPortalTarget', () => {
  it('matches the bundle id exactly and reads the profiles (GET only)', async () => {
    const calls = [];
    const get = async url => {
      calls.push(url);
      if (url.startsWith('/v1/bundleIds?')) {
        return {
          data: [
            {
              id: 'W',
              attributes: {identifier: `${BETA}.widget`},
              relationships: {bundleIdCapabilities: {data: [{id: 'c2'}]}},
            },
            {
              id: 'B',
              attributes: {identifier: BETA},
              relationships: {bundleIdCapabilities: {data: [{id: 'c1'}]}},
            },
          ],
          included: [
            {
              type: 'bundleIdCapabilities',
              id: 'c1',
              attributes: {capabilityType: 'APP_GROUPS'},
            },
          ],
        };
      }
      assert.equal(url, '/v1/bundleIds/B/profiles?limit=200');
      return {
        data: [
          {
            id: 'p1',
            attributes: {
              name: 'iOS Team Store Provisioning Profile',
              profileState: 'ACTIVE',
              profileContent: profileContent([PROD_GROUP]),
            },
          },
        ],
      };
    };
    const r = await fetchPortalTarget(
      {bundleId: BETA, groups: [BETA_GROUP, PROD_GROUP]},
      get,
    );
    assert.equal(r.status, 'missing-groups');
    assert.deepEqual(r.missingGroups, [BETA_GROUP]);
    assert.equal(calls.length, 2);
  });
});
