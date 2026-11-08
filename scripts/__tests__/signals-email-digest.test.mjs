// @ai
// Tests for scripts/signals/email-digest.mjs: the weeks, the email from a
// snapshot, a missing section, the message format and the curl config. The data
// is synthetic.
/* global Buffer */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  collectByBuild,
  curlConfig,
  digest,
  fmt,
  message,
  recipients,
  weeksTo,
} from '../signals/email-digest.mjs';

// 35 days that end on Saturday 2026-10-24: five weeks of 7 days.
const days = Array.from({length: 35}, (_, i) =>
  new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10),
);
const ok = data => ({status: 'ok', source: 't', ms: 1, data});
const snap = () => ({
  dataThrough: '2026-10-24',
  sections: {
    active: ok({
      days,
      total: {
        dau: days.map((_, i) => (i < 28 ? 800 : 700)),
        wau: days.map((_, i) => 3000 + i),
        mau: days.map((_, i) => 8000 + i),
      },
    }),
    listens: ok({
      v1Before: {plays: 1000},
      days,
      total: {
        v1: days.map(() => 10),
        v2: days.map((_, i) => (i === 34 ? '<5' : 100)),
      },
      cumulative: {v1: [150], v2: [1400]},
    }),
    use: ok({
      days,
      daily: {
        meaningful_listen: {events: days.map(() => 2)},
        playback_completed: {events: days.map(() => 3)},
        mushaf_page_read: {events: days.map(() => 4)},
      },
    }),
    focus: ok({
      focus: {title: 'Android freezes under Google limit'},
      metric: {
        d28: 0.0198,
        daily: days.slice(-7).map(date => ({date, rate: 0.02})),
      },
    }),
  },
});
const byBuild = () => ({
  rows: [
    {
      platform: 'iOS',
      build: '1718',
      version: '3.2.1',
      people: [1, 2, 3, 4, 1621].map(n => (n < 5 ? '<5' : n)),
    },
  ],
  otherBuilds: 19,
  other: ['<5', 44, 44, 44, 44],
  journey: {
    opened: [2932, 1, 1, 1, 2],
    past_loading: [0, 0, 0, 0, 0],
    logged_in: [0, 0, 0, 0, 0],
    started: [0, 0, 0, 0, 0],
    used_it: [0, 0, 0, 0, 0],
  },
});

test('weeksTo: five blocks of 7 days that end at dataThrough', () => {
  const w = weeksTo('2026-10-31');
  assert.equal(w.length, 5);
  assert.deepEqual(w[0], {from: '2026-09-27', to: '2026-10-03'});
  assert.deepEqual(w[4], {from: '2026-10-25', to: '2026-10-31'});
});

test('digest: five weeks of each number, and the subject', () => {
  const {subject, text, html} = digest(snap(), byBuild());
  assert.equal(subject, 'Qariah weekly · 3,034 weekly active · 670 listens');
  assert.match(text, /Data through 2026-10-24/);
  assert.match(text, /Each line: Sep 20 · Sep 27 · Oct 4 · Oct 11 · Oct 18\n/);
  assert.match(text, /Daily: 800 · 800 · 800 · 800 · 700/);
  assert.match(text, /Weekly: 3,006 · 3,013 · 3,020 · 3,027 · 3,034/);
  // 1,000 + 150 + 1,400; a "<5" day adds nothing to its week
  assert.match(text, /2,550 listens since launch/);
  assert.match(text, /All listens: 770 · 770 · 770 · 770 · 670/);
  assert.match(text, /iOS 1718: <5 · <5 · <5 · <5 · 1,621/);
  assert.match(text, /19 other builds: <5 · 44 · 44 · 44 · 44/);
  assert.match(text, /Opened: 2,932/);
  assert.match(text, /Heard properly: 14 · 14 · 14 · 14 · 14/);
  assert.doesNotMatch(text, /Recitations/);
  assert.match(text, /Google’s score: — · — · — · — · 2\.00%/);
  assert.match(html, /limit 0\.47%; now 1\.98% \(28 days\)/);
  assert.match(html, /qariah-ops-console\.pages\.dev\/engagement/);
  assert.doesNotMatch(text, /WARNING|Sections not ok|^\*/m);
});

test('digest: a week with a known data gap is marked, and the note prints', () => {
  const s = snap();
  s.dataThrough = '2026-10-31';
  const {text, html} = digest(s, byBuild());
  assert.match(text, /Oct 18 · Oct 25\*\n/);
  assert.match(text, /PostHog stopped taking events from Oct 28/);
  assert.match(html, /Oct 25\*/);
  // The gap leaves the email with its week.
  const later = digest({...s, dataThrough: '2026-12-05'}, byBuild());
  assert.doesNotMatch(later.text, /PostHog stopped/);
});

test('digest: the people and listens groups name their unit', () => {
  const {text} = digest(snap(), byBuild());
  assert.match(text, /ACTIVE \(people\)\n/);
  assert.match(text, /LISTENS \(plays started\)\n/);
  assert.match(text, /v1 app: /);
  assert.match(text, /v2 app: /);
});

