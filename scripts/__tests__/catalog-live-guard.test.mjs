// @ai-generated
// Tests for scripts/lib/catalog-live-guard.mjs (TECH_DEBT #298): the decision
// of scripts/upload-catalog.mjs. The tests use data only. No test reads or
// writes R2. Run with node --test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  FORCE_FLAG,
  LINEAGE_LOOKBACK,
  canonicalJson,
  decideCatalogOverwrite,
  findBundleVersion,
  reciterList,
} from '../lib/catalog-live-guard.mjs';

const reciter = (id, extra = {}) => ({
  id,
  name: `Reciter ${id}`,
  slug: `reciter-${id}`,
  rewayat: [{id: `${id}-r1`, server: `https://cdn.example/${id}`}],
  ...extra,
});

test('canonicalJson ignores the key order and keeps the array order', () => {
  assert.equal(
    canonicalJson({b: 1, a: {d: 2, c: [{y: 1, x: 2}]}}),
    canonicalJson({a: {c: [{x: 2, y: 1}], d: 2}, b: 1}),
  );
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('reciterList accepts an array or {reciters}, and nothing else', () => {
  const list = [reciter('a')];
  assert.equal(reciterList(list), list);
  assert.equal(reciterList({reciters: list}), list);
  assert.equal(reciterList({}), null);
  assert.equal(reciterList(null), null);
  assert.equal(reciterList('x'), null);
});

test('an invalid bundle is refused, also with the force flag', () => {
  for (const force of [false, true]) {
    const d = decideCatalogOverwrite({bundle: [], live: [reciter('a')], force});
    assert.equal(d.write, false);
    assert.equal(d.outcome, 'bundle-invalid');
  }
  // Also when no live catalog exists.
  const first = decideCatalogOverwrite({bundle: [], live: null});
  assert.equal(first.write, false);
  assert.equal(first.outcome, 'bundle-invalid');
});

test('the first upload (no live catalog) goes ahead', () => {
  const d = decideCatalogOverwrite({bundle: [reciter('a')], live: null});
  assert.equal(d.write, true);
  assert.equal(d.outcome, 'first-upload');
});

test('a live catalog that equals the bundle needs no write', () => {
  const bundle = [reciter('a'), reciter('b')];
  // The same content, other key order, and the {reciters} wrapper.
  const live = {
    reciters: [
      {
        slug: 'reciter-a',
        rewayat: bundle[0].rewayat,
        name: 'Reciter a',
        id: 'a',
      },
      bundle[1],
    ],
  };
  const d = decideCatalogOverwrite({bundle, live, liveVersion: 5});
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'identical');
});

test('a stale bundle is refused and the text names both versions (the 2026-10-18 case)', () => {
  const bundle = [reciter('a')];
  const live = [reciter('a'), reciter('samia', {name: 'Samia Mubarak'})];
  const d = decideCatalogOverwrite({
    bundle,
    live,
    liveVersion: 93,
    lineage: {version: 89, checked: 5},
  });
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'live-newer');
  assert.match(d.reason, /live catalog is v93/);
  assert.match(d.reason, /copy of v89/);
  assert.match(d.reason, /4 newer versions/);
  const text = d.lines.join('\n');
  assert.match(
    text,
    /REMOVE 1 reciter that the live catalog has: Samia Mubarak/,
  );
  assert.match(text, /catalog-r2-mutate\.mjs --transform=<module>/);
  assert.ok(text.includes(FORCE_FLAG));
  assert.match(text, /no audit line/);
});

test('a bundle that equals the live version but not the live catalog is refused', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a')],
    live: [reciter('a', {name: 'Changed'})],
    liveVersion: 7,
    lineage: {version: 7, checked: 1},
  });
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'live-changed');
  assert.match(d.reason, /without a new version/);
});

test('a bundle with no known history version is refused (lineage unknown)', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a', {name: 'Edited locally'})],
    live: [reciter('a')],
    liveVersion: 12,
    lineage: {version: null, checked: 12},
  });
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'lineage-unknown');
  assert.match(d.reason, /matches none of the last 12 versions/);
  assert.match(d.reason, /live catalog is v12/);
});

test('without lineage data the guard still refuses a different bundle', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a'), reciter('b')],
    live: [reciter('a')],
  });
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'lineage-unknown');
  assert.match(d.lines.join('\n'), /add 1 reciter: Reciter b/);
});

test('an unreadable live catalog is refused', () => {
  const d = decideCatalogOverwrite({bundle: [reciter('a')], live: {}});
  assert.equal(d.write, false);
  assert.equal(d.outcome, 'live-unreadable');
});

