#!/usr/bin/env node
// @ai
//
// scripts/triage-lifecycle.mjs
// ----------------------------
// Auto-lifecycle for the bot-filed issue corpus — the missing third leg the
// 5-expert review flagged (collectors FILE, nothing CLOSES, nothing REOPENS).
//
// Three idempotent, --dry-run-able sub-passes over auto-filed issues. Each
// re-queries the issue's ORIGINAL source (recovered from the embedded dedup
// marker) for recency:
//
//   1. resolve-on-quiet   open issue whose source signal has had ZERO events in
//                         the last --quiet-days (default 10) → comment + close.
//   2. close-on-fix       open issue carrying a `fixed-in:<versionCode>` marker/
//                         label whose signal is quiet on builds >= that version
//                         → close with the fix reference.
//   3. reopen-on-recurrence  CLOSED auto-filed issue whose SAME signature
//                         reappears in the source with lastSeen AFTER the
//                         issue's closedAt, on a NEWER build → reopen (this is
//                         what catches QARIAHV2-P, the silently-recurred MMKV
//                         App-Group fatal closed as #69).
//
// Sources covered for recency re-query: Sentry (lastSeen + status), Play vitals
// (lastErrorReportTime + lastAppVersion.versionCode). The user-voice lanes
// (reviews / TestFlight feedback) are immutable point-in-time submissions — a
// review doesn't "go quiet" — so they are NOT auto-closed here (a human closes
// a review issue when the underlying bug is fixed). PostHog markers are
// version-keyed and don't expose a per-marker lastSeen cheaply, so PostHog
// issues are only eligible for resolve-on-quiet via a fault-event recency query
// (best-effort; skipped if the query is unavailable).
//
// SAFETY: only ever touches issues that carry a lane dedup marker (never a
// hand-authored issue), and never an issue that is an `incident` umbrella.
// Comments a reason on every issue it closes/reopens. Re-running is a no-op once
// the signal state is unchanged.
//
//   set -a && source .env.local && set +a
//   node scripts/triage-lifecycle.mjs --dry-run            # print the plan, change nothing
//   node scripts/triage-lifecycle.mjs                      # apply
//   node scripts/triage-lifecycle.mjs --pass=resolve-on-quiet --quiet-days=14
//
// Flags:
//   --dry-run                 print the plan; close/reopen/comment nothing
//   --pass=NAME[,NAME]        run only these passes (default: all three)
//                             names: resolve-on-quiet, close-on-fix, reopen-on-recurrence
//   --quiet-days=10           a signal is "quiet" if no events in the last N days
//   --max-close=20            safety cap on closes per run
//   --max-reopen=10           safety cap on reopens per run
//   --limit=300               issues to scan per state
//   --help
//
// Env:  SENTRY_READ_TOKEN, GOOGLE_PLAY_SA_JSON|GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
//       GH_REPO, GH_TOKEN

/* global Buffer */
import crypto from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {GH_REPO, gh, loadIssueCorpus} from './lib/incident-knowledge.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (flag('help')) {
  console.log(
    [
      'Usage: node scripts/triage-lifecycle.mjs [--dry-run] [--pass=resolve-on-quiet,close-on-fix,reopen-on-recurrence]',
      '                                         [--quiet-days=10] [--max-close=20] [--max-reopen=10] [--limit=300]',
      '',
      'Auto-closes quiet signals, closes on a recorded fixed-in:<vc>, and reopens',
      'closed issues whose signature recurs on a newer build. Idempotent + dry-run-safe.',
      'Env: SENTRY_READ_TOKEN, GOOGLE_PLAY_SA_JSON, GH_REPO, GH_TOKEN.',
    ].join('\n'),
  );
  process.exit(0);
}

