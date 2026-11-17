#!/usr/bin/env node
// @ai
//
// scripts/__tests__/owner-queue.test.mjs
// --------------------------------------
// Pure-function tests for scripts/lib/owner-queue.mjs, and the usage exits of
// scripts/owner-queue.mjs (no GitHub call).
//
// Run:  node --test scripts/__tests__/owner-queue.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  FIXER_LABEL,
  KINDS,
  LABEL,
  REPLY_KINDS,
  answerBody,
  handoverRefusal,
  defaultReply,
  dropOverlap,
  escalationEmail,
  escalationPlan,
  fieldsOf,
  hourIn,
  keyOf,
  labelsFor,
  markerFor,
  needsYouLines,
  parseQueueIssue,
  renderBody,
  replyOf,
  slugKey,
  sortQueue,
  validateAsk,
} from '../lib/owner-queue.mjs';
import {parseEvents} from '../lib/promotion-approval.mjs';

const CLI = fileURLToPath(new URL('../owner-queue.mjs', import.meta.url));

const ask = (over = {}) => ({
  kind: 'decision',
  title: 'Publish public beta 3790?',
  body: 'READY on 3790. Gates 9/9.',
  reply: 'owner-reply: go public-beta 3790',
  run: 'auditor',
  ...over,
});

describe('slugKey and markerFor', () => {
  it('slugs a title to a-z0-9-', () => {
    assert.equal(
      slugKey('Publish public beta 3790?'),
      'publish-public-beta-3790',
    );
    assert.equal(slugKey('  a run waits: auditor '), 'a-run-waits-auditor');
    assert.equal(slugKey('').length, 0);
  });
  it('caps the key at 60 characters with no trailing dash', () => {
    const k = slugKey('x '.repeat(80));
    assert.ok(k.length <= 60);
    assert.ok(!k.endsWith('-'));
  });
  it('writes and reads the marker', () => {
    const m = markerFor('run-waits.auditor_1');
    assert.equal(m, '<!-- owner-queue:run-waits.auditor_1 -->');
    assert.equal(keyOf(`x\n${m}\ny`), 'run-waits.auditor_1');
    assert.equal(keyOf('no marker'), null);
    assert.throws(() => markerFor('Bad Key'), /bad key/);
    assert.throws(() => markerFor(''), /bad key/);
  });
});

describe('validateAsk', () => {
  it('accepts a full ask and derives the key', () => {
    const v = validateAsk(ask());
    assert.equal(v.ok, true, v.errors.join(';'));
    assert.equal(v.fields.key, 'publish-public-beta-3790');
    assert.equal(v.fields.priority, 'P2');
  });
  it('names each missing field', () => {
    const v = validateAsk({kind: 'wish', title: '', body: ''});
    assert.equal(v.ok, false);
    assert.ok(v.errors.some(e => e.includes('--kind')));
    assert.ok(v.errors.some(e => e.includes('--title')));
    assert.ok(v.errors.some(e => e.includes('--body-file')));
  });
  it('checks due, run, priority and issue', () => {
    const v = validateAsk(
      ask({due: 'tomorrow', run: 'nightly', priority: 'P9', issue: -1}),
    );
    assert.deepEqual(
      v.errors.map(e => e.split(' ')[0]),
      ['--due', '--run', '--priority', '--issue'],
    );
    assert.equal(validateAsk(ask({due: '2026-11-06'})).ok, true);
    assert.equal(validateAsk(ask({due: '2026-11-06T17:00:00Z'})).ok, true);
    assert.equal(validateAsk(ask({issue: 12})).ok, true);
  });
  it('fills the default reply by kind', () => {
    for (const kind of KINDS) {
      const v = validateAsk(ask({kind, reply: ''}));
      assert.equal(v.fields.reply, defaultReply(kind));
    }
    assert.match(defaultReply('info'), /Steward/);
  });
  it('takes an explicit key and refuses a bad one', () => {
    assert.equal(
      validateAsk(ask({key: 'ready-3790'})).fields.key,
      'ready-3790',
    );
    assert.equal(validateAsk(ask({key: 'Bad!'})).ok, false);
  });
});

// The approval text, from parts: a command that holds it whole meets the
// publish guard (#835).
const approval = build =>
  ['owner-reply:', 'go', 'public-beta', build].join(' ');

