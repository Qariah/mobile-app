#!/usr/bin/env node
// @ai
//
// scripts/__tests__/owner-actions.test.mjs
// ----------------------------------------
// node:test suite for scripts/lib/owner-actions.mjs (the owner's next steps)
// and for the shape of docs/operations/owner-actions.json.
// Run:  node --test scripts/__tests__/owner-actions.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CHECKS,
  cardHost,
  cardSection,
  cleanDays,
  evaluateOwnerActions,
  fill,
  playStateOfCard,
  renderLines,
  unclaimed,
  wrap,
} from '../lib/owner-actions.mjs';

const LIST = JSON.parse(
  readFileSync(
    new URL('../../docs/operations/owner-actions.json', import.meta.url),
    'utf8',
  ),
);
const item = id =>
  JSON.parse(JSON.stringify(LIST.items.find(i => i.id === id)));
// The item without closedOn/closedNote, so its check itself stays tested.
const open = id => {
  const i = item(id);
  delete i.closedOn;
  delete i.closedNote;
  return i;
};

// The shadow card of 2026-09-27 (issue #504), cut to the lines that matter.
const card = (play, host = 'cloud', date = '2026-09-27') =>
  [
    `<!-- daily-card date=${date} sections=triage host=${host} -->`,
    '```text',
    'ANDROID · v2 only  day     7d    28d',
    play,
    '```',
  ].join('\n');
const PLAY_ERR = 'Play · seen      error: The caller does not ';
const PLAY_OK = 'Play · seen       0.12   0.10   0.09';
const health = (date, status = 'DONE', task = 'triage') => ({
  body: `run-health task=${task} date=${date} status=${status} build=none toolCalls=20 minutes=2`,
  createdAt: `${date}T20:30:00Z`,
});

// A facts() stub from a plain object. A value that is an Error is thrown.
const factsFrom = obj => name => {
  if (!(name in obj)) throw new Error(`test gave no fact "${name}"`);
  if (obj[name] instanceof Error) throw obj[name];
  return obj[name];
};
const run = (items, facts, ctx = {}) =>
  evaluateOwnerActions(
    {items},
    {today: '2026-09-27', cloud: false, facts: factsFrom(facts), ...ctx},
  );
const one = (entry, facts, ctx) => run([entry], facts, ctx)[0];

describe('docs/operations/owner-actions.json', () => {
  it('has unique ids and a known check for every item', () => {
    const ids = LIST.items.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const i of LIST.items) {
      assert.ok(CHECKS[i.check], `${i.id}: unknown check ${i.check}`);
      assert.ok(i.title && i.promptWhenDue && i.doneWhen, i.id);
      for (const a of i.after || [])
        assert.ok(ids.includes(a), `${i.id} after ${a}`);
      assert.equal(!!i.macOnly, !!CHECKS[i.check].macOnly, `${i.id} macOnly`);
    }
  });
  it('names a real item in every reply phrase', () => {
    const ids = LIST.items.map(i => i.id);
    for (const r of LIST.replies) {
      assert.ok(ids.includes(r.item), r.phrase);
      assert.ok(r.session, r.phrase);
    }
  });
  it('gives a closedNote to every item closed by hand', () => {
    for (const i of LIST.items.filter(x => x.closedOn)) {
      assert.match(i.closedOn, /^\d{4}-\d{2}-\d{2}$/, i.id);
      assert.ok(i.closedNote, `${i.id}: closedOn without closedNote`);
    }
  });
  it('closes the items Omar answered on 2026-10-11', () => {
    for (const id of [
      'share-redirect',
      'disk-for-shipping',
      'user-level-guard-block',
    ])
      assert.equal(item(id).closedOn, '2026-10-11', id);
  });
  it('lists an item in `after` before the item that waits for it', () => {
    const seen = new Set();
    for (const i of LIST.items) {
      for (const a of i.after || [])
        assert.ok(seen.has(a), `${i.id} after ${a}`);
      seen.add(i.id);
    }
  });
});

