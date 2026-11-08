#!/usr/bin/env node
// @ai
//
// scripts/__tests__/upstream-seam.test.mjs — node:test suite for
// scripts/lib/upstream-seam.mjs (the seam record of the weekly upstream sync).
// Run:  node --test scripts/__tests__/upstream-seam.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  buildRecord,
  changedLines,
  expoMajorOf,
  holdReasons,
  inWindow,
  isSeamPath,
  ledgerRowsFor,
  parseRecords,
  planFor,
  proposalCandidate,
  renderReport,
  renderSeed,
  reportRows,
  slugOf,
  statusKind,
} from '../lib/upstream-seam.mjs';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../docs/operations/auto-sprint-policy.json', import.meta.url),
    'utf8',
  ),
);
const SYNC = POLICY.adopt.upstreamSync;
const LEDGER = [
  '| Area | Divergence | Reason | Upstream-able? | Status | Sprint |',
  '|---|---|---|---|---|---|',
  '| `components/RecitersView.tsx` (upstream; Qariah rows already diverge) | the rows | why | ✅ Yes | Local-only | 13 |',
  '| `config/featureFlags.ts` | flags | why | ❌ No | Local-only | 0 |',
  'Prose that names `components/RecitersView.tsx` outside a table.',
].join('\n');

describe('the policy block adopt.upstreamSync', () => {
  it('names the label, the branch pattern, the seam paths and the hold label', () => {
    assert.equal(SYNC.label, 'upstream-sync');
    assert.ok(
      new RegExp(SYNC.branchPattern).test(
        'chore/upstream-sync-2026-11-02-43472de2',
      ),
    );
    assert.ok(SYNC.seamPaths.includes('services/auth/'));
    assert.ok(SYNC.seamPaths.includes('config/'));
    assert.equal(SYNC.holdLabel, 'needs-decision');
    assert.equal(SYNC.adoptAlone, true);
    assert.equal(POLICY.merge.method, 'merge');
    assert.ok(POLICY.runLimits.upstreamSteward.maxWallMinutes > 0);
  });
});

describe('statusKind, changedLines, isSeamPath, expoMajorOf, slugOf', () => {
  it('maps the porcelain letters', () => {
    assert.equal(statusKind('UU'), 'both-modified');
    assert.equal(statusKind('AA'), 'both-added');
    assert.equal(statusKind('UD'), 'ours-modified-theirs-deleted');
    assert.equal(statusKind('DU'), 'ours-deleted-theirs-modified');
    assert.equal(statusKind(''), 'unknown');
  });
  it('counts "12+3-" as 15 lines', () => {
    assert.equal(changedLines('12+3-'), 15);
    assert.equal(changedLines('junk'), 0);
  });
  it('matches a directory prefix and an exact file', () => {
    assert.ok(isSeamPath('services/auth/qfOAuth.ts', SYNC.seamPaths));
    assert.ok(isSeamPath('assets/data/catalog.json', SYNC.seamPaths));
    assert.ok(!isSeamPath('services/authz.ts', SYNC.seamPaths));
    assert.ok(!isSeamPath('components/x.tsx', []));
  });
  it('reads the Expo major', () => {
    assert.equal(expoMajorOf('{"dependencies":{"expo":"^58.0.21"}}'), 58);
    assert.equal(expoMajorOf('not json'), 0);
  });
  it('slugs a path', () => {
    assert.equal(
      slugOf('components/RecitersView.tsx'),
      'components-recitersview',
    );
  });
});