describe('validateAsk --reply-kind (#835)', () => {
  const rk = over => ask({reply: undefined, ...over});
  it('builds the promotion reply from the build number', () => {
    const v = validateAsk(rk({replyKind: 'promotion', build: '4487'}));
    assert.equal(v.ok, true, v.errors.join('; '));
    assert.equal(v.fields.reply, approval('4487'));
    assert.equal(REPLY_KINDS.promotion('3790'), approval('3790'));
  });
  it('builds a reply that the Promoter reads as an approval of the same build', () => {
    const [e] = parseEvents(
      [{id: 1, user: {login: 'owner'}, body: REPLY_KINDS.promotion('4487')}],
      {owner: 'owner'},
    );
    assert.equal(e && e.kind, 'approve');
    assert.equal(String(e.build), '4487');
  });
  it('refuses an unknown reply kind', () => {
    const v = validateAsk(rk({replyKind: 'prod', build: '4487'}));
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /--reply-kind must be promotion/);
    assert.equal(validateAsk(rk({replyKind: true, build: '1'})).ok, false);
  });
  it('refuses a build that is not digits, or no build', () => {
    for (const build of [undefined, '', true, '44a7', '-1', '4487 x', '04487'])
      assert.match(
        validateAsk(rk({replyKind: 'promotion', build})).errors.join(' '),
        /--build=<digits>/,
        String(build),
      );
  });
  it('refuses --reply together with --reply-kind', () => {
    const v = validateAsk(
      ask({reply: 'x', replyKind: 'promotion', build: '4487'}),
    );
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /not both/);
  });
  it('refuses --build with no --reply-kind', () => {
    assert.match(
      validateAsk(rk({build: '4487'})).errors.join(' '),
      /--build needs --reply-kind/,
    );
  });
});

describe('labelsFor and renderBody', () => {
  it('labels the queue, the kind, and a P0/P1 priority only', () => {
    assert.deepEqual(labelsFor({kind: 'info'}), [LABEL, 'info']);
    assert.deepEqual(labelsFor({kind: 'decision', priority: 'P0'}), [
      LABEL,
      'decision',
      'priority:P0',
    ]);
    assert.deepEqual(labelsFor({kind: 'action', priority: 'P2'}), [
      LABEL,
      'action',
    ]);
  });
  it('renders a body that parses back', () => {
    const f = validateAsk(ask({due: '2026-11-06', priority: 'P1'})).fields;
    const body = renderBody({...f, asked: '2026-11-05T10:00:00Z'});
    assert.equal(keyOf(body), 'publish-public-beta-3790');
    assert.deepEqual(fieldsOf(body), {
      kind: 'decision',
      priority: 'P1',
      run: 'auditor',
      due: '2026-11-06',
      asked: '2026-11-05T10:00:00Z',
    });
    assert.equal(replyOf(body), 'owner-reply: go public-beta 3790');
    assert.ok(body.includes('READY on 3790.'));
    assert.ok(body.includes('qariah-steward.md'));
  });
  it('renders the Pipeline page fields: do, not-before, blocks', () => {
    const v = validateAsk(
      ask({
        do: ' Free 11 GB  on the Mac. ',
        notBefore: 'build>4406',
        blocks: 'audit,promote',
      }),
    );
    assert.equal(v.ok, true);
    const body = renderBody({...v.fields, asked: '2026-11-05T10:00:00Z'});
    const f = fieldsOf(body);
    assert.equal(f.do, 'Free 11 GB on the Mac.');
    assert.equal(f['not-before'], 'build>4406');
    assert.equal(f.blocks, 'audit,promote');
    // A body with none of them has no such lines.
    const plain = renderBody({...validateAsk(ask()).fields});
    assert.doesNotMatch(plain, /^- (do|not-before|blocks):/m);
  });
  it('refuses a bad not-before and an unknown step', () => {
    const a = validateAsk(ask({notBefore: 'next week'}));
    assert.equal(a.ok, false);
    assert.match(
      a.errors.join(' '),
      /--not-before must be build>N or an ISO date/,
    );
    assert.equal(validateAsk(ask({notBefore: '2026-11-20'})).ok, true);
    const b = validateAsk(ask({blocks: 'audit,deploy'}));
    assert.equal(b.ok, false);
    assert.match(b.errors.join(' '), /--blocks must name steps/);
  });
});

const issue = (n, over = {}) => {
  const f = validateAsk(ask(over)).fields;
  return {
    number: n,
    title: f.title,
    body: renderBody({...f, asked: '2026-11-05T10:00:00Z'}),
    labels: labelsFor(f).map(name => ({name})),
    created_at: `2026-11-0${(n % 9) + 1}T00:00:00Z`,
    html_url: `https://github.com/o/r/issues/${n}`,
    ...(over.escalated
      ? {labels: [...labelsFor(f).map(name => ({name})), {name: 'escalated'}]}
      : {}),
  };
};

