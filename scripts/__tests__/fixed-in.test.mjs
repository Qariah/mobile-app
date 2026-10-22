#!/usr/bin/env node
// @ai
//
// scripts/__tests__/fixed-in.test.mjs
// -----------------------------------
// node:test suite for scripts/lib/fixed-in.mjs — the pure rules behind
// scripts/stamp-fixed-in.mjs and the flag gate in scripts/prod-close.mjs.
// Run:  node --test scripts/__tests__/fixed-in.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  behindFlagsOf,
  fixedInOf,
  incidentMembers,
  isFlagFullyOn,
  parseRefs,
  planFixedIn,
  stampComment,
  stampMarker,
} from '../lib/fixed-in.mjs';

describe('parseRefs', () => {
  it('reads Refs / Fixes / Closes in any case', () => {
    assert.deepEqual(
      parseRefs('Refs #12\nfixes #3\nCLOSES #40\nresolved #7'),
      [3, 7, 12, 40],
    );
  });
  it('reads a list after one keyword', () => {
    assert.deepEqual(parseRefs('Refs #5, #6 and #7'), [5, 6, 7]);
  });
  it('accepts a colon after the keyword', () => {
    assert.deepEqual(parseRefs('Refs: #187'), [187]);
  });
  it('ignores a bare #n with no keyword', () => {
    assert.deepEqual(parseRefs('See PR #452 and TECH_DEBT #221.'), []);
  });
  it('does not read a number on the next line', () => {
    assert.deepEqual(parseRefs('Refs #1\n#2 is a different thing'), [1]);
  });
  it('removes duplicates', () => {
    assert.deepEqual(parseRefs('Refs #9\nFixes #9'), [9]);
  });
  it('handles empty input', () => {
    assert.deepEqual(parseRefs(''), []);
    assert.deepEqual(parseRefs(undefined), []);
  });
});

describe('planFixedIn — the lower build wins', () => {
  it('adds the label when there is none', () => {
    assert.deepEqual(planFixedIn(['anr'], 1975), {
      action: 'add',
      add: 'fixed-in:1975',
      remove: [],
      kept: null,
    });
  });
  it('replaces a HIGHER build', () => {
    const p = planFixedIn(['fixed-in:2013'], 1975);
    assert.equal(p.action, 'add');
    assert.equal(p.add, 'fixed-in:1975');
    assert.deepEqual(p.remove, ['fixed-in:2013']);
  });
  it('keeps a LOWER build', () => {
    const p = planFixedIn(['fixed-in:1922'], 1975);
    assert.equal(p.action, 'keep');
    assert.equal(p.kept, 1922);
    assert.deepEqual(p.remove, []);
  });
  it('keeps the same build (a re-run)', () => {
    const p = planFixedIn(['fixed-in:1975'], 1975);
    assert.equal(p.action, 'keep');
    assert.equal(p.kept, 1975);
  });
  it('keeps the lowest and removes the others when several exist', () => {
    const p = planFixedIn(['fixed-in:2025', 'fixed-in:1930'], 1975);
    assert.equal(p.kept, 1930);
    assert.deepEqual(p.remove, ['fixed-in:2025']);
  });
  it('ignores a malformed label', () => {
    assert.equal(planFixedIn(['fixed-in:next'], 1975).action, 'add');
  });
});

describe('fixedInOf / behindFlagsOf', () => {
  it('returns the lowest build', () => {
    assert.equal(fixedInOf(['fixed-in:2013', 'fixed-in:1975']), 1975);
    assert.equal(fixedInOf(['bug']), null);
  });
  it('returns the flag keys', () => {
    assert.deepEqual(behindFlagsOf(['behind-flag:nonblocking_splash', 'anr']), [
      'nonblocking_splash',
    ]);
    assert.deepEqual(behindFlagsOf(undefined), []);
  });
});

