// @ai
//
// scripts/lib/pipeline-flow.mjs
// -----------------------------
// The detail of each step on the ops console's Pipeline page (the owner's mock
// of 2026-11-08): the last runs, the queue, the "why", the "what unblocks it",
// the rule, the owner-queue details (the "do" text, the reply texts, "not
// before", the step that it blocks), the builds in the stores, and the
// rollout of each platform. scripts/lib/pipeline-status.mjs calls these
// functions; it keeps the verdicts. No I/O here:
// scripts/__tests__/pipeline-flow.test.mjs covers every rule.

const HOUR = 36e5;
const DAY = 864e5;
const TZ = 'America/Los_Angeles';

// ---------------------------------------------------------------------------
// Time, in the owner's time zone
// ---------------------------------------------------------------------------

function laParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map(p => [p.type, p.value]),
  );
}

/** "11-07": the month and the day in Los Angeles (not in UTC). */
export function ptDay(iso) {
  const p = iso ? laParts(iso) : null;
  return p ? `${p.month}-${p.day}` : '';
}

/** "11-07 21:34": the date and the time in Los Angeles. */
export function ptWhen(iso) {
  const p = iso ? laParts(iso) : null;
  return p ? `${p.month}-${p.day} ${p.hour}:${p.minute}` : '';
}