describe('helpers', () => {
  it('fill() replaces known names and keeps unknown ones', () => {
    assert.equal(fill('a {x} {y}', {x: 1}), 'a 1 {y}');
  });
  it('playStateOfCard() reads the Play line', () => {
    assert.equal(playStateOfCard(card(PLAY_ERR)), 'error');
    assert.equal(playStateOfCard(card(PLAY_OK)), 'ok');
    assert.equal(
      playStateOfCard(card('Play · seen      unavailable')),
      'error',
    );
    assert.equal(playStateOfCard(card('Sentry  0.70')), null);
  });
  it('cardHost() reads the marker', () => {
    assert.equal(cardHost(card(PLAY_OK, 'mac')), 'mac');
    assert.equal(cardHost('no marker'), null);
  });
  it('cleanDays() counts distinct DONE triage dates from a date', () => {
    const days = cleanDays(
      [
        health('2026-09-27'), // before countFrom
        health('2026-09-28', 'FAILED'),
        health('2026-09-28'),
        health('2026-09-28'), // same day twice
        health('2026-09-29', 'DONE', 'drafts'),
        health('2026-09-30'),
        {body: 'not a run-health line'},
      ],
      {from: '2026-09-28'},
    );
    assert.deepEqual(days, ['2026-09-28', '2026-09-30']);
  });
  it('unclaimed() drops ledger, labelled and no-fix builds', () => {
    assert.deepEqual(
      unclaimed(
        {
          candidates: ['1726', '1769', '1922', '1975'],
          ledgerBuilds: ['1922'],
          labelled: {1726: 0, 1769: 1, 1975: 0},
        },
        ['1975'],
      ),
      ['1726'],
    );
  });
  it('wrap() keeps lines within the width and long words whole', () => {
    const url =
      'https://github.com/omar-zarka/qariah-v2/actions/workflows/x.yml';
    const lines = wrap(`open ${url} then reply 'merge 502' when it ends`, 30);
    assert.ok(lines.includes(`  ${url}`));
    for (const l of lines) if (!l.includes(url)) assert.ok(l.length <= 30, l);
  });
});

describe('evaluateOwnerActions — gating', () => {
  it('prints nothing before notBefore, and reads no fact', () => {
    const r = one(item('play-vitals-permission'), {});
    assert.equal(r.state, 'not-due');
  });
  it('blocks an item until each `after` item is done', () => {
    const rs = run(
      [item('github-billing'), item('ci-back-to-hosted')],
      {
        pr: {state: 'open', merged: false},
      },
      {today: '2026-10-01'},
    );
    assert.equal(rs[0].state, 'needs-you');
    assert.equal(rs[1].state, 'blocked');
  });
  it('marks a Mac-only check in the cloud, and reads no fact', () => {
    assert.equal(
      one(open('disk-for-shipping'), {}, {cloud: true}).state,
      'mac-only',
    );
  });
  it('names the unread Mac-only items in one line, never silently', () => {
    const rs = run(
      [open('disk-for-shipping'), open('user-level-guard-block')],
      {},
      {cloud: true},
    );
    assert.deepEqual(
      renderLines(rs).filter(l => l.startsWith('MAC ONLY')),
      [
        'MAC ONLY · disk-for-shipping, user-level-guard-block: not checked: only a run on the Mac can read these (the Mac task qariah-daily-triage-fix-loop)',
      ],
    );
    assert.deepEqual(cardSection(rs), [
      'none',
      'Mac only, not checked: disk-for-shipping, user-level-guard-block',
    ]);
  });
  it('closedOn: done without a fact read, in the cloud too', () => {
    const closed = {...open('disk-for-shipping'), closedOn: '2026-10-06'};
    assert.equal(one(closed, {}, {cloud: true}).state, 'done');
    assert.equal(one(closed, {}).state, 'done');
  });
  it('--only=mac keeps only the Mac-only items', () => {
    const rs = run(
      [item('unclaimed-builds'), open('disk-for-shipping')],
      {
        policy: {runLimits: {diskFloorGB: {build: 28}}},
        diskFreeGB: 40,
        loopDrafts: 1,
      },
      {only: 'mac'},
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['skip', 'done'],
    );
  });
  it('turns a failed read into not-checked, not a false all-clear', () => {
    const r = one(item('unclaimed-builds'), {
      watchBuilds: new Error('HTTP 502'),
    });
    assert.equal(r.state, 'not-checked');
    assert.match(r.lines[0], /could not check \(HTTP 502\)/);
  });
  it('reports an unknown check name', () => {
    const r = one({id: 'x', check: 'nope'}, {});
    assert.equal(r.state, 'not-checked');
  });
});