describe('incidentMembers — the member filter', () => {
  const g = (number, labels, title = 'x', body = '', extra = {}) => ({
    number,
    labels,
    title,
    body,
    state: 'open',
    ...extra,
  });
  const all = [
    g(
      187,
      ['incident', 'incident:cold-start-hang'],
      '[incident] cold-start-hang',
    ),
    g(
      275,
      ['anr', 'incident:cold-start-hang'],
      '[Play ANR] a @ Input dispatching timed out (No focused window)',
    ),
    // The headline says only "Input dispatching timed out". Its body names
    // "No focused window" in template text, which must NOT count.
    g(
      320,
      ['anr', 'incident:cold-start-hang'],
      '[Play ANR] b @ Input dispatching timed out',
      '@ `Input dispatching timed out`\nCorrelation: idle / "No focused window" — Bug B',
    ),
    g(286, ['anr', 'incident:cold-start-hang'], '[Play ANR] c @ slow IO'),
    g(900, ['anr', 'incident:memory-oom'], 'other incident'),
    g(901, ['incident:cold-start-hang'], 'closed one', '', {state: 'closed'}),
    g(902, ['incident:cold-start-hang'], 'a PR', '', {isPr: true}),
  ];
  const nums = xs => xs.map(x => x.number);
  it('returns open members, not the group issue, not PRs, not other incidents', () => {
    assert.deepEqual(
      nums(incidentMembers(all, 'cold-start-hang')),
      [275, 320, 286],
    );
  });
  it('filters on title + body with the regex', () => {
    const re = /Input dispatching timed out \(No focused window\)/;
    assert.deepEqual(nums(incidentMembers(all, 'cold-start-hang', re)), [275]);
  });
});

