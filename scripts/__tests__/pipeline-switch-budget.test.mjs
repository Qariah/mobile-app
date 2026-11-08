// Tests for the pause switch (scripts/lib/pipeline-switch.mjs) and the
// failure budget (scripts/lib/failure-budget.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {switchFor, PAUSE_LABEL, offLabel} from '../lib/pipeline-switch.mjs';
import {
  addDays,
  budgetTable,
  judgeBudget,
  offItemBody,
  parseRunHealth,
  windowsFor,
} from '../lib/failure-budget.mjs';

const line = (task, date, status) =>
  `run-health task=${task} date=${date} status=${status} build=none toolCalls=12 minutes=3`;

test('the switch: pipeline-paused stops every task, off:<task> stops one', () => {
  assert.equal(switchFor([], 'drafts').stop, false);
  assert.equal(switchFor(['ops', 'pinned'], 'drafts').stop, false);
  const p = switchFor(['ops', PAUSE_LABEL], 'steward');
  assert.equal(p.stop, true);
  assert.equal(p.label, PAUSE_LABEL);
  const o = switchFor(['ops', offLabel('auditor')], 'auditor');
  assert.equal(o.stop, true);
  assert.equal(o.label, 'off:auditor');
  assert.equal(switchFor(['ops', offLabel('auditor')], 'drafts').stop, false);
  // The pause wins over an off label.
  assert.equal(switchFor([offLabel('drafts'), PAUSE_LABEL], 'drafts').label, PAUSE_LABEL);
});

test('parseRunHealth reads each line, and leaves other text out', () => {
  const lines = parseRunHealth([
    line('drafts', '2026-11-01', 'DONE'),
    `Some prose\n${line('auditor', '2026-11-01', 'FAILED')}\nrelease-audit: NOT READY`,
    'run-health task=promoter date=2026-11-02 status=SKIPPED build=3763 toolCalls=4 minutes=1',
  ]);
  assert.deepEqual(
    lines.map(l => [l.task, l.status, l.build]),
    [
      ['drafts', 'DONE', null],
      ['auditor', 'FAILED', null],
      ['promoter', 'SKIPPED', '3763'],
    ],
  );
});

test('windows: two 7-day windows that end yesterday', () => {
  assert.deepEqual(windowsFor('2026-11-13'), {
    older: {from: '2026-10-30', to: '2026-11-05'},
    newer: {from: '2026-11-06', to: '2026-11-12'},
  });
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

// 14 days of lines for one task: `bad` days fail in each window.
function fortnight(task, today, {olderBad, newerBad, status = 'FAILED'}) {
  const out = [];
  for (let i = 14; i >= 1; i--) {
    const d = addDays(today, -i);
    const inOlder = i >= 8;
    const k = inOlder ? 14 - i : 7 - i; // 0..6 inside its window
    const bad = inOlder ? k < olderBad : k < newerBad;
    out.push(line(task, d, bad ? status : 'DONE'));
  }
  return out;
}

test('half or more bad in both windows → TURN OFF; once → over-once', () => {
  const today = '2026-11-13';
  const all = [
    ...fortnight('auditor', today, {olderBad: 4, newerBad: 5}),
    ...fortnight('drafts', today, {olderBad: 0, newerBad: 4}),
    ...fortnight('autoSprint', today, {olderBad: 3, newerBad: 3}), // 3 of 7: under half
    ...fortnight('triage', today, {olderBad: 0, newerBad: 0}),
    ...fortnight('steward', today, {olderBad: 7, newerBad: 7, status: 'STOPPED-LIMIT'}),
  ];
  const r = judgeBudget(parseRunHealth(all), {today, labels: ['ops']});
  const v = Object.fromEntries(r.rows.map(x => [x.task, x.verdict]));
  assert.equal(v.auditor, 'turn-off');
  assert.equal(v.drafts, 'over-once');
  assert.equal(v.autoSprint, 'ok');
  assert.equal(v.triage, 'ok');
  assert.equal(v.steward, 'over-exempt', 'the Steward is never turned off');
  assert.deepEqual(r.turnOff, ['auditor']);
  assert.match(budgetTable(r), /\| auditor \| 4 \/ 7 \| 5 \/ 7 \| 0, 0 \| TURN OFF/);
});

test('a weekly task with one failed run in each week is turned off', () => {
  const today = '2026-11-13';
  const lines = parseRunHealth([
    line('upstreamSteward', '2026-11-02', 'FAILED'),
    line('upstreamSteward', '2026-11-09', 'FAILED'),
  ]);
  const r = judgeBudget(lines, {today});
  assert.deepEqual(r.turnOff, ['upstreamSteward']);
});

test('SKIPPED lines are healthy; a task with an off label stays off', () => {
  const today = '2026-11-13';
  const skip = parseRunHealth(fortnight('drafts', today, {olderBad: 7, newerBad: 7, status: 'SKIPPED'}));
  assert.equal(judgeBudget(skip, {today}).rows.find(x => x.task === 'drafts').verdict, 'ok');
  const bad = parseRunHealth(fortnight('auditor', today, {olderBad: 7, newerBad: 7}));
  const r = judgeBudget(bad, {today, labels: ['ops', 'off:auditor']});
  assert.equal(r.rows.find(x => x.task === 'auditor').verdict, 'off');
  assert.deepEqual(r.turnOff, []);
});

test('a daily task with no line in a window is silent, never turned off', () => {
  const today = '2026-11-13';
  const r = judgeBudget(parseRunHealth(fortnight('triage', today, {olderBad: 0, newerBad: 0})), {today});
  const drafts = r.rows.find(x => x.task === 'drafts');
  assert.equal(drafts.verdict, 'silent');
  assert.deepEqual(drafts.silent, ['older', 'newer']);
  assert.equal(drafts.newer.missed, 7);
  assert.equal(r.rows.find(x => x.task === 'triage').newer.missed, 0);
  assert.deepEqual(r.turnOff, []);
});

test('the owner item names the counts, the cause and the way back', () => {
  const today = '2026-11-13';
  const r = judgeBudget(parseRunHealth(fortnight('auditor', today, {olderBad: 4, newerBad: 5})), {today});
  const row = r.rows.find(x => x.task === 'auditor');
  const body = offItemBody(row, {card: 510, cause: 'the disk floor', fix: 'PR #800'});
  assert.match(body, /4 of 7 runs in the week before last and 5 of 7 runs last week/);
  assert.match(body, /Cause: the disk floor/);
  assert.match(body, /Fix: PR #800/);
  assert.match(body, /remove the label `off:auditor` from the Daily card #510/);
});