describe('parseQueueIssue', () => {
  it('reads the kind from the labels first, then the body', () => {
    const i = parseQueueIssue(issue(1));
    assert.equal(i.kind, 'decision');
    assert.equal(i.key, 'publish-public-beta-3790');
    assert.equal(i.reply, 'owner-reply: go public-beta 3790');
    assert.equal(i.run, 'auditor');
    assert.equal(i.priority, 'P2');
    assert.equal(i.escalated, false);
    const bare = parseQueueIssue({
      number: 2,
      title: 't',
      body: '- kind: action\n- priority: P1',
      labels: ['owner-queue'],
    });
    assert.equal(bare.kind, 'action');
    assert.equal(bare.priority, 'P1');
    const none = parseQueueIssue({number: 3, title: 't', body: '', labels: []});
    assert.equal(none.kind, 'info');
    assert.equal(none.key, null);
  });
  it('reads the priority label over the body and the escalated label', () => {
    const i = parseQueueIssue(issue(4, {priority: 'P0', escalated: true}));
    assert.equal(i.priority, 'P0');
    assert.equal(i.escalated, true);
    const j = parseQueueIssue({
      ...issue(5, {priority: 'P0'}),
      labels: [
        {name: 'owner-queue'},
        {name: 'decision'},
        {name: 'priority:P1'},
      ],
    });
    assert.equal(j.priority, 'P1');
  });
  it('reads assignees in both shapes', () => {
    assert.deepEqual(
      parseQueueIssue({...issue(6), assignees: [{login: 'omar-zarka'}]})
        .assignees,
      ['omar-zarka'],
    );
    assert.deepEqual(
      parseQueueIssue({...issue(6), assignees: ['x']}).assignees,
      ['x'],
    );
  });
});

describe('sortQueue and needsYouLines', () => {
  const items = [
    parseQueueIssue(issue(1, {kind: 'info', title: 'a run failed: auditor'})),
    parseQueueIssue(
      issue(2, {kind: 'action', title: 'Free 7 GB', due: '2026-11-09'}),
    ),
    parseQueueIssue(
      issue(3, {kind: 'decision', title: 'Stop the ramp?', priority: 'P0'}),
    ),
    parseQueueIssue(
      issue(4, {kind: 'decision', title: 'Approve 3790', due: '2026-11-07'}),
    ),
  ];
  it('puts P0 first, then the earliest due', () => {
    assert.deepEqual(
      sortQueue(items).map(i => i.number),
      [3, 4, 2, 1],
    );
  });
  it('prints one NEEDS YOU line for each decision or action, never for info', () => {
    const lines = needsYouLines(items);
    assert.equal(lines.length, 3);
    assert.equal(
      lines[0],
      '#3 [P0] Stop the ramp? — owner-reply: go public-beta 3790',
    );
    assert.equal(
      lines[1],
      '#4 Approve 3790 (due 2026-11-07) — owner-reply: go public-beta 3790',
    );
    assert.ok(lines[2].startsWith('#2 Free 7 GB (due 2026-11-09)'));
    assert.ok(!lines.some(l => l.includes('a run failed')));
  });
  it('keeps the first line of a long reply only', () => {
    const i = parseQueueIssue(
      issue(7, {kind: 'action', reply: 'line one\nline two'}),
    );
    assert.ok(needsYouLines([i])[0].endsWith('— line one'));
  });
});

describe('dropOverlap', () => {
  it('drops the owner-actions line whose id a queue key owns, keeps the rest', () => {
    const results = [
      {id: 'phase2-decision', state: 'needs-you', lines: ['x']},
      {id: 'github-billing', state: 'needs-you', lines: ['y']},
    ];
    const q = [parseQueueIssue(issue(1, {key: 'phase2-decision'}))];
    assert.deepEqual(
      dropOverlap(results, q).map(r => r.id),
      ['github-billing'],
    );
    assert.equal(dropOverlap(results, []).length, 2);
    assert.deepEqual(dropOverlap(undefined, q), []);
  });
});

describe('answerBody', () => {
  it('records who answered and the text', () => {
    const b = answerBody({
      by: 'steward',
      text: 'The key is revoked.',
      at: '2026-11-05T10:00:00Z',
    });
    assert.ok(
      b.startsWith(
        '<!-- owner-queue-answer by=steward at=2026-11-05T10:00:00Z -->',
      ),
    );
    assert.ok(b.includes('The key is revoked.'));
    assert.throws(() => answerBody({by: 'robot', text: 'x'}), /--by/);
    assert.throws(() => answerBody({by: 'owner', text: ' '}), /--text-file/);
  });
});

