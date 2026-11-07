// @ai
// Unit tests for scripts/lib/run-health.mjs (the run-health watchdog rules).
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  alertMarker,
  dueDate,
  evaluateRunHealth,
  ownerDate,
  parseCardDate,
  parseRunHealthLine,
  zonedToUtc,
} from '../lib/run-health.mjs';

const WALL = {triage: 90, drafts: 180, autoSprint: 360};
// 2026-09-28 23:30 UTC = 16:30 PDT on 2026-09-28.
const NOW = Date.parse('2026-09-28T23:30:00Z');

const line = (task, date, status = 'DONE', at = '2026-09-28T21:00:00Z') => ({
  body: `run-health task=${task} date=${date} status=${status} build=none toolCalls=40 minutes=30`,
  createdAt: at,
});
const card = (date, at = '2026-09-28T20:30:00Z') => ({
  body: `<!-- daily-card date=${date} sections=triage host=cloud -->\n**Daily card**`,
  createdAt: at,
});
const bad = r => r.checks.filter(c => !c.ok).map(c => c.key);

describe('parsers', () => {
  it('reads a run-health line', () => {
    assert.deepEqual(
      parseRunHealthLine(
        'run-health task=drafts date=2026-09-28 status=FAILED build=none toolCalls=9 minutes=3',
      ),
      {
        task: 'drafts',
        date: '2026-09-28',
        status: 'FAILED',
        build: 'none',
        toolCalls: '9',
        minutes: '3',
      },
    );
    assert.equal(parseRunHealthLine('hello'), null);
  });
  it('reads the card marker', () => {
    assert.equal(parseCardDate(card('2026-09-28').body), '2026-09-28');
    assert.equal(parseCardDate('no marker'), null);
  });
});

describe('time', () => {
  it('converts Pacific wall time to UTC in summer and winter', () => {
    assert.equal(
      new Date(zonedToUtc('2026-09-28', '13:07')).toISOString(),
      '2026-09-28T20:07:00.000Z',
    );
    assert.equal(
      new Date(zonedToUtc('2026-12-01', '13:07')).toISOString(),
      '2026-12-01T21:07:00.000Z',
    );
  });
  it('uses the owner date, not the UTC date', () => {
    assert.equal(ownerDate(Date.parse('2026-09-29T02:00:00Z')), '2026-09-28');
  });
  it('checks the 3pm auto-sprint for the day before (it can run past midnight UTC)', () => {
    assert.equal(dueDate('autoSprint', NOW, 360), '2026-09-27');
    assert.equal(dueDate('triage', NOW, 90), '2026-09-28');
    assert.equal(dueDate('drafts', NOW, 180), '2026-09-28');
  });
  it('checks the 1pm drafts run for the day before in winter, when it may still run', () => {
    // 23:30 UTC = 15:30 PST; 13:00 + 180 + 30 min = 16:30 PST.
    assert.equal(
      dueDate('drafts', Date.parse('2026-12-01T23:30:00Z'), 180),
      '2026-11-30',
    );
  });
});