const DRY_RUN = flag('dry-run');
const QUIET_DAYS = Math.max(1, parseInt(opt('quiet-days', '10'), 10) || 10);
const MAX_CLOSE = parseInt(opt('max-close', '20'), 10) || 20;
const MAX_REOPEN = parseInt(opt('max-reopen', '10'), 10) || 10;
const LIMIT = parseInt(opt('limit', '300'), 10) || 300;
// Passes: resolve-on-quiet, close-on-fix, reopen-on-recurrence (all by default).
const PASSES = (opt('pass', '') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const RUN = name => PASSES.length === 0 || PASSES.includes(name);

const now = Date.now();
const quietCutoff = now - QUIET_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Source recency adapters. Each returns a map keyed by the source's id →
// { lastSeenMs, status, users, ... }. Built lazily + cached so a pass that
// only touches Sentry never mints a Play token. Play's entries carry
// `newestVersionCode` directly — it's free, already in the bulk response
// (Play's own `lastAppVersion`/`firstAppVersion` rolls forward as new events
// land under the same aggregated errorIssue). Sentry's bulk issues-list
// response carries NO release info at all, so its entries carry `id` (the
// issue's internal numeric id) instead; `sentryReleaseVersionCode(id)`
// (below, near `fixedInVersion`) resolves the versionCode lazily, per-issue,
// only when the reopen-on-recurrence pass actually needs it.
// ---------------------------------------------------------------------------
let _sentryIndex = null;
async function sentryIndex() {
  if (_sentryIndex) return _sentryIndex;
  const TOKEN = process.env.SENTRY_READ_TOKEN;
  const ORG = process.env.SENTRY_ORG || 'qariah';
  const PROJECT = process.env.SENTRY_PROJECT || 'qariahv2';
  const HOST = (
    process.env.SENTRY_REGION_HOST || 'https://de.sentry.io'
  ).replace(/\/$/, '');
  const idx = {};
  if (!TOKEN) {
    console.warn(
      '  ⚠ SENTRY_READ_TOKEN unset — Sentry recency unavailable (Sentry issues skipped).',
    );
    return (_sentryIndex = idx);
  }
  // Pull all issues across statuses in a 14d window (covers the quiet horizon)
  // AND a wider one so closed-but-recurred issues are visible.
  for (const period of ['14d', '90d']) {
    for (const q of ['is:unresolved', 'is:resolved', 'is:ignored']) {
      let url = `${HOST}/api/0/projects/${ORG}/${PROJECT}/issues/?statsPeriod=${period}&query=${encodeURIComponent(
        q,
      )}&limit=100&sort=date`;
      try {
        const res = await fetch(url, {
          headers: {Authorization: `Bearer ${TOKEN}`},
        });
        if (!res.ok) continue;
        const list = await res.json();
        for (const i of list) {
          const prev = idx[i.shortId];
          const lastSeenMs = Date.parse(i.lastSeen) || 0;
          if (!prev || lastSeenMs > prev.lastSeenMs) {
            idx[i.shortId] = {
              id: i.id,
              lastSeenMs,
              status: i.status,
              users: i.userCount || 0,
            };
          }
        }
      } catch {
        /* best-effort */
      }
    }
  }
  return (_sentryIndex = idx);
}

let _playIndex = null;
async function playIndex() {
  if (_playIndex) return _playIndex;
  const idx = {};
  let sa;
  try {
    const raw = process.env.GOOGLE_PLAY_SA_JSON;
    sa =
      raw && raw.trim()
        ? JSON.parse(raw)
        : JSON.parse(
            readFileSync(
              process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
                join(homedir(), '.android', 'play-service-account.json'),
              'utf8',
            ),
          );
  } catch (e) {
    console.warn(
      `  ⚠ Play SA unavailable — Play recency unavailable (Play issues skipped): ${e.message}`,
    );
    return (_playIndex = idx);
  }
  try {
    const b64u = o =>
      Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
        'base64url',
      );
    const t = Math.floor(Date.now() / 1000);
    const unsigned =
      b64u({alg: 'RS256', typ: 'JWT'}) +
      '.' +
      b64u({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
        aud: 'https://oauth2.googleapis.com/token',
        exp: t + 3600,
        iat: t,
      });
    const sig = crypto
      .createSign('RSA-SHA256')
      .update(unsigned)
      .sign(sa.private_key)
      .toString('base64url');
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${sig}`,
      }),
    });
    const token = (await tr.json()).access_token;
    if (!token) throw new Error('token mint failed');
    const PKG = process.env.PLAY_PACKAGE || 'com.qariah.app';
    // Pull a generous page; the lifecycle pass needs the recency, not the cap.
    const res = await fetch(
      `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PKG}/errorIssues:search?pageSize=100`,
      {headers: {Authorization: `Bearer ${token}`}},
    );
    const data = await res.json();
    for (const i of data.errorIssues || []) {
      const id = String(i.name || '')
        .split('/')
        .pop();
      idx[id] = {
        lastSeenMs: Date.parse(i.lastErrorReportTime) || 0,
        newestVersionCode:
          Number(
            i.lastAppVersion?.versionCode ?? i.firstAppVersion?.versionCode,
          ) || 0,
        users: Number(i.distinctUsers) || 0,
      };
    }
  } catch (e) {
    console.warn(
      `  ⚠ Play recency query failed (Play issues skipped): ${e.message}`,
    );
  }
  return (_playIndex = idx);
}

// Recency for one issue, from its marker. Returns null if the source isn't
// queryable / the id isn't found (caller decides how to treat "unknown").
async function recencyFor(marker) {
  if (!marker) return null;
  if (marker.source === 'sentry') {
    const idx = await sentryIndex();
    return idx[marker.id] || null;
  }
  if (marker.source === 'play-vitals') {
    const idx = await playIndex();
    return idx[marker.id] || null;
  }
  // posthog / user-voice lanes: no cheap per-marker recency.
  return null;
}

// Is this lane eligible for resolve-on-quiet at all? Only the telemetry lanes
// whose signal can genuinely "go quiet" (a review is a fixed past event).
const QUIET_ELIGIBLE = new Set(['sentry', 'play-vitals']);

function ghClose(num, comment) {
  if (DRY_RUN) return;
  // Comment first (so the reason survives even if close races), then close.
  gh(['issue', 'comment', String(num), '--repo', GH_REPO, '--body', comment]);
  gh([
    'issue',
    'close',
    String(num),
    '--repo',
    GH_REPO,
    '--reason',
    'completed',
  ]);
}
function ghReopen(num, comment) {
  if (DRY_RUN) return;
  gh(['issue', 'reopen', String(num), '--repo', GH_REPO]);
  gh(['issue', 'comment', String(num), '--repo', GH_REPO, '--body', comment]);
}

// Recover a recorded fixed-in versionCode from a `fixed-in:<vc>` label or a
// `<!-- fixed-in:<vc> -->` marker in the body.
function fixedInVersion(issue) {
  const lbl = (issue.labels || []).find(l => /^fixed-in:\d+$/.test(l));
  if (lbl) return Number(lbl.split(':')[1]);
  const m = (issue.body || '').match(/fixed-in:(\d+)/);
  return m ? Number(m[1]) : null;
}

// Parse a versionCode out of a Qariah Sentry release string
// ("com.qariah.app@3.1.8+1518" → 1518). Both platforms tag releases
// `<bundleId>@<marketing>+<versionCode>` (see CLAUDE.md's release/dist notes;
// confirmed live against #164/QARIAHV2-G's own "Release:" breakdown).
export function parseVersionCodeFromRelease(value) {
  const m = String(value || '').match(/\+(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// Lazily resolves the versionCode of the MOST RECENT event on a Sentry issue
// (keyed by the issue's internal numeric id, NOT its shortId) via the same
// per-issue tags/release endpoint scripts/sentry-triage.mjs already uses for
// its release breakdown — the bulk issues-list query (sentryIndex, above)
// carries no release info at all, so this is the cheapest available source.
// Picks the release value with the latest `lastSeen` in `topValues` (NOT
// topValues[0], which Sentry orders by event COUNT — the most-frequent
// release on an issue isn't necessarily the most-recent one). Memoized per
// id; best-effort — returns null (unknown) on any failure, matching this
// file's degrade-gracefully style elsewhere (missing token, network error,
// non-200, empty topValues all resolve to "unknown", never a thrown error).
//
// Only called from the reopen-on-recurrence pass below, and only for issues
// that already cleared the recurrence-after-close gate AND carry a
// `fixed-in` marker — a handful of calls per run, not a fan-out over the
// whole Sentry index.
const _sentryReleaseCache = new Map();
export async function sentryReleaseVersionCode(sentryIssueId) {
  if (!sentryIssueId) return null;
  if (_sentryReleaseCache.has(sentryIssueId))
    return _sentryReleaseCache.get(sentryIssueId);
  const TOKEN = process.env.SENTRY_READ_TOKEN;
  const ORG = process.env.SENTRY_ORG || 'qariah';
  const HOST = (
    process.env.SENTRY_REGION_HOST || 'https://de.sentry.io'
  ).replace(/\/$/, '');
  let vc = null;
  if (TOKEN) {
    try {
      const res = await fetch(
        `${HOST}/api/0/organizations/${ORG}/issues/${sentryIssueId}/tags/release/?statsPeriod=14d`,
        {headers: {Authorization: `Bearer ${TOKEN}`}},
      );
      if (res.ok) {
        const data = await res.json();
        let newest = null;
        let newestTs = -Infinity;
        for (const v of data.topValues || []) {
          const ts = Date.parse(v.lastSeen);
          if (!Number.isNaN(ts) && ts > newestTs) {
            newest = v;
            newestTs = ts;
          }
        }
        vc = newest ? parseVersionCodeFromRelease(newest.value) : null;
      }
    } catch {
      /* best-effort — falls through as "unknown build", the conservative case */
    }
  }
  _sentryReleaseCache.set(sentryIssueId, vc);
  return vc;
}

// Same-day close + lingering-event tolerance for reopen-on-recurrence, below.
const GRACE_MS = 24 * 60 * 60 * 1000;

// Recurrence-vs-fix decision for reopen-on-recurrence — pulled out to a pure
// function (no I/O) so it is unit-testable directly; see
// scripts/__tests__/triage-lifecycle-reopen.test.mjs. Both source lanes
// (Sentry + Play) funnel through this ONE decision so they can't drift apart
// the way they did for TECH_DEBT #172 (the Sentry lane silently reopened
// without ever checking the recurrence event's build against `fixed-in`).
//
//   lastSeenMs / closedAtMs — recency of the source signal vs. the issue's close.
//   fixedInVc    — the recorded `fixed-in:<vc>` for this issue (falsy if none
//                  was ever recorded — e.g. issues closed via resolve-on-quiet
//                  never carry one).
//   recurrenceVc — the versionCode the RECURRENCE event itself happened on
//                  (falsy when it couldn't be resolved for this source/run).
//
// A signature reappearing after close is only a REAL recurrence of the FIXED
// bug if it happened on a build at/after the fix. When we can positively
// resolve the recurrence's build AND it is older than fixed-in, it's a
// pre-fix straggler — e.g. #164/QARIAHV2-G: a Xiaomi Redmi lingering on
// stale builds 1353/1508 (both < the 1518 fix) mechanically reopened a
// genuinely-fixed issue. Leave it closed. A falsy fixedInVc or recurrenceVc
// means we CAN'T prove it's stale — stay conservative and reopen (this is
// the pre-existing behaviour; "unknown" never newly suppresses a reopen).
export function shouldReopen({
  lastSeenMs,
  closedAtMs,
  fixedInVc,
  recurrenceVc,
  graceMs = GRACE_MS,
} = {}) {
  if (!lastSeenMs || !closedAtMs) return {reopen: false, reason: 'no-recency'};
  if (lastSeenMs <= closedAtMs + graceMs)
    return {reopen: false, reason: 'not-recurred'};
  if (fixedInVc && recurrenceVc && recurrenceVc < fixedInVc) {
    return {reopen: false, reason: 'stale-build'};
  }
  return {reopen: true, reason: 'recurred'};
}

const fmtDate = ms =>
  ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown';

// ---------------------------------------------------------------------------
// Triage state ledger (docs/operations/triage-state.md) — the human-edited
// record of deliberate decisions the auto-passes must respect so they never
// undo intentional work. Section titles are matched by substring (punctuation-
// tolerant); a missing file degrades to empty state (prior behaviour).
//   • Pinned open  → resolve-on-quiet never closes these
//   • Fixed in build → close-on-fix gets the versionCode even without a label
//   • Do not reopen → reopen-on-recurrence never reopens these
// ---------------------------------------------------------------------------
function loadTriageState() {
  const PINNED_OPEN = new Set();
  const NO_REOPEN = new Set();
  const FIXED_IN = new Map();
  let text;
  try {
    text = readFileSync(
      new URL('../docs/operations/triage-state.md', import.meta.url),
      'utf8',
    );
  } catch {
    console.warn(
      '  ⚠ triage-state.md not found — running without the state ledger.',
    );
    return {PINNED_OPEN, NO_REOPEN, FIXED_IN};
  }
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      cur = {title: h[1].toLowerCase(), lines: []};
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  const bodyOf = sub => {
    const s = sections.find(x => x.title.includes(sub));
    return s ? s.lines : [];
  };
  // The "subject" of a ledger bullet is the leading `#NNN`(, #NNN)* BEFORE the
  // first em-dash; refs after the dash are explanatory prose (e.g. "duplicate of
  // #165", "(#36)") and must NOT be swept in. Italic/parenthetical placeholder
  // bullets (e.g. "- _(none yet ...)_") yield nothing.
  const subjectRefs = line => {
    const m = line.match(/^\s*-\s+(.*)$/);
    if (!m || /^[_(*]/.test(m[1])) return [];
    const head = m[1].split('—')[0];
    return [...head.matchAll(/#(\d+)/g)].map(x => Number(x[1]));
  };
  for (const line of bodyOf('pinned open'))
    for (const n of subjectRefs(line)) PINNED_OPEN.add(n);
  for (const line of bodyOf('do not reopen'))
    for (const n of subjectRefs(line)) NO_REOPEN.add(n);
  for (const line of bodyOf('fixed in build')) {
    const subj = subjectRefs(line)[0];
    const vc = line.match(/fixed-in:(\d+)/);
    if (subj && vc) FIXED_IN.set(subj, Number(vc[1]));
  }
  return {PINNED_OPEN, NO_REOPEN, FIXED_IN};
}

async function main() {
  console.log(
    `▶ triage-lifecycle  repo=${GH_REPO} passes=[${PASSES.length ? PASSES.join(',') : 'all'}] ` +
      `quiet-days=${QUIET_DAYS}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  const open = loadIssueCorpus({state: 'open', limit: LIMIT}).filter(
    i => i.autoFiled && !(i.body || '').includes('incident-umbrella:'),
  );
  const closed = loadIssueCorpus({state: 'closed', limit: LIMIT}).filter(
    i => i.autoFiled && !(i.body || '').includes('incident-umbrella:'),
  );
  console.log(
    `  corpus: ${open.length} open + ${closed.length} closed auto-filed issue(s)`,
  );

  const {PINNED_OPEN, NO_REOPEN, FIXED_IN} = loadTriageState();
  console.log(
    `  ledger: ${PINNED_OPEN.size} pinned-open, ${FIXED_IN.size} fixed-in, ${NO_REOPEN.size} do-not-reopen`,
  );

  let closes = 0;
  let reopens = 0;

  // -----------------------------------------------------------------------
  // PASS 1 — resolve-on-quiet
  // -----------------------------------------------------------------------
  if (RUN('resolve-on-quiet')) {
    console.log(`\n  [resolve-on-quiet] (zero events in last ${QUIET_DAYS}d)`);
    for (const issue of open) {
      if (closes >= MAX_CLOSE) break;
      if (!QUIET_ELIGIBLE.has(issue.marker.source)) continue;
      if (PINNED_OPEN.has(issue.number)) {
        console.log(
          `   · #${issue.number} pinned-open in the ledger — skipping resolve-on-quiet`,
        );
        continue;
      }
      const rec = await recencyFor(issue.marker);
      // Conservatism: if we can't find the signal in the source at all, it may
      // be a stale/aged-out id (Play ids churn across windows). Treat
      // "not found" as quiet ONLY for Sentry (where a missing shortId in a 90d
      // pull is a strong quiet signal); for Play, a missing id is ambiguous
      // (the id may have rotated) → skip, don't close.
      let quiet, lastSeenMs;
      if (rec) {
        lastSeenMs = rec.lastSeenMs;
        // A Sentry issue already resolved/ignored at source is also "handled".
        const handledAtSource =
          issue.marker.source === 'sentry' &&
          rec.status &&
          rec.status !== 'unresolved';
        quiet = lastSeenMs < quietCutoff || handledAtSource;
      } else if (issue.marker.source === 'sentry') {
        quiet = true;
        lastSeenMs = 0;
      } else {
        continue; // Play id not found → ambiguous, skip
      }
      if (!quiet) continue;
      const reason =
        `Auto-closing: the source signal (\`${issue.marker.source}:${issue.marker.id}\`) has been ` +
        `**quiet since ${fmtDate(lastSeenMs)}** (no events in the last ${QUIET_DAYS} days` +
        `${rec && rec.status && rec.status !== 'unresolved' ? `, and is \`${rec.status}\` at source` : ''}). ` +
        `Closed by \`scripts/triage-lifecycle.mjs\` (resolve-on-quiet). **This will reopen automatically ` +
        `if the same signature recurs on a newer build** (reopen-on-recurrence pass).`;
      console.log(
        `   ${DRY_RUN ? 'WOULD close' : 'close'} #${issue.number} — quiet since ${fmtDate(lastSeenMs)}`,
      );
      ghClose(issue.number, reason);
      closes++;
    }
  }

  // -----------------------------------------------------------------------
  // PASS 2 — close-on-fix (signal quiet on builds >= a recorded fixed-in)
  // -----------------------------------------------------------------------
  if (RUN('close-on-fix')) {
    console.log(
      `\n  [close-on-fix] (fixed-in:<vc> label/marker + quiet on >= that build)`,
    );
    let considered = 0;
    for (const issue of open) {
      if (closes >= MAX_CLOSE) break;
      const fixVc = fixedInVersion(issue) || FIXED_IN.get(issue.number);
      if (!fixVc) continue;
      considered++;
      const rec = await recencyFor(issue.marker);
      // Close when: no recency (signal gone) OR last seen is quiet OR (Play) the
      // newest affected build is below the fix version (so it only persists on
      // pre-fix builds).
      let close = false;
      let why = '';
      if (!rec) {
        close = true;
        why = `signal no longer present in source`;
      } else if (rec.lastSeenMs < quietCutoff) {
        close = true;
        why = `signal quiet since ${fmtDate(rec.lastSeenMs)}`;
      } else if (
        issue.marker.source === 'play-vitals' &&
        rec.newestVersionCode &&
        rec.newestVersionCode < fixVc
      ) {
        close = true;
        why = `only seen on builds < ${fixVc} (newest affected ${rec.newestVersionCode})`;
      }
      if (!close) {
        console.log(
          `   · #${issue.number} fixed-in:${fixVc} but still active (${fmtDate(rec.lastSeenMs)}, vc${rec.newestVersionCode || '?'}) — keeping open`,
        );
        continue;
      }
      const reason =
        `Auto-closing: marked \`fixed-in:${fixVc}\` and the source signal is ${why}. ` +
        `Closed by \`scripts/triage-lifecycle.mjs\` (close-on-fix). Reopens automatically if it recurs on a build >= ${fixVc}.`;
      console.log(
        `   ${DRY_RUN ? 'WOULD close' : 'close'} #${issue.number} — fixed-in:${fixVc}, ${why}`,
      );
      ghClose(issue.number, reason);
      closes++;
    }
    if (!considered)
      console.log(
        '   (no open issue carries a fixed-in:<vc> marker — nothing to do)',
      );
  }

  // -----------------------------------------------------------------------
  // PASS 3 — reopen-on-recurrence
  // -----------------------------------------------------------------------
  if (RUN('reopen-on-recurrence')) {
    console.log(
      `\n  [reopen-on-recurrence] (issue closed as COMPLETED whose signature recurs after closedAt on a newer build)`,
    );
    for (const issue of closed) {
      if (reopens >= MAX_REOPEN) break;
      if (NO_REOPEN.has(issue.number)) continue;
      if (!QUIET_ELIGIBLE.has(issue.marker.source)) continue;
      // ONLY reopen issues closed as COMPLETED (a fix was claimed). An issue
      // closed NOT_PLANNED was DELIBERATELY dropped (e.g. legacy-v1 noise, a
      // monitoring-only OOM) — its signature recurring is a re-file situation
      // the dedup/correlation handles, not a reopen. Reopening a not-planned
      // issue would fight the human decision + duplicate any re-file.
      if (String(issue.stateReason || '').toUpperCase() !== 'COMPLETED')
        continue;
      const closedAtMs = Date.parse(issue.closedAt) || 0;
      if (!closedAtMs) continue;
      const rec = await recencyFor(issue.marker);
      if (!rec || !rec.lastSeenMs) continue;

      // Recurred = the source's lastSeen is AFTER this issue was closed (with
      // a small grace so a same-day close+lingering-event doesn't thrash).
      // That alone is NOT proof the FIXED bug recurred — a pre-fix straggler
      // (a slow/stale device still running an old cached build below the
      // fix) also lands after closedAt; see #172. Play is implicitly safe
      // here (`newestVersionCode` is Play's own rolled-forward aggregation,
      // so it already names the recurrence's build for free); Sentry's
      // shortId is a stable grouping key that does NOT roll forward with the
      // build, so it needs an explicit — but lazy, only-when-recurred —
      // lookup. Both lanes funnel through the same shouldReopen() so they
      // can't drift apart again.
      const fixVc = fixedInVersion(issue) || FIXED_IN.get(issue.number);
      let recurrenceVc = null;
      if (fixVc && rec.lastSeenMs > closedAtMs + GRACE_MS) {
        recurrenceVc =
          issue.marker.source === 'play-vitals'
            ? rec.newestVersionCode || null
            : await sentryReleaseVersionCode(rec.id);
      }
      const decision = shouldReopen({
        lastSeenMs: rec.lastSeenMs,
        closedAtMs,
        fixedInVc: fixVc,
        recurrenceVc,
      });
      if (!decision.reopen) {
        if (decision.reason === 'stale-build') {
          console.log(
            `   · #${issue.number} recurred ${fmtDate(rec.lastSeenMs)} but on versionCode ${recurrenceVc}` +
              ` — still older than fixed-in:${fixVc}; a pre-fix straggler, keeping closed`,
          );
        }
        continue;
      }

      const displayVc = recurrenceVc || rec.newestVersionCode || null;
      const reason =
        `Reopening: this was closed ${fmtDate(closedAtMs)}, but the same signature ` +
        `(\`${issue.marker.source}:${issue.marker.id}\`) **recurred — last seen ${fmtDate(rec.lastSeenMs)}` +
        `${displayVc ? ` on versionCode ${displayVc}` : ''}**, after the close. ` +
        `Reopened by \`scripts/triage-lifecycle.mjs\` (reopen-on-recurrence) — the fix did not hold (or it is a new instance of the same root cause).`;
      console.log(
        `   ${DRY_RUN ? 'WOULD reopen' : 'reopen'} #${issue.number} — recurred ${fmtDate(rec.lastSeenMs)} > closed ${fmtDate(closedAtMs)}`,
      );
      ghReopen(issue.number, reason);
      reopens++;
    }
  }

  console.log(
    `\n▶ done — ${DRY_RUN ? 'would close' : 'closed'} ${closes}, ${DRY_RUN ? 'would reopen' : 'reopened'} ${reopens}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `closed=${DRY_RUN ? 0 : closes}\nreopened=${DRY_RUN ? 0 : reopens}\n`,
      {flag: 'a'},
    );
  }
}

// Guarded so importing this module (e.g. scripts/__tests__/
// triage-lifecycle-reopen.test.mjs, which imports the pure shouldReopen() /
// parseVersionCodeFromRelease() helpers) never triggers a live gh/Sentry/
// Play run as a side effect of import — main() only fires when this file is
// executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