test('digest: a failed section prints its status, never a number', () => {
  const s = snap();
  s.sections.active = {status: 'error', source: 't', ms: 1, data: null};
  delete s.sections.use;
  s.sections.focus = {status: 'pending', source: 't', ms: 0, data: null};
  const {subject, text} = digest(s, {error: 'error'});
  assert.match(text, /ACTIVE \(people\)\n {2}— \(error\)/);
  assert.match(text, /USE \(events\)\n {2}— \(not in this file\)/);
  assert.match(text, /BUILDS \(people\)\n {2}— \(error\)/);
  assert.match(text, /FOCUS\n {2}— \(pending\)/);
  // A section that the job did not run is not a failed section.
  assert.match(text, /Sections not ok: active \(error\)\n/);
  assert.equal(subject, 'Qariah weekly · 670 listens');
});

test('digest: a partial focus is not a problem here; another partial is', () => {
  const s = snap();
  s.sections.focus.status = 'partial';
  assert.doesNotMatch(digest(s, byBuild()).text, /Sections not ok/);
  s.sections.listens.status = 'partial';
  assert.match(
    digest(s, byBuild()).text,
    /Sections not ok: listens \(partial\)/,
  );
});

test('digest: an HTML value is escaped', () => {
  const s = snap();
  s.sections.focus.data.focus.title = 'a <b> & c';
  assert.match(digest(s, byBuild()).html, /a &lt;b&gt; &amp; c/);
});

test('digest: a day with 0 people warns about the PostHog limit', () => {
  const s = snap();
  s.sections.active.data.total.dau[34] = 0;
  assert.match(digest(s, byBuild()).text, /WARNING: a day had 0 people/);
});

test('collectByBuild: over 50 in any week has a row; small counts are hidden', async () => {
  const seen = [];
  const ctx = {
    asOfSQL: 'true',
    hogql: async sql => {
      seen.push(sql);
      if (sql.includes('arrayJoin'))
        return [
          ['other', 7, 0, 0, 0, 0, 0],
          ['all', 200, 90, 3, 70, 60, 50],
        ];
      const week = seen.length - 1;
      return [
        ['iOS', '1718', '3.2.1', 10 + week * 20, 0, 0, 0, 0, 0],
        ['Android', '2027', '3.2.1', 3, 0, 0, 0, 0, 0],
        ['Android', '1', '1.0.0', 4, 0, 0, 0, 0, 0],
      ];
    },
  };
  const r = await collectByBuild(ctx, weeksTo('2026-10-31'));
  assert.deepEqual(
    r.rows.map(b => [b.key, b.people]),
    [['iOS-1718', [10, 30, 50, 70, 90]]],
  );
  assert.equal(r.otherBuilds, 2);
  assert.deepEqual(r.other, [7, 7, 7, 7, 7]);
  assert.deepEqual(r.journey.opened, [90, 90, 90, 90, 90]);
  assert.deepEqual(r.journey.past_loading, Array(5).fill('<5'));
  assert.equal(seen.length, 10);
});

test('fmt keeps "<5" and never turns an unknown value into a number', () => {
  assert.equal(fmt(1234), '1,234');
  assert.equal(fmt(0), '0');
  assert.equal(fmt('<5'), '<5');
  assert.equal(fmt(null), '—');
  assert.equal(fmt(undefined), '—');
});

test('message: headers, an encoded subject and a text and an HTML part', () => {
  const m = message({
    from: 'a@example.com',
    to: ['b@example.com', 'c@example.com'],
    subject: 'Qariah · 1',
    text: 'héllo',
    html: '<b>héllo</b>',
    date: new Date('2026-11-01T00:00:00Z'),
  });
  assert.match(m, /^From: Qariah metrics <a@example\.com>\r\n/);
  assert.match(m, /\r\nTo: b@example\.com, c@example\.com\r\n/);
  assert.ok(
    m.includes(
      `Subject: =?UTF-8?B?${Buffer.from('Qariah · 1').toString('base64')}?=`,
    ),
  );
  assert.match(m, /Content-Type: multipart\/alternative; boundary="[^"]+"\r\n/);
  assert.ok(m.indexOf('text/plain') < m.indexOf('text/html'));
  assert.ok(m.includes(Buffer.from('héllo').toString('base64')));
  assert.ok(m.includes(Buffer.from('<b>héllo</b>').toString('base64')));
  assert.match(m, /--qariah-weekly-part--\r\n$/);
});

test('curlConfig: every recipient, TLS required, the password escaped', () => {
  const c = curlConfig({
    from: 'a@x.org',
    password: 'p"w\\d',
    to: ['b@x.org', 'c@x.org'],
  });
  assert.ok(c.includes('user = "a@x.org:p\\"w\\\\d"'));
  assert.ok(c.includes('ssl-reqd'));
  assert.ok(c.includes('mail-rcpt = "b@x.org"'));
  assert.ok(c.includes('mail-rcpt = "c@x.org"'));
});

test('recipients splits a list and drops empties', () => {
  assert.deepEqual(recipients('a@x.org, b@x.org;c@x.org '), [
    'a@x.org',
    'b@x.org',
    'c@x.org',
  ]);
  assert.deepEqual(recipients(undefined), []);
});