describe('planFor', () => {
  const f = (file, status, ours, theirs, ledgerRows = 0) => ({
    file,
    status,
    ours,
    theirs,
    hunks: 1,
    ledgerRows,
  });
  it('holds a seam file', () => {
    assert.equal(
      planFor(f('config/featureFlags.ts', 'UU', '3+1-', '2+2-', 1), SYNC)
        .resolution,
      'held',
    );
  });
  it('regenerates the lockfiles', () => {
    assert.equal(
      planFor(f('package-lock.json', 'UU', '1+1-', '9+9-')).resolution,
      'regenerate',
    );
    assert.equal(
      planFor(f('ios/Podfile.lock', 'UU', '1+1-', '9+9-')).resolution,
      'regenerate',
    );
  });
  it('keeps the Qariah Xcode project', () => {
    assert.equal(
      planFor(
        f('ios/Qariah.xcodeproj/project.pbxproj', 'UU', '1094+0-', '0+0-'),
      ).resolution,
      'take-ours',
    );
  });
  it('accepts an upstream delete and takes an upstream add', () => {
    assert.equal(
      planFor(
        f('components/player/v2/PlayerSheet.tsx', 'UD', '27+4-', '0+457-', 4),
      ).resolution,
      'accept-delete',
    );
    assert.equal(
      planFor(f('ios/Qariah/SceneDelegate.swift', 'UA', '0+0-', '0+0-'))
        .resolution,
      'take-theirs',
    );
  });
  it('three-ways a file with a ledger row, rechecks a small unrecorded change, flags a large one', () => {
    assert.equal(
      planFor(f('components/RecitersView.tsx', 'UU', '167+38-', '137+60-', 2))
        .resolution,
      'three-way',
    );
    assert.equal(
      planFor(f('store/ambientStore.ts', 'UU', '3+3-', '3+3-')).resolution,
      'take-theirs-recheck',
    );
    assert.equal(
      planFor(
        f('components/sheets/MushafLayoutSheet.tsx', 'UU', '6+6-', '17+142-'),
      ).resolution,
      'three-way-unrecorded',
    );
  });
  it('both-added: three-way with a row, recheck without', () => {
    assert.equal(
      planFor(f('utils/skiaDeferredDispose.ts', 'AA', '145+0-', '83+0-', 3))
        .resolution,
      'three-way',
    );
    assert.equal(
      planFor(f('scripts/__tests__/x.test.js', 'AA', '99+0-', '99+0-'))
        .resolution,
      'take-theirs-recheck',
    );
  });
});

describe('buildRecord and holdReasons', () => {
  const facts = [
    {
      file: 'components/RecitersView.tsx',
      status: 'UU',
      ours: '10+2-',
      theirs: '5+5-',
      hunks: 2,
      ledgerRows: 1,
    },
    {
      file: 'store/ambientStore.ts',
      status: 'UU',
      ours: '3+3-',
      theirs: '3+3-',
      hunks: 2,
      ledgerRows: 0,
    },
  ];
  const meta = {
    date: '2026-11-02',
    upstream: '695d73cf3',
    base: '5a813e238',
    mainHead: '56947078a',
    issue: 739,
    commits: 238,
    filesChanged: 766,
  };
  it('builds a record with a plan per file and no hold for a plain sync', () => {
    const rec = buildRecord(
      {...meta, expoMajor: {ours: 57, theirs: 57}},
      facts,
      SYNC,
    );
    assert.equal(rec.conflicts.length, 2);
    assert.equal(rec.conflicts[0].resolution, 'three-way');
    assert.equal(rec.conflicts[1].resolution, 'take-theirs-recheck');
    assert.deepEqual(rec.held, []);
    assert.equal(rec.mode, 'dry-run');
    assert.equal(rec.issue, 739);
  });
  it('holds on an Expo major change, a seam file, and too many files', () => {
    const rec = buildRecord(
      {...meta, expoMajor: {ours: 57, theirs: 58}},
      facts,
      SYNC,
    );
    assert.equal(rec.held.length, 1);
    assert.match(rec.held[0], /Expo major 57 → 58/);
    const seam = holdReasons({conflicts: [{file: 'services/auth/x.ts'}]}, SYNC);
    assert.match(seam[0], /seam file conflict: services\/auth\/x.ts/);
    const many = holdReasons(
      {conflicts: Array.from({length: 61}, (_, i) => ({file: `f${i}.ts`}))},
      SYNC,
    );
    assert.match(many[0], /61 conflict files is more than the limit of 60/);
  });
  it('keeps a resolution given by the Steward over the plan', () => {
    const rec = buildRecord(
      meta,
      [
        {
          ...facts[1],
          resolution: 'take-theirs',
          note: 'upstream merged our PR #380',
        },
      ],
      SYNC,
    );
    assert.equal(rec.conflicts[0].resolution, 'take-theirs');
    assert.equal(rec.conflicts[0].note, 'upstream merged our PR #380');
  });
});