describe('escalationPlan and escalationEmail', () => {
  const items = [
    parseQueueIssue(issue(1, {kind: 'info', priority: 'P0'})),
    parseQueueIssue(
      issue(2, {kind: 'decision', priority: 'P0', title: 'Prod stop?'}),
    ),
    parseQueueIssue(
      issue(3, {kind: 'action', priority: 'P1', title: 'Create the App ID'}),
    ),
    parseQueueIssue(
      issue(4, {kind: 'decision', priority: 'P2', title: 'Later'}),
    ),
    parseQueueIssue(
      issue(5, {kind: 'decision', priority: 'P0', escalated: true}),
    ),
  ];
  it('sends a P0 at once, batches P1 for 9am, skips P2, info and escalated', () => {
    const p = escalationPlan(items, {hourPT: 14});
    assert.deepEqual(
      p.now.map(i => i.number),
      [2],
    );
    assert.deepEqual(
      p.batch.map(i => i.number),
      [3],
    );
    assert.equal(p.sendBatch, false);
    assert.equal(escalationPlan(items, {hourPT: 9}).sendBatch, true);
    assert.equal(escalationPlan(items, {hourPT: 10}).sendBatch, true);
    assert.equal(escalationPlan(items, {hourPT: 11}).sendBatch, false);
    assert.equal(escalationPlan([items[0]], {hourPT: 9}).sendBatch, false);
  });
  it('writes one email with the issue links and the reply text', () => {
    const text = escalationEmail([items[1], items[2]], {
      repo: 'omar-zarka/qariah-v2',
    });
    assert.ok(text.startsWith('2 items in the owner queue need you.'));
    assert.ok(text.includes('#2 [P0] Prod stop?'));
    assert.ok(
      text.includes('https://github.com/omar-zarka/qariah-v2/issues/3'),
    );
    assert.ok(text.includes('owner-reply: go public-beta 3790'));
    assert.ok(
      escalationEmail([items[1]], {repo: 'o/r'}).startsWith(
        '1 item in the owner queue needs you.',
      ),
    );
  });
  it('reads the hour in the owner time zone', () => {
    assert.equal(hourIn(Date.UTC(2026, 10, 5, 17, 5)), 9); // PST: UTC-8
    assert.equal(hourIn(Date.UTC(2026, 6, 5, 16, 5)), 9); // PDT: UTC-7
    assert.equal(hourIn(Date.UTC(2026, 10, 5, 8, 0)), 0);
  });
});

describe('the CLI usage exits (no GitHub call)', () => {
  const run = args => spawnSync('node', [CLI, ...args], {encoding: 'utf8'});
  it('exits 2 with no command', () => {
    const r = run([]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  });
  it('exits 2 on a bad ask before any network call', () => {
    const r = run([
      'ask',
      '--kind=wish',
      '--title=x',
      '--body-file=/nonexistent/file',
    ]);
    assert.equal(r.status, 2);
  });
  it('writes the promotion reply in a dry run, and refuses --reply with --reply-kind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owner-queue-'));
    try {
      const body = join(dir, 'body.md');
      writeFileSync(body, 'READY on 4487.\n');
      const base = [
        'ask',
        '--kind=decision',
        '--title=Publish public beta 4487?',
        `--body-file=${body}`,
        '--reply-kind=promotion',
        '--build=4487',
        '--dry-run',
      ];
      const r = run(base);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /## Reply\n\n(.*)\n/);
      assert.equal(r.stdout.match(/## Reply\n\n(.*)\n/)[1], approval('4487'));
      assert.equal(run([...base, '--reply=x']).status, 2);
      assert.equal(
        run(base.map(a => (a === '--build=4487' ? '--build=44x' : a))).status,
        2,
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('exits 2 on answer with no number or no --by', () => {
    assert.equal(run(['answer']).status, 2);
    assert.equal(run(['answer', '12']).status, 2);
  });
});

describe('handoverRefusal', () => {
  const L = (...names) => names.map(name => ({name}));
  it('lets an open owner-queue issue with loop-actionable go', () => {
    assert.equal(
      handoverRefusal({
        state: 'open',
        labels: L(LABEL, 'info', FIXER_LABEL, 'bug'),
      }),
      '',
    );
  });
  it('refuses an issue with no loop-actionable label (no validated Evidence block)', () => {
    assert.match(
      handoverRefusal({state: 'open', labels: L(LABEL, 'info')}),
      /no loop-actionable label/,
    );
  });
  it('refuses a closed issue: the Fixer reads only open issues (#777, #781, #795)', () => {
    assert.match(
      handoverRefusal({state: 'closed', labels: L(LABEL, FIXER_LABEL)}),
      /closed/,
    );
  });
  it('refuses an issue outside the owner queue', () => {
    assert.match(
      handoverRefusal({state: 'open', labels: L(FIXER_LABEL)}),
      /not an owner-queue issue/,
    );
  });
});