describe('play-vitals-permission', () => {
  const ctx = {today: '2026-09-30'};
  it('asks Omar while the newest cloud card shows the Play error', () => {
    const r = one(
      item('play-vitals-permission'),
      {
        cardComments: [
          {body: card(PLAY_OK), createdAt: '2026-09-28T20:00:00Z'},
          {body: card(PLAY_ERR), createdAt: '2026-09-29T20:00:00Z'},
        ],
      },
      ctx,
    );
    assert.equal(r.state, 'needs-you');
    assert.match(
      r.lines[0],
      /View app quality information.*reply 'play fixed'/,
    );
  });
  it('is done when the newest cloud card has Play numbers', () => {
    const r = one(
      item('play-vitals-permission'),
      {
        cardComments: [
          {body: card(PLAY_ERR), createdAt: '2026-09-28T20:00:00Z'},
          {body: card(PLAY_OK), createdAt: '2026-09-29T20:00:00Z'},
        ],
      },
      ctx,
    );
    assert.equal(r.state, 'done');
  });
  it('ignores Mac cards and cards without a Play line', () => {
    const r = one(
      item('play-vitals-permission'),
      {
        cardComments: [
          {body: card(PLAY_ERR), createdAt: '2026-09-28T20:00:00Z'},
          {body: card(PLAY_OK, 'mac'), createdAt: '2026-09-29T20:00:00Z'},
          {body: card('Sentry 0.1'), createdAt: '2026-09-29T21:00:00Z'},
        ],
      },
      ctx,
    );
    assert.equal(r.state, 'needs-you');
  });
  it('waits when there is no cloud card yet', () => {
    assert.equal(
      one(item('play-vitals-permission'), {cardComments: []}, ctx).state,
      'waiting',
    );
  });
  it('waits graceDays after "play fixed", then asks again', () => {
    const it0 = {
      ...item('play-vitals-permission'),
      status: 'owner-acted',
      statusDate: '2026-09-30',
    };
    const facts = {
      cardComments: [{body: card(PLAY_ERR), createdAt: '2026-10-01T20:00:00Z'}],
    };
    const w = one(it0, facts, {today: '2026-10-01'});
    assert.equal(w.state, 'waiting');
    assert.match(w.lines[0], /changed on 2026-09-30/);
    const again = one(it0, facts, {today: '2026-10-02'});
    assert.equal(again.state, 'needs-you');
    assert.match(again.lines[0], /2 days after your change on 2026-09-30/);
  });
});