/** "7 h" under two days, else "147 days". */
export function ageText(iso, now) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const h = Math.max(0, Math.floor((now - t) / HOUR));
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** "today", "1 day", "4 days": the age of a build, by calendar day in Los Angeles. */
export function dayAge(iso, now) {
  const a = laParts(iso || '');
  const b = laParts(new Date(now).toISOString());
  if (!a || !b) return '';
  const d = Math.round(
    (Date.UTC(+b.year, +b.month - 1, +b.day) -
      Date.UTC(+a.year, +a.month - 1, +a.day)) /
      DAY,
  );
  if (d <= 0) return 'today';
  return d === 1 ? '1 day' : `${d} days`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const labelsOf = x =>
  (x.labels || []).map(l => (typeof l === 'string' ? l : l.name));

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function links(repo) {
  const gh = `https://github.com/${repo}`;
  return {
    issue: n => `${gh}/issues/${n}`,
    pull: n => `${gh}/pull/${n}`,
    issues: q =>
      `${gh}/issues?q=${encodeURIComponent(`is:open is:issue ${q}`.trim())}`,
    pulls: q => `${gh}/pulls?q=${encodeURIComponent(`is:pr ${q}`.trim())}`,
  };
}

// ---------------------------------------------------------------------------
// Run rows
// ---------------------------------------------------------------------------

/** The note of a run line: "build 3953 · 11 calls · 1 min". */
export function runNote(l, {build = true} = {}) {
  return [
    build && l.build ? `build ${l.build}` : null,
    l.toolCalls && l.toolCalls !== 'unknown' ? `${l.toolCalls} calls` : null,
    l.minutes && l.minutes !== 'unknown' && l.minutes !== '0'
      ? `${l.minutes} min`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One row of a "Last run" list. */
export const runEntry = ({at, name, note = '', result, url = ''}) => ({
  at,
  when: ptWhen(at),
  name,
  note,
  result,
  url,
});

// ---------------------------------------------------------------------------
// Audit verdicts
// ---------------------------------------------------------------------------

const VERDICT_TAGS = [
  ['disk floor', /disk floor|disk-floor|GB free/i],
  ['test iPhone', /test iPhone|Setup Assistant|iPhone gates did not run/i],
  ['release notes', /release notes|changelog\.json/i],
  ['field health', /Gate 6[^|\n]*FAIL|field health[^|\n]*FAIL/i],
];

const clean = s =>
  String(s || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The sentences of a report after "Verdict: NOT READY." (or READY), to its paragraph end. */
function verdictSentence(body) {
  const t = String(body || '');
  const m = t.match(
    /Verdict:\s*\**\s*(?:NOT READY|READY)\.?\**\s*\.?\s*([^\n]+)/i,
  );
  return m ? clean(m[1]) : '';
}

/**
 * Why an audit gave its verdict, from the body of its `release-audit:` comment.
 * → {text, tags, issues}
 *   text    a short reason: "Disk floor: 17 GB free, 28 GB needed"
 *   tags    the known reasons: "disk floor", "test iPhone", "release notes"
 *   issues  the issue numbers of the section "What Omar must do", else of the findings
 */
export function auditReason(body) {
  const t = String(body || '');
  const lead = verdictSentence(t);
  const tags = VERDICT_TAGS.filter(([, re]) => re.test(lead || t)).map(
    ([k]) => k,
  );
  let text = '';
  if (tags[0] === 'disk floor') {
    const g = (lead + ' ' + t).match(/(\d+)\s*GB free[^\n]{0,60}?(\d+)\s*GB/i);
    text = g
      ? `Disk floor: ${g[1]} GB free, ${g[2]} GB needed`
      : 'Disk floor: the Mac had too little free space to build';
  } else if (tags[0] === 'test iPhone') {
    text = /Setup Assistant/i.test(t)
      ? 'Test iPhone stuck in Setup Assistant'
      : 'The test iPhone gates did not run';
  } else if (tags[0] === 'release notes') {
    const v = lead.match(/no (\d+\.\d+\.\d+) entry/i);
    text = v ? `No ${v[1]} release notes` : 'Release notes missing';
  } else if (lead) {
    text = lead.split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  }
  if (text.length > 120) text = `${text.slice(0, 117)}…`;
  const section = name => {
    const m = t.match(
      new RegExp(
        `^##[^\\n]*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`,
        'im',
      ),
    );
    return m ? m[1] : '';
  };
  const nums = s => [
    ...new Set((s.match(/#(\d{2,6})\b/g) || []).map(x => Number(x.slice(1)))),
  ];
  let issues = nums(section('What Omar must do'));
  if (!issues.length) {
    const f1 = t.match(/^-\s*F1\b[^\n]*/m);
    issues = f1 ? nums(f1[0]) : [];
  }
  return {text, tags, issues};
}

// ---------------------------------------------------------------------------
// The owner queue: the details of one item
// ---------------------------------------------------------------------------

/** The stage that each run writes for: an item of that run blocks these steps. */
export const BLOCKS_BY_RUN = {
  triage: ['triage'],
  drafts: ['fix'],
  autoSprint: ['integrate'],
  auditor: ['audit', 'promote'],
  promoter: ['promote'],
};
const STEP_KEYS = [
  'collect',
  'triage',
  'steward',
  'fix',
  'integrate',
  'audit',
  'go',
  'promote',
  'ramp',
  'close',
];

/** The exact reply texts: "granted | pasted" → [{text: 'granted'}, {text: 'pasted'}]. */
export function parseReplies(reply) {
  const first = String(reply || '')
    .split('\n')[0]
    .trim();
  if (!first) return [];
  return first
    .split(/\s+\|\s+/)
    .map(part => {
      let text = part.trim().replace(/^`|`$/g, '');
      let note = '';
      const m = text.match(/^(.*?)\s*\((.+)\)\s*$/);
      if (m && m[1]) {
        text = m[1].trim();
        note = m[2].trim();
      }
      return note ? {text, note} : {text};
    })
    .filter(r => r.text);
}

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const FIELD = name => new RegExp(`^-\\s*${name}\\s*:\\s*(.+?)\\s*$`, 'im');

/** A `- not-before:` value or a "When:" line → {text, build, date}. */
export function parseNotBefore(raw) {
  const text = clean(raw);
  if (!text) return null;
  const out = {text, build: null, date: null};
  let m = text.match(/^build\s*>\s*(\d{3,6})$/i);
  if (m) out.build = Number(m[1]);
  else if (/^\d{4}-\d{2}-\d{2}/.test(text)) out.date = text.slice(0, 25);
  else if ((m = text.match(/\babove\b(?:[^.]|\.(?=\d))*?\b(\d{4,6})\b/i)))
    out.build = Number(m[1]);
  return out;
}

/**
 * The parts of an owner-queue body that the page shows. A body may carry the
 * fields `- do:`, `- not-before:` and `- blocks:` (scripts/owner-queue.mjs
 * ask --do --not-before --blocks); an older body gives them by its headings.
 * → {why, do, notBefore, blocks}
 */
export function queueDetail(body, {run = null} = {}) {
  const t = String(body || '').replace(/\r/g, '');
  const field = name => {
    const m = t.match(FIELD(name));
    return m ? m[1] : '';
  };
  const line = re => {
    const m = t.match(re);
    return m ? clean(m[1]) : '';
  };
  const why =
    line(/^\*\*Impact:\*\*\s*(.+)$/m) ||
    line(/^Impact:\s*(.+)$/m) ||
    line(/^Effect:\s*(.+)$/m) ||
    '';
  let todo = clean(field('do'));
  if (!todo) todo = line(/^(?:\*\*)?(?:Fix|Do):(?:\*\*)?\s*(.+)$/m);
  if (!todo && /^\*\*Do one of these:?\*\*/m.test(t)) {
    const opts = [...t.matchAll(/^\d+\.\s*\*\*([^*]+)\*\*/gm)].map(m =>
      clean(m[1]).replace(/\.$/, ''),
    );
    if (opts.length)
      todo = opts
        .map((o, k) =>
          k === 0 || /^or\b/i.test(o)
            ? o
            : `Or ${o.charAt(0).toLowerCase()}${o.slice(1)}`,
        )
        .map(o => `${o}.`)
        .join(' ');
  }
  if (!todo) {
    // The first bold lead of a line that is not a label ("**Impact:**").
    for (const m of t.matchAll(/^\*\*([^*\n]+?)\*\*(\s*:)?/gm)) {
      if (m[2] || /:$/.test(m[1].trim())) continue;
      todo = clean(m[1]);
      break;
    }
  }
  const notBefore = parseNotBefore(
    field('not-before') ||
      line(/^\*\*When:\*\*\s*(.+)$/m) ||
      line(/^When:\s*(.+)$/m),
  );
  const listed = field('blocks')
    .split(/[\s,]+/)
    .map(s => s.toLowerCase())
    .filter(k => STEP_KEYS.includes(k));
  const blocks = listed.length ? listed : BLOCKS_BY_RUN[run] || [];
  return {why: cap(why) || null, do: cap(todo) || null, notBefore, blocks};
}

/** True when the "not before" condition holds now; null when the page cannot tell. */
export function notBeforeReady(nb, {now, newestInternal}) {
  if (!nb) return true;
  if (nb.build != null)
    return newestInternal != null ? Number(newestInternal) > nb.build : null;
  if (nb.date) {
    const t = Date.parse(nb.date);
    return Number.isNaN(t) ? null : now >= t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The stores: the internal and the public betas
// ---------------------------------------------------------------------------

const IOS_PUBLIC = {
  WAITING_FOR_BETA_REVIEW: 'waits for beta review',
  IN_BETA_REVIEW: 'in beta review',
  BETA_APPROVED: 'approved',
  IN_BETA_TESTING: 'in testing',
  BETA_REJECTED: 'rejected',
};
const PLAY_STATUS = {
  completed: 'live',
  inProgress: 'rolling out',
  halted: 'halted',
  draft: 'draft',
};

/**
 * The internal and the public betas that the stores have, newest first.
 * store = {readAt, ios: {app: [b], beta: [b]}, android: {internal: [r], beta: [r]}, errors}
 *   b = {build, version, uploadedAt, internal, external, expired}
 *   r = {versionCodes, status, name}
 * `lines` and `events` mark a build that the auto-sprint or the Promoter made;
 * any other build was made by hand.
 * → {internal: [x], public: [x], readAt, errors}
 *   x = {build, version, at, ios, android, by: 'auto-sprint'|'Promoter'|'hand'}
 */
export function storeBuilds(store, {lines = [], events = []} = {}) {
  const auto = new Set(
    lines
      .filter(l => l.task === 'autoSprint' && l.status === 'DONE' && l.build)
      .map(l => String(l.build)),
  );
  const promoted = new Set(
    events
      .filter(e => e.kind === 'promotion' && e.action === 'public-beta')
      .map(e => String(e.build)),
  );
  const versions = {};
  for (const b of [...(store?.ios?.app || []), ...(store?.ios?.beta || [])])
    if (b.build && b.version) versions[b.build] = b.version;
  const collect = (iosList, iosOk, iosText, track) => {
    const by = new Map();
    const get = build => {
      const k = String(build);
      if (!by.has(k))
        by.set(k, {
          build: k,
          version: versions[k] || null,
          at: null,
          ios: null,
          android: null,
        });
      return by.get(k);
    };
    for (const b of iosList || []) {
      if (b.expired || !iosOk(b)) continue;
      const x = get(b.build);
      x.ios = iosText(b);
      x.at = b.uploadedAt || x.at;
    }
    for (const r of track || []) {
      if (!r.status || r.status === 'draft') continue;
      for (const vc of r.versionCodes || [])
        get(vc).android = PLAY_STATUS[r.status] || r.status;
    }
    return [...by.values()].sort((a, b) => Number(b.build) - Number(a.build));
  };
  const internal = collect(
    store?.ios?.beta,
    b => b.internal === 'IN_BETA_TESTING',
    () => 'in internal testing',
    store?.android?.internal,
  ).map(x => ({...x, by: auto.has(x.build) ? 'auto-sprint' : 'hand'}));
  const pub = collect(
    store?.ios?.app,
    b => Boolean(IOS_PUBLIC[b.external]),
    b => IOS_PUBLIC[b.external],
    store?.android?.beta,
  ).map(x => ({...x, by: promoted.has(x.build) ? 'Promoter' : 'hand'}));
  return {
    internal: internal.slice(0, 4),
    public: pub.slice(0, 4),
    readAt: store?.readAt || null,
    errors: store?.errors || [],
  };
}

/** "3.2.5 (4406)", or "4406" when the version is not known. */
export const buildRef = x =>
  x.version ? `${x.version} (${x.build})` : String(x.build);

/** "TestFlight: in beta review · Play beta track: live". */
export function storeText(x, {ios = 'TestFlight', android = 'Play'} = {}) {
  return [
    x.ios ? `${ios}: ${x.ios}` : null,
    x.android ? `${android}: ${x.android}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// The rollout of each platform
// ---------------------------------------------------------------------------

const firstWord = s => {
  const m = String(s || '').match(/^[A-Z][A-Z_]+/);
  return m ? m[0] : null;
};
// Apple's phased release: the share of users on each day (fixed by Apple).
export const PHASED_DAYS = [1, 2, 5, 10, 20, 50, 100];

/**
 * The rollout of each platform: active-rollout.json gives the version and the
 * build; the Rollout lines of the newest card give the live text.
 * → {active, release, startedAt, ios, android}
 */
export function rolloutPlatforms(rollout, card) {
  const r = rollout || {};
  const live = card?.rollout || [];
  const lineFor = name =>
    live.find(l => l.toLowerCase().startsWith(name.toLowerCase())) || null;
  const iosAll = Object.values(r.platforms?.ios || {}).filter(
    v =>
      v &&
      typeof v === 'object' &&
      v.version &&
      /^\d+$/.test(String(v.build || '')),
  );
  const iosCur =
    iosAll.sort((a, b) => Number(b.build) - Number(a.build))[0] || null;
  let ios = null;
  if (iosCur || lineFor('iOS')) {
    const line = lineFor('iOS');
    const lm = line ? line.match(/^iOS\s+(\d+\.\d+\.\d+)\s+\((\d+)\)/) : null;
    const day =
      line?.match(/\bday\s+(\d)\b/i) ||
      String(iosCur?.phasedRelease || '').match(/\bday\s+(\d)\b/i);
    const phased = /\bPAUSED\b/i.test(line || '')
      ? 'PAUSED'
      : /\bACTIVE\b/i.test(line || '') ||
          /\bACTIVE\b/.test(String(iosCur?.phasedRelease || ''))
        ? 'ACTIVE'
        : /COMPLETE/i.test(line || '')
          ? 'COMPLETE'
          : null;
    ios = {
      version: lm ? lm[1] : iosCur?.version || null,
      build: lm ? lm[2] : String(iosCur?.build || '') || null,
      state: firstWord(iosCur?.state),
      phased,
      day: day ? Number(day[1]) : null,
      percent: day ? (PHASED_DAYS[Number(day[1]) - 1] ?? null) : null,
      line,
    };
  }
  const a = r.platforms?.android?.current || null;
  let android = null;
  if (a || lineFor('Android')) {
    const line = lineFor('Android');
    const fraction = a?.userFraction != null ? Number(a.userFraction) : null;
    android = {
      versionCode: a?.versionCode != null ? String(a.versionCode) : null,
      version:
        a && String(a.versionCode) === String(r.build)
          ? r.release || null
          : null,
      status: a?.status || null,
      percent:
        fraction != null && !Number.isNaN(fraction)
          ? Math.round(fraction * 100)
          : null,
      since: a?.since || null,
      line,
    };
  }
  return {
    active: Boolean(r.active),
    release: r.release || null,
    startedAt: r.startedAt || null,
    ios,
    android,
  };
}

/** "iOS 3.2.4 (3774) phased day 1 · Android vc3763 100 %". */
export function rolloutSub(p) {
  const parts = [];
  if (p.ios) {
    const phase =
      p.ios.phased === 'PAUSED'
        ? `paused at day ${p.ios.day ?? '?'}`
        : p.ios.day
          ? `phased day ${p.ios.day}`
          : (p.ios.state || '').toLowerCase().replace(/_/g, ' ');
    parts.push(`iOS ${p.ios.version} (${p.ios.build}) ${phase}`.trim());
  }
  if (p.android)
    parts.push(
      `Android vc${p.android.versionCode} ${
        p.android.percent != null
          ? `${p.android.percent} %`
          : p.android.status || ''
      }`.trim(),
    );
  return parts.join(' · ') || 'no rollout';
}

/** The LA date when the iOS phased release reaches 100 %, if nobody pauses it. */
export function iosFullDate(p, cardDate) {
  if (!p.ios || p.ios.phased !== 'ACTIVE' || !p.ios.day || !cardDate)
    return null;
  const t = Date.parse(`${cardDate}T12:00:00Z`) + (7 - p.ios.day) * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Close: the fixed issues by build
// ---------------------------------------------------------------------------

/** → [{build, count, issues: [{number, title}]}], the most issues first. */
export function fixedByBuild(issues) {
  const by = new Map();
  for (const i of issues) {
    for (const l of labelsOf(i)) {
      const m = l.match(/^fixed-in:(\d+)$/);
      if (!m) continue;
      if (!by.has(m[1])) by.set(m[1], []);
      by.get(m[1]).push({number: i.number, title: i.title});
    }
  }
  return [...by.entries()]
    .map(([build, list]) => ({
      build,
      count: list.length,
      issues: list.sort((a, b) => b.number - a.number),
    }))
    .sort((a, b) => b.count - a.count || Number(b.build) - Number(a.build));
}

/** The largest `incident:<group>` label among the issues → {group, count} or null. */
export function biggestGroup(issues) {
  const n = {};
  for (const i of issues)
    for (const l of labelsOf(i))
      if (l.startsWith('incident:')) n[l.slice(9)] = (n[l.slice(9)] || 0) + 1;
  const [group, count] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [];
  return group ? {group, count} : null;
}

export {plural, labelsOf, clean};
