// @ai Tests for scripts/lib/play-release-state.mjs (node --test).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  needsOwner,
  NOT_LIVE_STATES,
  releaseStates,
} from '../lib/play-release-state.mjs';

// The production track on 2026-11-11: the track edit said `3763 completed`.
const NOV_11 = {
  releases: [
    {
      releaseName: '3763',
      activeArtifacts: [{versionCode: 3763}],
      releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED',
      track: 'production',
    },
    {
      releaseName: '3.2.1 (2027)',
      activeArtifacts: [{versionCode: 2027}],
      releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
      track: 'production',
    },
  ],
};

test('an approved release that nobody published is not live and needs the owner', () => {
  const rows = releaseStates(NOV_11);
  assert.deepEqual(
    rows.map(r => [r.name, r.versionCodes, r.state, r.live]),
    [
      ['3763', ['3763'], 'APPROVED_NOT_PUBLISHED', false],
      ['3.2.1 (2027)', ['2027'], 'PUBLISHED', true],
    ],
  );
  assert.match(rows[0].ownerAction, /Publish changes/);
  assert.equal(rows[1].ownerAction, null);
  assert.equal(needsOwner(rows), true);
});

test('a release in review is not live, and it does not need the owner', () => {
  const rows = releaseStates({
    releases: [
      {
        releaseName: '4487',
        activeArtifacts: [{versionCode: 4487}],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ],
  });
  assert.equal(rows[0].state, 'IN_REVIEW');
  assert.equal(rows[0].live, false);
  assert.equal(needsOwner(rows), false);
  assert.ok(NOT_LIVE_STATES.includes('IN_REVIEW'));
});

test('a rejected release needs the owner', () => {
  const rows = releaseStates({
    releases: [{releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_NOT_APPROVED'}],
  });
  assert.equal(rows[0].state, 'NOT_APPROVED');
  assert.match(rows[0].ownerAction, /rejected/);
});

test('a missing state, a missing list and a bad body do not throw', () => {
  assert.deepEqual(releaseStates({}), []);
  assert.deepEqual(releaseStates(null), []);
  const rows = releaseStates({releases: [{releaseName: 'x'}]});
  assert.equal(rows[0].state, 'UNKNOWN');
  assert.equal(rows[0].live, false);
  assert.equal(needsOwner(rows), false);
});