describe('unclaimed-builds', () => {
  it('never asks Omar: one WAITING line per unclaimed build, for the loop', () => {
    const r = one(item('unclaimed-builds'), {
      watchBuilds: {
        candidates: ['1769', '1901'],
        ledgerBuilds: [],
        labelled: {1769: 0, 1901: 0},
      },
    });
    assert.equal(r.state, 'waiting');
    assert.equal(r.lines.length, 2);
    assert.match(
      r.lines[0],
      /^Build 1769 has no fix record yet\. The Mac loop/,
    );
  });
  it('treats 1726 as recorded (noFixBuilds in the real list)', () => {
    const r = one(item('unclaimed-builds'), {
      watchBuilds: {
        candidates: ['1726'],
        ledgerBuilds: [],
        labelled: {1726: 0},
      },
    });
    assert.equal(r.state, 'done');
  });
  it('is done when every build is claimed or answered "none"', () => {
    const it0 = {...item('unclaimed-builds'), noFixBuilds: ['1726']};
    const r = one(it0, {
      watchBuilds: {
        candidates: ['1726', '1769'],
        ledgerBuilds: ['1769'],
        labelled: {},
      },
    });
    assert.equal(r.state, 'done');
  });
});

describe('shadow-week', () => {
  const policy = {triageRunsInCloud: false};
  it('waits with the count; runs before countFrom do not count', () => {
    const r = one(item('shadow-week'), {
      policy,
      shadowComments: [
        health('2026-09-27'),
        health('2026-09-28'),
        health('2026-09-29', 'FAILED'),
      ],
    });
    assert.equal(r.state, 'waiting');
    assert.match(r.lines[0], /1 of 7 clean days since 2026-09-28/);
  });
  it('asks for the switch at 7 clean days', () => {
    const days = ['28', '29', '30']
      .map(d => `2026-09-${d}`)
      .concat(['01', '02', '03', '04'].map(d => `2026-10-${d}`));
    const r = one(item('shadow-week'), {
      policy,
      shadowComments: days.map(d => health(d)),
    });
    assert.equal(r.state, 'needs-you');
    assert.match(
      r.lines[0],
      /ran cleanly 7 days\. Reply 'switch triage to cloud'/,
    );
  });
  it('is done once triageRunsInCloud is true', () => {
    assert.equal(
      one(item('shadow-week'), {
        policy: {triageRunsInCloud: true},
        shadowComments: [],
      }).state,
      'done',
    );
  });
});

describe('github-billing → ci-back-to-hosted → remove-runner', () => {
  const ctx = {today: '2026-10-01'};
  // Without closedOn, so the runner check itself stays tested.
  const openRunner = () => {
    const i = item('remove-runner');
    delete i.closedOn;
    return i;
  };
  const chain = () => [
    item('github-billing'),
    item('ci-back-to-hosted'),
    openRunner(),
  ];
  it('is closed by hand (closedOn): done in the cloud, no runner read', () => {
    const rs = run(
      [
        item('github-billing'),
        item('ci-back-to-hosted'),
        item('remove-runner'),
      ],
      {pr: {state: 'closed', merged: true}, runners: new Error('HTTP 403')},
      {...ctx, cloud: true},
    );
    assert.equal(rs[2].state, 'done');
  });
  it('while PR #502 is open: billing needs Omar, the rest wait', () => {
    const rs = run(
      chain(),
      {pr: {state: 'open', merged: false}, runners: ['qariah-mac']},
      ctx,
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['needs-you', 'blocked', 'blocked'],
    );
  });
  it('after "billing fixed": the dry-run command, then "merge 502"', () => {
    const items = chain();
    items[0].status = 'done';
    const rs = run(
      items,
      {pr: {state: 'open', merged: false}, runners: ['qariah-mac']},
      ctx,
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['done', 'needs-you', 'blocked'],
    );
    assert.match(
      rs[1].lines[0],
      /gh workflow run diagnostics-watch\.yml .* -f dry_run=true.*reply 'merge 502'/,
    );
  });
  it('after the merge: the runner removal command while the runner is listed', () => {
    const rs = run(
      chain(),
      {pr: {state: 'closed', merged: true}, runners: ['qariah-mac']},
      ctx,
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['done', 'done', 'needs-you'],
    );
    assert.match(rs[2].lines[0], /\.\/config\.sh remove --token/);
  });
  it('all done when the runner is gone', () => {
    const rs = run(
      chain(),
      {pr: {state: 'closed', merged: true}, runners: []},
      ctx,
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['done', 'done', 'done'],
    );
  });
  it('in the cloud: an open runner check is mac-only, not NOT CHECKED', () => {
    const rs = run(
      chain(),
      {pr: {state: 'closed', merged: true}, runners: new Error('HTTP 403')},
      {...ctx, cloud: true},
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['done', 'done', 'mac-only'],
    );
  });
  it('--only=mac: evaluates the PR it waits on, and asks to remove the runner', () => {
    const rs = run(
      chain(),
      {pr: {state: 'closed', merged: true}, runners: ['qariah-mac']},
      {...ctx, only: 'mac'},
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['skip', 'skip', 'needs-you'],
    );
    assert.match(rs[2].lines[0], /\.\/config\.sh remove --token/);
  });
  it('--only=mac: still blocked while PR #502 is open', () => {
    const rs = run(
      chain(),
      {pr: {state: 'open', merged: false}, runners: ['qariah-mac']},
      {...ctx, only: 'mac'},
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['skip', 'skip', 'blocked'],
    );
  });
  it('#502 closed without merge: say so, and do not ask to remove the runner', () => {
    const rs = run(
      chain(),
      {pr: {state: 'closed', merged: false}, runners: ['qariah-mac']},
      ctx,
    );
    assert.deepEqual(
      rs.map(r => r.state),
      ['done', 'needs-you', 'blocked'],
    );
    assert.match(rs[1].lines[0], /closed and not merged/);
  });
});