describe('evaluateRunHealth', () => {
  const allGood = {
    now: NOW,
    maxWallMinutes: WALL,
    mainComments: [
      line('drafts', '2026-09-28'),
      line('autoSprint', '2026-09-27', 'DONE', '2026-09-28T04:00:00Z'),
    ],
    shadowComments: [card('2026-09-28'), line('triage', '2026-09-28')],
    triageRunsInCloud: false,
  };

  it('all good in shadow mode', () => {
    assert.deepEqual(bad(evaluateRunHealth(allGood)), []);
  });

  it('SKIPPED is good; FAILED and STOPPED-LIMIT are not', () => {
    const r = evaluateRunHealth({
      ...allGood,
      mainComments: [
        line('drafts', '2026-09-28', 'SKIPPED'),
        line('autoSprint', '2026-09-27', 'STOPPED-LIMIT'),
      ],
      shadowComments: [
        card('2026-09-28'),
        line('triage', '2026-09-28', 'FAILED'),
      ],
    });
    assert.deepEqual(bad(r), ['triage:2026-09-28', 'autoSprint:2026-09-27']);
  });

  it('a missing line is a fault', () => {
    const r = evaluateRunHealth({...allGood, mainComments: []});
    assert.deepEqual(bad(r), ['drafts:2026-09-28', 'autoSprint:2026-09-27']);
  });

  it('a late card and a missing card are faults', () => {
    const late = evaluateRunHealth({
      ...allGood,
      shadowComments: [
        card('2026-09-28', '2026-09-28T22:40:00Z'),
        line('triage', '2026-09-28'),
      ],
    });
    assert.deepEqual(bad(late), ['card:2026-09-28']);
    assert.match(late.checks.find(c => !c.ok).text, /late, at 22:40 UTC/);
    const none = evaluateRunHealth({
      ...allGood,
      shadowComments: [line('triage', '2026-09-28')],
    });
    assert.deepEqual(bad(none), ['card:2026-09-28']);
  });

  it('a card for another date does not count', () => {
    const r = evaluateRunHealth({
      ...allGood,
      shadowComments: [card('2026-09-27'), line('triage', '2026-09-28')],
    });
    assert.deepEqual(bad(r), ['card:2026-09-28']);
  });

  it('in shadow mode, triage lines on the main card do not count', () => {
    const r = evaluateRunHealth({
      ...allGood,
      mainComments: [
        ...allGood.mainComments,
        card('2026-09-28'),
        line('triage', '2026-09-28'),
      ],
      shadowComments: [],
    });
    assert.deepEqual(bad(r), ['card:2026-09-28', 'triage:2026-09-28']);
  });

  it('no shadow issue yet = the routine has not started: triage is not a fault', () => {
    const r = evaluateRunHealth({...allGood, shadowComments: null});
    assert.deepEqual(bad(r), []);
    assert.ok(r.checks.some(c => /not started yet/.test(c.text)));
  });

  it('after cutover, triage is read from the main card', () => {
    const r = evaluateRunHealth({
      ...allGood,
      triageRunsInCloud: true,
      mainComments: [
        ...allGood.mainComments,
        card('2026-09-28'),
        line('triage', '2026-09-28'),
      ],
      shadowComments: null,
    });
    assert.deepEqual(bad(r), []);
  });

  it('before 22:00 UTC the card is not checked yet', () => {
    const r = evaluateRunHealth({
      ...allGood,
      now: Date.parse('2026-09-28T21:00:00Z'),
      shadowComments: [],
    });
    assert.ok(!r.checks.some(c => c.task === 'card'));
  });

  it('the last line for a task and date wins (a re-run that ended well)', () => {
    const r = evaluateRunHealth({
      ...allGood,
      mainComments: [
        line('drafts', '2026-09-28', 'FAILED', '2026-09-28T20:00:00Z'),
        line('drafts', '2026-09-28', 'DONE', '2026-09-28T22:00:00Z'),
        line('autoSprint', '2026-09-27'),
      ],
    });
    assert.deepEqual(bad(r), []);
  });

  it('gives one marker per fault', () => {
    assert.equal(
      alertMarker('drafts:2026-09-28'),
      '<!-- run-health-alert drafts:2026-09-28 -->',
    );
  });
});

describe('evaluateRunHealth — first days', () => {
  it('no "Daily card" issue yet: the local runs are not checked', () => {
    const r = evaluateRunHealth({
      now: NOW,
      maxWallMinutes: WALL,
      mainComments: null,
      shadowComments: null,
    });
    assert.deepEqual(bad(r), []);
  });
  it('a run that ended before the issue existed is not checked', () => {
    const r = evaluateRunHealth({
      now: NOW,
      maxWallMinutes: WALL,
      mainComments: [line('drafts', '2026-09-28')],
      mainCreatedAt: '2026-09-28T20:00:00Z',
      shadowComments: null,
    });
    // autoSprint 2026-09-27 ended ~04:30 UTC on 09-28, before 20:00 UTC.
    assert.deepEqual(bad(r), []);
    assert.ok(
      r.checks.some(c => /before the "Daily card" issue existed/.test(c.text)),
    );
  });
});
