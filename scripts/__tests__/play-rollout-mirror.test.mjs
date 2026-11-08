#!/usr/bin/env node
// @ai
//
// scripts/__tests__/play-rollout-mirror.test.mjs
// ----------------------------------------------
// The rules of scripts/play-rollout-mirror.mjs: the Android production release
// follows the iOS phased release, only up, and never touches a halted, draft or
// completed release.
//
// Run:  node --test scripts/__tests__/play-rollout-mirror.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  findRelease,
  iosTarget,
  planAndroid,
  promoteTrack,
  supersededBy,
  trackForPlan,
} from '../lib/play-rollout-mirror.mjs';

describe('supersededBy', () => {
  const v = (versionString, appStoreState, appVersionState) => ({
    versionString,
    appStoreState,
    appVersionState,
  });
  it('names a newer live version (the 2026-11-08 case)', () => {
    const list = [
      v('3.2.4', 'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'),
      v('3.2.3', 'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'),
      v('3.2.1', 'REPLACED_WITH_NEW_VERSION', 'REPLACED_WITH_NEW_BUILD'),
    ];
    assert.equal(supersededBy(list, '3.2.3'), '3.2.4');
  });
  it('compares versions as numbers', () => {
    const list = [v('3.2.10', 'READY_FOR_SALE'), v('3.2.9', 'READY_FOR_SALE')];
    assert.equal(supersededBy(list, '3.2.9'), '3.2.10');
    assert.equal(supersededBy(list, '3.2.10'), null);
  });
  it('ignores a newer version that is not live yet', () => {
    for (const s of [
      'PREPARE_FOR_SUBMISSION',
      'WAITING_FOR_REVIEW',
      'IN_REVIEW',
      'DEVELOPER_REJECTED',
    ]) {
      const list = [v('3.2.5', s), v('3.2.4', 'READY_FOR_SALE')];
      assert.equal(supersededBy(list, '3.2.4'), null, s);
    }
  });
  it('counts a newer version that Apple is about to release', () => {
    const list = [
      v('3.2.5', undefined, 'PROCESSING_FOR_DISTRIBUTION'),
      v('3.2.4', 'READY_FOR_SALE'),
    ];
    assert.equal(supersededBy(list, '3.2.4'), '3.2.5');
  });
  it('holds on a tracked version that Apple marks replaced', () => {
    const list = [v('3.2.3', 'REPLACED_WITH_NEW_VERSION')];
    assert.equal(supersededBy(list, '3.2.3'), 'a newer version');
  });
  it('returns null for an empty or missing list', () => {
    assert.equal(supersededBy([], '3.2.3'), null);
    assert.equal(supersededBy(undefined, '3.2.3'), null);
  });
});

const staged = f => ({
  name: '3763',
  versionCodes: ['3763'],
  status: 'inProgress',
  userFraction: f,
});
const old = {name: '2027', versionCodes: ['2027'], status: 'completed'};

describe('iosTarget', () => {
  it('maps each ACTIVE day to the Apple rung', () => {
    const got = [1, 2, 3, 4, 5, 6, 7].map(
      d =>
        iosTarget({phasedReleaseState: 'ACTIVE', currentDayNumber: d}).fraction,
    );
    assert.deepEqual(got, [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]);
    assert.equal(
      iosTarget({phasedReleaseState: 'ACTIVE', currentDayNumber: 7}).complete,
      true,
    );
    assert.equal(
      iosTarget({phasedReleaseState: 'ACTIVE', currentDayNumber: 9}).fraction,
      1,
    );
  });
  it('completes on COMPLETE, whatever the frozen day counter says', () => {
    assert.deepEqual(
      [
        iosTarget({phasedReleaseState: 'COMPLETE', currentDayNumber: 4})
          .fraction,
        iosTarget({phasedReleaseState: 'COMPLETE', currentDayNumber: 4})
          .complete,
      ],
      [1, true],
    );
  });
  it('holds when a newer iOS version supersedes the tracked one (2026-11-08)', () => {
    // Apple ended the PAUSED 3.2.3 ramp at day 6 when 3.2.4 went live, and
    // the state read COMPLETE. The mirror then completed Android vc3763.
    const t = iosTarget(
      {phasedReleaseState: 'COMPLETE', currentDayNumber: 6},
      {supersededBy: '3.2.4'},
    );
    assert.equal(t.fraction, null);
    assert.equal(t.complete, false);
    assert.match(t.reason, /superseded by 3\.2\.4/);
  });
  it('holds on PAUSED, INACTIVE, no record, no day and an unknown state', () => {
    for (const p of [
      {phasedReleaseState: 'PAUSED', currentDayNumber: 5},
      {phasedReleaseState: 'INACTIVE'},
      null,
      {phasedReleaseState: 'ACTIVE'},
      {phasedReleaseState: 'SOMETHING_NEW', currentDayNumber: 3},
    ]) {
      assert.equal(iosTarget(p).fraction, null, JSON.stringify(p));
    }
  });
});