describe('disk-for-shipping', () => {
  const policy = {runLimits: {diskFloorGB: {build: 28}}};
  it('asks for space when the disk is low and a loop draft waits', () => {
    const r = one(open('disk-for-shipping'), {
      policy,
      diskFreeGB: 12,
      loopDrafts: 2,
    });
    assert.equal(r.state, 'needs-you');
    assert.match(
      r.lines[0],
      /^Free 16 GB .*12 GB free, a build needs 28 GB, 2 loop drafts/,
    );
  });
  it('says nothing when no draft waits, or when the disk is enough', () => {
    assert.equal(
      one(open('disk-for-shipping'), {policy, diskFreeGB: 12, loopDrafts: 0})
        .state,
      'done',
    );
    assert.equal(
      one(open('disk-for-shipping'), {policy, diskFreeGB: 30, loopDrafts: 3})
        .state,
      'done',
    );
  });
});

describe('phase2-decision', () => {
  // Unanswered: the live file records the real answer.
  const unanswered = () => ({
    ...item('phase2-decision'),
    status: null,
    statusDate: null,
    answer: null,
  });
  const inCloud = {policy: {triageRunsInCloud: true}, shadowComments: []};
  const withShadow = p2 =>
    run([item('shadow-week'), p2], inCloud, {today: '2026-10-20'})[1];
  it('is blocked before the cutover', () => {
    const rs = run([item('shadow-week'), unanswered()], {
      policy: {triageRunsInCloud: false},
      shadowComments: [],
    });
    assert.equal(rs[1].state, 'blocked');
  });
  it('waits for a session when cutoverDate is missing', () => {
    // Set cutoverDate here: the live file records the real date after the cutover.
    const p2 = {...unanswered(), cutoverDate: null};
    assert.equal(withShadow(p2).state, 'waiting');
  });
  it('says nothing until 14 days after the cutover, then asks', () => {
    const p2 = {...unanswered(), cutoverDate: '2026-10-07'};
    assert.equal(withShadow(p2).state, 'not-due'); // due 2026-10-21
    const due = run([item('shadow-week'), p2], inCloud, {
      today: '2026-10-21',
    })[1];
    assert.equal(due.state, 'needs-you');
    assert.match(due.lines[0], /'phase 2 yes' or 'phase 2 no'/);
  });
  it('is done after the answer is recorded', () => {
    const p2 = {
      ...unanswered(),
      cutoverDate: '2026-10-01',
      status: 'done',
      answer: 'no',
    };
    assert.equal(withShadow(p2).state, 'done');
  });
});