test('a malformed live row does not throw: the guard refuses, and the force flag still works', () => {
  const cannotCompare =
    'The live catalog has rows that the script cannot compare.';
  const malformed = [
    [null],
    [{id: 'x'}], // no rewayat
    [reciter('a'), {id: 'b', rewayat: null}],
    [reciter('a'), 'not a reciter'],
  ];
  for (const live of malformed) {
    const name = JSON.stringify(live).slice(0, 40);
    // Without the flag: refused, with the same outcome as for a good live row.
    const refused = decideCatalogOverwrite({
      bundle: [reciter('a'), reciter('b')],
      live,
      liveVersion: 6,
    });
    assert.equal(refused.write, false, name);
    assert.equal(refused.outcome, 'lineage-unknown', name);
    assert.ok(refused.lines.includes(cannotCompare), name);
    assert.ok(
      refused.lines.join('\n').includes('--force-overwrite-live'),
      name,
    );

    // With the lineage of a stale copy: still the same outcome as before.
    const stale = decideCatalogOverwrite({
      bundle: [reciter('a'), reciter('b')],
      live,
      liveVersion: 6,
      lineage: {version: 4, checked: 3},
    });
    assert.equal(stale.outcome, 'live-newer', name);
    assert.ok(stale.lines.includes(cannotCompare), name);

    // With the flag: the write goes ahead and the warning stays.
    const forced = decideCatalogOverwrite({
      bundle: [reciter('a'), reciter('b')],
      live,
      force: true,
    });
    assert.equal(forced.write, true, name);
    assert.equal(forced.outcome, 'forced', name);
    assert.ok(forced.lines.includes(cannotCompare), name);
    assert.match(forced.lines.join('\n'), /adds no history version/, name);
  }
});

test('the force flag allows the write and keeps the warning', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a')],
    live: [reciter('a'), reciter('b')],
    liveVersion: 4,
    lineage: {version: 2, checked: 3},
    force: true,
  });
  assert.equal(d.write, true);
  assert.equal(d.outcome, 'forced');
  assert.match(d.reason, /copy of v2/);
  const text = d.lines.join('\n');
  assert.match(text, /REMOVE 1 reciter that the live catalog has: Reciter b/);
  assert.match(text, /adds no history version/);
});

test('the force flag also allows a write over an unreadable live catalog', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a')],
    live: {},
    force: true,
  });
  assert.equal(d.write, true);
  assert.equal(d.outcome, 'forced');
});

test('the details name a changed reciter and count the recitations', () => {
  const d = decideCatalogOverwrite({
    bundle: [reciter('a', {name: 'New name'})],
    live: [reciter('a'), reciter('b')],
    liveVersion: 3,
  });
  const text = d.lines.join('\n');
  assert.match(text, /CHANGE 1 reciter: New name/);
  assert.match(text, /Recitations: 0 added, 1 removed/);
});

test('a long list of names is cut after eight', () => {
  const live = Array.from({length: 12}, (_, i) => reciter(`r${i}`));
  const d = decideCatalogOverwrite({bundle: [reciter('keep')], live});
  assert.match(
    d.lines.join('\n'),
    /12 reciters that the live catalog has: .*, and 4 more\./,
  );
});

// ---------------------------------------------------------------------------
// findBundleVersion

const versions = {
  10: [reciter('a'), reciter('b'), reciter('c')],
  9: [reciter('a'), reciter('b')],
  8: [reciter('a')],
};

function reader(table, log = []) {
  return async version => {
    log.push(version);
    if (version === 7) throw new Error('network');
    return table[version] ?? null;
  };
}

test('findBundleVersion finds the match and stops there', async () => {
  const log = [];
  const found = await findBundleVersion({
    bundle: [reciter('a'), reciter('b')],
    latestVersion: 10,
    readVersion: reader(versions, log),
  });
  assert.deepEqual(found, {version: 9, checked: 2, unreadable: 0});
  assert.deepEqual(log, [10, 9]);
});

test('findBundleVersion compares the content, not the key order', async () => {
  const found = await findBundleVersion({
    bundle: [
      {
        rewayat: versions[8][0].rewayat,
        id: 'a',
        slug: 'reciter-a',
        name: 'Reciter a',
      },
    ],
    latestVersion: 10,
    readVersion: reader(versions),
  });
  assert.equal(found.version, 8);
});

test('findBundleVersion counts a missing version and a read error as unreadable', async () => {
  const found = await findBundleVersion({
    bundle: [reciter('zzz')],
    latestVersion: 10,
    lookback: 5,
    readVersion: reader(versions),
  });
  // Versions 10, 9, 8 are readable. 7 throws. 6 is missing.
  assert.deepEqual(found, {version: null, checked: 3, unreadable: 2});
});

test('findBundleVersion stops at the lookback limit and at version 1', async () => {
  const log = [];
  await findBundleVersion({
    bundle: [reciter('zzz')],
    latestVersion: 100,
    readVersion: reader({}, log),
  });
  assert.equal(log.length, LINEAGE_LOOKBACK);
  assert.equal(log[0], 100);

  const small = [];
  await findBundleVersion({
    bundle: [reciter('zzz')],
    latestVersion: 2,
    readVersion: reader({}, small),
  });
  assert.deepEqual(small, [2, 1]);
});