describe('parseRecords, inWindow, ledgerRowsFor, reportRows, renderReport, renderSeed', () => {
  const lines = [
    JSON.stringify({
      date: '2026-07-01',
      upstream: 'a',
      conflicts: [
        {file: 'components/RecitersView.tsx', resolution: 'three-way'},
      ],
    }),
    JSON.stringify({
      date: '2026-10-20',
      upstream: 'b',
      conflicts: [
        {file: 'components/RecitersView.tsx', resolution: 'three-way'},
        {file: 'store/x.ts', resolution: 'take-theirs'},
      ],
    }),
    JSON.stringify({
      date: '2026-11-02',
      upstream: 'c',
      conflicts: [{file: 'components/RecitersView.tsx', resolution: 'held'}],
    }),
  ].join('\n');
  it('parses and names a bad line', () => {
    assert.equal(parseRecords(lines).length, 3);
    assert.throws(() => parseRecords('{"a":1}\nnot json'), /line 2/);
  });
  it('keeps the window', () => {
    const w = inWindow(parseRecords(lines), '2026-11-06', 90);
    assert.deepEqual(
      w.map(r => r.date),
      ['2026-10-20', '2026-11-02'],
    );
  });
  it('finds the table rows that name a file, not the prose', () => {
    const rows = ledgerRowsFor(LEDGER, 'components/RecitersView.tsx');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].upstreamable, '✅ Yes');
    assert.equal(rows[0].status, 'Local-only');
    assert.equal(ledgerRowsFor(LEDGER, 'nope.ts').length, 0);
  });
  it('ranks the files and renders the report and the seed', () => {
    const rows = reportRows(
      inWindow(parseRecords(lines), '2026-11-06', 90),
      LEDGER,
    );
    assert.equal(rows[0].file, 'components/RecitersView.tsx');
    assert.equal(rows[0].syncs, 2);
    assert.deepEqual(rows[0].resolutions, {'three-way': 1, held: 1});
    assert.equal(rows[1].rows.length, 0);
    assert.equal(proposalCandidate(rows).file, 'components/RecitersView.tsx');
    assert.equal(proposalCandidate([rows[1]]), null);
    const md = renderReport(rows, {days: 90, today: '2026-11-06', syncs: 2});
    assert.match(md, /`components\/RecitersView.tsx` \| 2 \| 0 \|/);
    assert.match(
      md,
      /`store\/x.ts` \| 1 \| 0 \| take-theirs ×1 \| \*\*none\*\*/,
    );
    const seed = renderSeed(rows[0], {today: '2026-11-06', days: 90});
    assert.match(
      seed,
      /^# RFC-NNN: A seam for `components\/RecitersView.tsx` \(seed\)/,
    );
    assert.match(seed, /Seed — a draft in the fork, not posted/);
    assert.match(seed, /## Alternatives considered/);
    assert.match(
      seed,
      /git diff upstream\/develop -- components\/RecitersView.tsx/,
    );
  });
  it('the committed record file parses and the latest line is the 2026-11-02 dry run', () => {
    const recs = parseRecords(
      readFileSync(
        new URL(
          '../../docs/operations/upstream-conflicts.ndjson',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.ok(recs.length >= 1);
    const r = recs[0];
    assert.equal(r.date, '2026-11-02');
    assert.equal(r.issue, 739);
    assert.equal(r.mode, 'dry-run');
    assert.ok(r.conflicts.length > 100);
    assert.ok(r.held.some(h => /Expo major 57 → 58/.test(h)));
    for (const c of r.conflicts)
      assert.ok(c.file && c.resolution && c.kind, JSON.stringify(c));
  });
});