describe('planAndroid', () => {
  const day = d =>
    iosTarget({phasedReleaseState: 'ACTIVE', currentDayNumber: d});
  it('raises the fraction to the iOS rung', () => {
    assert.deepEqual(
      [
        planAndroid(day(3), staged(0.01)).action,
        planAndroid(day(3), staged(0.01)).fraction,
      ],
      ['set', 0.05],
    );
  });
  it('never lowers the fraction', () => {
    assert.equal(planAndroid(day(2), staged(0.1)).action, 'none');
    assert.equal(planAndroid(day(1), staged(0.01)).action, 'none');
  });
  it('completes when iOS is at 100%', () => {
    assert.equal(planAndroid(day(7), staged(0.5)).action, 'complete');
    assert.equal(
      planAndroid(
        iosTarget({phasedReleaseState: 'COMPLETE', currentDayNumber: 2}),
        staged(0.02),
      ).action,
      'complete',
    );
  });
  it('holds while iOS holds', () => {
    assert.equal(
      planAndroid(
        iosTarget({phasedReleaseState: 'PAUSED', currentDayNumber: 5}),
        staged(0.1),
      ).action,
      'none',
    );
    assert.equal(
      planAndroid(iosTarget({phasedReleaseState: 'INACTIVE'}), staged(0.01))
        .action,
      'none',
    );
  });
  it('does not touch a halted or draft release, or a missing one', () => {
    for (const rel of [
      {...staged(0.05), status: 'halted'},
      {...staged(0.05), status: 'draft'},
      null,
    ]) {
      assert.equal(planAndroid(day(6), rel).action, 'none');
    }
  });
  it('reports done for a completed release', () => {
    assert.equal(
      planAndroid(day(3), {...old, versionCodes: ['3763']}).action,
      'done',
    );
  });
});

describe('trackForPlan', () => {
  const track = {track: 'production', releases: [staged(0.01), old]};
  it('set changes only the fraction and keeps the completed release', () => {
    const body = trackForPlan(track, 3763, {action: 'set', fraction: 0.05});
    assert.deepEqual(body.releases, [staged(0.05), old]);
  });
  it('complete leaves only the new release, completed, with no fraction', () => {
    const body = trackForPlan(track, 3763, {action: 'complete', fraction: 1});
    assert.deepEqual(body.releases, [
      {name: '3763', versionCodes: ['3763'], status: 'completed'},
    ]);
  });
});

describe('promoteTrack', () => {
  const beta = {
    track: 'beta',
    releases: [
      {
        name: '3.2.3 (3763)',
        versionCodes: ['3763'],
        status: 'completed',
        releaseNotes: [{language: 'en-US', text: 'beta notes'}],
      },
    ],
  };
  const production = {track: 'production', releases: [old]};
  it('adds a staged release and keeps the completed one', () => {
    const body = promoteTrack({
      production,
      source: beta,
      versionCode: 3763,
      fraction: 0.01,
      notes: 'store text',
    });
    assert.deepEqual(body, {
      track: 'production',
      releases: [
        {
          name: '3.2.3 (3763)',
          versionCodes: ['3763'],
          status: 'inProgress',
          userFraction: 0.01,
          releaseNotes: [{language: 'en-US', text: 'store text'}],
        },
        old,
      ],
    });
  });
  it('keeps the source release notes when no notes are given', () => {
    const body = promoteTrack({
      production,
      source: beta,
      versionCode: 3763,
      fraction: 0.01,
    });
    assert.deepEqual(
      body.releases[0].releaseNotes,
      beta.releases[0].releaseNotes,
    );
  });
  it('refuses a live staged rollout, a missing or repeated version, and a bad fraction', () => {
    assert.throws(
      () =>
        promoteTrack({
          production: {releases: [{...staged(0.2), versionCodes: ['3700']}]},
          source: beta,
          versionCode: 3763,
          fraction: 0.01,
        }),
      /staged rollout is live/,
    );
    assert.throws(
      () =>
        promoteTrack({
          production,
          source: beta,
          versionCode: 9999,
          fraction: 0.01,
        }),
      /not on the beta track/,
    );
    assert.throws(
      () =>
        promoteTrack({
          production: {releases: [{...old, versionCodes: ['3763']}]},
          source: beta,
          versionCode: 3763,
          fraction: 0.01,
        }),
      /already on the production track/,
    );
    for (const f of [0, 1, 1.5, Number.NaN]) {
      assert.throws(
        () =>
          promoteTrack({
            production,
            source: beta,
            versionCode: 3763,
            fraction: f,
          }),
        /strictly between 0 and 1/,
      );
    }
  });
});

describe('findRelease', () => {
  it('matches the version code as a string or a number', () => {
    assert.equal(findRelease({releases: [old]}, 2027), old);
    assert.equal(findRelease({releases: [old]}, '2027'), old);
    assert.equal(findRelease({}, 2027), null);
  });
});

describe('trackForPlan halt (the rollback path)', () => {
  const track = {
    track: 'production',
    releases: [
      {versionCodes: ['2027'], status: 'completed'},
      {versionCodes: ['3763'], status: 'inProgress', userFraction: 0.05},
    ],
  };
  it('marks the staged release halted and keeps the completed one', () => {
    const out = trackForPlan(track, 3763, {action: 'halt'});
    assert.deepEqual(out.releases, [
      {versionCodes: ['2027'], status: 'completed'},
      {versionCodes: ['3763'], status: 'halted', userFraction: 0.05},
    ]);
  });
  it('refuses a completed, halted or missing release', () => {
    assert.throws(
      () => trackForPlan(track, 2027, {action: 'halt'}),
      /completed/,
    );
    assert.throws(
      () => trackForPlan(track, 9999, {action: 'halt'}),
      /not on the production track/,
    );
    const halted = {
      ...track,
      releases: [{versionCodes: ['3763'], status: 'halted'}],
    };
    assert.throws(() => trackForPlan(halted, 3763, {action: 'halt'}), /halted/);
  });
});
