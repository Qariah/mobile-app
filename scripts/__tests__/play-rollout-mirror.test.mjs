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
  trackForPlan,
} from '../lib/play-rollout-mirror.mjs';

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