describe('isFlagFullyOn', () => {
  const flag = (groups, extra = {}) => ({
    key: 'nonblocking_splash',
    active: true,
    filters: {groups},
    ...extra,
  });
  it('true for an active flag at 100% with no filter', () => {
    assert.equal(
      isFlagFullyOn(flag([{rollout_percentage: 100, properties: []}])),
      true,
    );
  });
  it('true when PostHog stores 100% as null', () => {
    assert.equal(
      isFlagFullyOn(flag([{rollout_percentage: null, properties: []}])),
      true,
    );
  });
  it('false below 100%', () => {
    assert.equal(
      isFlagFullyOn(flag([{rollout_percentage: 50, properties: []}])),
      false,
    );
  });
  it('false at 100% for a filtered group only', () => {
    assert.equal(
      isFlagFullyOn(
        flag([
          {
            rollout_percentage: 100,
            properties: [{key: '$app_build', value: '1975'}],
          },
          {rollout_percentage: 0, properties: []},
        ]),
      ),
      false,
    );
  });
  it('true when any one group is 100% with no filter', () => {
    assert.equal(
      isFlagFullyOn(
        flag([
          {rollout_percentage: 100, properties: [{key: 'x'}]},
          {rollout_percentage: 100, properties: []},
        ]),
      ),
      true,
    );
  });
  it('false when the flag is inactive, deleted, or missing', () => {
    const g = [{rollout_percentage: 100, properties: []}];
    assert.equal(isFlagFullyOn(flag(g, {active: false})), false);
    assert.equal(isFlagFullyOn(flag(g, {deleted: true})), false);
    assert.equal(isFlagFullyOn(null), false);
    assert.equal(isFlagFullyOn(flag([])), false);
    assert.equal(isFlagFullyOn(flag(g, {active: false}), 1975), false);
    assert.equal(isFlagFullyOn(null, 1975), false);
  });

  describe('for a production build ($app_build filter)', () => {
    // The live `nonblocking_splash` flag on 2026-09-27.
    const live = flag([
      {
        rollout_percentage: 100,
        properties: [
          {
            key: '$app_build',
            type: 'person',
            operator: 'exact',
            value: ['1975', '1981', '1982', '2019', '2026'],
          },
        ],
      },
    ]);
    it('true when the build is in the exact list', () => {
      assert.equal(isFlagFullyOn(live, 1975), true);
      assert.equal(isFlagFullyOn(live, '2026'), true);
    });
    it('false when the build is not in the list', () => {
      assert.equal(isFlagFullyOn(live, 1717), false);
      assert.equal(isFlagFullyOn(live, 2027), false);
    });
    it('false without a build (the old, stricter rule)', () => {
      assert.equal(isFlagFullyOn(live), false);
    });
    it('reads a single exact string and the in operator', () => {
      const one = flag([
        {
          rollout_percentage: 100,
          properties: [{key: '$app_build', value: '1975'}],
        },
      ]);
      assert.equal(isFlagFullyOn(one, 1975), true);
      assert.equal(isFlagFullyOn(one, 1976), false);
      const inList = flag([
        {
          rollout_percentage: 100,
          properties: [
            {key: '$app_build', operator: 'in', value: [1975, 1976]},
          ],
        },
      ]);
      assert.equal(isFlagFullyOn(inList, 1976), true);
    });
    it('compares gte / gt / lte / lt as numbers', () => {
      const f = op =>
        flag([
          {
            rollout_percentage: 100,
            properties: [{key: '$app_build', operator: op, value: '1975'}],
          },
        ]);
      assert.equal(isFlagFullyOn(f('gte'), 1975), true);
      assert.equal(isFlagFullyOn(f('gte'), 1974), false);
      assert.equal(isFlagFullyOn(f('gt'), 1975), false);
      assert.equal(isFlagFullyOn(f('gt'), 2000), true);
      assert.equal(isFlagFullyOn(f('lte'), 1975), true);
      assert.equal(isFlagFullyOn(f('lt'), 1975), false);
    });
    it('false for an operator it does not understand', () => {
      const re = flag([
        {
          rollout_percentage: 100,
          properties: [{key: '$app_build', operator: 'regex', value: '^19'}],
        },
      ]);
      assert.equal(isFlagFullyOn(re, 1975), false);
    });
    it('false when the group also filters on another property', () => {
      // The live `nonblocking_splash_draft_android_le12` shape.
      const mixed = flag([
        {
          rollout_percentage: 100,
          properties: [
            {key: '$app_build', operator: 'exact', value: ['2026']},
            {key: '$os_name', operator: 'exact', value: ['Android']},
          ],
        },
      ]);
      assert.equal(isFlagFullyOn(mixed, 2026), false);
    });
    it('false below 100% even when the build matches', () => {
      const half = flag([
        {
          rollout_percentage: 50,
          properties: [{key: '$app_build', operator: 'exact', value: ['1975']}],
        },
      ]);
      assert.equal(isFlagFullyOn(half, 1975), false);
    });
    it('all $app_build filters in a group must match', () => {
      const range = flag([
        {
          rollout_percentage: 100,
          properties: [
            {key: '$app_build', operator: 'gte', value: '1970'},
            {key: '$app_build', operator: 'lt', value: '2000'},
          ],
        },
      ]);
      assert.equal(isFlagFullyOn(range, 1975), true);
      assert.equal(isFlagFullyOn(range, 2019), false);
    });
  });
});

describe('stampComment', () => {
  it('carries the marker, the PR and the flag', () => {
    const c = stampComment({
      build: 1975,
      prs: [451],
      flag: 'nonblocking_splash',
    });
    assert.ok(c.startsWith(stampMarker(1975)));
    assert.match(c, /Build 1975 contains a fix for this \(PR #451\)\./);
    assert.match(c, /off until the `nonblocking_splash` flag is on/);
  });
  it('has no flag sentence without a flag', () => {
    const c = stampComment({build: 2013, prs: [], flag: null});
    assert.doesNotMatch(c, /flag/);
    assert.match(c, /closes by itself when the build reaches production\./);
  });
});