describe('user-level-guard-block', () => {
  it('says nothing while the release branch exists', () => {
    assert.equal(
      one(open('user-level-guard-block'), {
        branchExists: true,
        userGuardBlock: true,
      }).state,
      'not-due',
    );
  });
  it('gives the backup-first command when the branch is gone and the block is there', () => {
    const r = one(open('user-level-guard-block'), {
      branchExists: false,
      userGuardBlock: true,
    });
    assert.equal(r.state, 'needs-you');
    assert.match(
      r.lines[0],
      /cp ~\/\.claude\/settings\.json ~\/\.claude\/settings\.json\.bak-guard && jq/,
    );
  });
  it('is done when the block is gone', () => {
    assert.equal(
      one(open('user-level-guard-block'), {
        branchExists: false,
        userGuardBlock: false,
      }).state,
      'done',
    );
  });
});

describe('rendering', () => {
  const results = [
    {id: 'a', state: 'waiting', lines: ['wait here']},
    {id: 'b', state: 'needs-you', lines: ['do one', 'do two']},
    {id: 'c', state: 'not-checked', lines: ['c: could not check (x)']},
    {id: 'd', state: 'done', lines: []},
  ];
  it('renderLines() puts NEEDS YOU first', () => {
    assert.deepEqual(renderLines(results), [
      'NEEDS YOU · do one',
      'NEEDS YOU · do two',
      'WAITING · wait here',
      'NOT CHECKED · c: could not check (x)',
    ]);
  });
  it('cardSection() numbers the prompts and leaves WAITING off the card', () => {
    assert.deepEqual(cardSection(results), [
      '1. do one',
      '2. do two',
      'could not check: c',
    ]);
  });
  it('cardSection() prints none when nothing needs Omar', () => {
    assert.deepEqual(cardSection([{id: 'd', state: 'done', lines: []}]), [
      'none',
    ]);
  });
});

describe('share-redirect', () => {
  it('runs in the cloud (a plain HTTPS request, not Mac-only)', () => {
    const r = one(
      open('share-redirect'),
      {shareRedirect: {code: 0, location: ''}},
      {cloud: true},
    );
    assert.equal(r.state, 'needs-you');
  });
  it('is done when the old host redirects to qariah.org', () => {
    const r = one(open('share-redirect'), {
      shareRedirect: {
        code: 301,
        location: 'https://qariah.org/reciter/maryam-amir',
      },
    });
    assert.equal(r.state, 'done');
  });
  it('asks Omar while the old host is dead, with the exact steps', () => {
    const r = one(open('share-redirect'), {
      shareRedirect: {code: 0, location: ''},
    });
    assert.equal(r.state, 'needs-you');
    assert.match(
      r.lines[0],
      /answers nothing\).*Page Rules.*app\.qariah\.app\/\*.*'share fixed'/,
    );
  });
  it('is not checked when a proxy refuses the tunnel (cloud egress 403)', () => {
    const r = one(
      open('share-redirect'),
      {shareRedirect: {code: 0, proxy: 403, location: ''}},
      {cloud: true},
    );
    assert.equal(r.state, 'not-checked');
    assert.match(r.lines[0], /proxy refused the connection, HTTP 403/);
  });
  it('still asks when the proxy connected but the host answered nothing', () => {
    const r = one(open('share-redirect'), {
      shareRedirect: {code: 0, proxy: 200, location: ''},
    });
    assert.equal(r.state, 'needs-you');
  });
  it('asks when it redirects somewhere else', () => {
    const r = one(open('share-redirect'), {
      shareRedirect: {code: 301, location: 'https://example.com/'},
    });
    assert.equal(r.state, 'needs-you');
  });
});
